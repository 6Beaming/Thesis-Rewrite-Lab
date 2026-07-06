import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import blackboardUrl from '../assets/blackboard.png';
import AcademicStylePanel, {
  DEFAULT_CUSTOM_STYLE,
  TEMPLATE_STYLE_SETTINGS,
} from '../components/AcademicStylePanel.jsx';
import DocumentEditor from '../components/DocumentEditor.jsx';
import HistorySelector from '../components/HistorySelector.jsx';
import OwlContainer from '../components/OwlContainer.jsx';
import { getBlackboardCssVars, getMobileContainerCssVars } from './libraries/animations/containerLayout.js';
import { useFloatingWindow } from './libraries/useFloatingWindow.js';
import {
  getDocument,
  listDocuments,
  saveDocument,
  updateDocumentBlockStatus,
  uploadDocument,
} from '../services/documentsApi.js';
import HomePage from './HomePage.jsx';

const TEST_EMAIL = 'test@example.com';
const TEST_PASSWORD = '123456';
const TEST_DELAY_MS = 5000;
const PLACEHOLDER_DELAY_MS = 5000;
const REGEN_COOLDOWN_MS = 10000;
const DEMO_STORE_KEY = 'project-thesis-rewriter:demo-store:v1';
const DEMO_BLOCK_STATUSES = new Set(['unprocessed', 'processing', 'processed', 'skipped']);

function workspaceHistoryFallback(selectedDocument) {
  const now = Date.now();
  const storedDocuments = readDemoStore()?.documents ?? [];
  return [
    ...storedDocuments,
    {
      id: 'demo-history-literature-review',
      title: 'Literature review draft',
      academic_style: 'MLA',
      updated_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'demo-history-methods-notes',
      title: 'Methods notes',
      academic_style: 'Chicago',
      updated_at: new Date(now - 26 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'demo-history-article-summary',
      title: 'Article summary practice',
      academic_style: 'APA',
      updated_at: new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString(),
    },
    selectedDocument,
  ].filter((document, index, documents) => (
    document?.id && documents.findIndex((item) => item?.id === document.id) === index
  ));
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readDemoStore() {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DEMO_STORE_KEY) || 'null');
    if (!parsed || !Array.isArray(parsed.documents)) return null;
    return {
      documents: parsed.documents,
      trashDocuments: Array.isArray(parsed.trashDocuments) ? parsed.trashDocuments : [],
      hiddenDocumentIds: Array.isArray(parsed.hiddenDocumentIds) ? parsed.hiddenDocumentIds : [],
    };
  } catch {
    return null;
  }
}

function writeDemoStore(store) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(store));
}

function textFromDemoNode(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (!Array.isArray(node.content)) return '';
  return node.content.map(textFromDemoNode).join('');
}

function isEditableDemoBlock(node) {
  return node?.type === 'paragraph' || node?.type === 'heading';
}

function demoAttrs(blockId, status, length, existingAttrs = {}, styleSettings = {}) {
  return {
    lineHeight: styleSettings.spacing || styleSettings.lineHeight || existingAttrs.lineHeight || '2.0',
    textIndent: styleSettings.indentation || styleSettings.textIndent || existingAttrs.textIndent || '0.5in',
    textAlign: existingAttrs.textAlign || 'left',
    fontFamily: styleSettings.font || styleSettings.fontFamily || existingAttrs.fontFamily || 'Times New Roman',
    fontSize: styleSettings.fontSize || existingAttrs.fontSize || '12pt',
    ...existingAttrs,
    blockId,
    status,
    length,
  };
}

function demoDocumentFromContent(document, contentJson, styleName, styleSettings) {
  const sourceContent = Array.isArray(contentJson?.content) ? contentJson.content : [];
  const entries = [];
  const entryByContentIndex = new Map();

  sourceContent.forEach((node, contentIndex) => {
    if (!isEditableDemoBlock(node)) return;
    const text = textFromDemoNode(node).trim();
    if (!text) return;

    const existingAttrs = node.attrs ?? {};
    const blockId = existingAttrs.blockId || `${document.id}-block-${entries.length + 1}`;
    const status = DEMO_BLOCK_STATUSES.has(existingAttrs.status) ? existingAttrs.status : 'unprocessed';
    const attrs = demoAttrs(blockId, status, text.length, existingAttrs, styleSettings);
    const entry = {
      id: blockId,
      document_id: document.id,
      block_index: entries.length,
      text_content: text,
      status,
      char_length: text.length,
      attrs,
      tiptap_node: {
        ...node,
        attrs,
      },
      contentIndex,
    };
    entries.push(entry);
    entryByContentIndex.set(contentIndex, entry);
  });

  let hasProcessing = false;
  entries.forEach((entry) => {
    if (entry.status !== 'processing') return;
    if (!hasProcessing) {
      hasProcessing = true;
      return;
    }
    entry.status = 'unprocessed';
    entry.attrs.status = 'unprocessed';
    entry.tiptap_node.attrs.status = 'unprocessed';
  });

  if (!hasProcessing) {
    const firstUnprocessed = entries.find((entry) => entry.status === 'unprocessed');
    if (firstUnprocessed) {
      firstUnprocessed.status = 'processing';
      firstUnprocessed.attrs.status = 'processing';
      firstUnprocessed.tiptap_node.attrs.status = 'processing';
    }
  }

  const normalizedContent = {
    type: contentJson?.type ?? 'doc',
    content: sourceContent.map((node, index) => entryByContentIndex.get(index)?.tiptap_node ?? node),
  };
  const totalChars = entries.reduce((sum, entry) => sum + entry.char_length, 0);
  const completedChars = entries
    .filter((entry) => entry.status === 'processed' || entry.status === 'skipped')
    .reduce((sum, entry) => sum + entry.char_length, 0);

  return {
    ...document,
    academic_style: styleName,
    style_settings: styleSettings,
    snippet: entries[0]?.text_content ?? document.snippet,
    secondarySnippet: entries[1]?.text_content ?? document.secondarySnippet,
    content_json: normalizedContent,
    blocks: entries,
    current_processing_block_id: entries.find((entry) => entry.status === 'processing')?.id ?? null,
    completed_chars: completedChars,
    total_chars: totalChars,
    completed_rate: totalChars > 0 ? completedChars / totalChars : 0,
    updated_at: new Date().toISOString(),
  };
}

function normalizeWorkspaceContent(document, contentJson, styleName, styleSettings) {
  if (!document || !contentJson) return { document, contentJson };
  const normalizedDocument = demoDocumentFromContent(document, contentJson, styleName, styleSettings);
  return {
    document: normalizedDocument,
    contentJson: normalizedDocument.content_json,
  };
}

function upsertDemoDocumentInStore(document) {
  const store = readDemoStore() ?? {
    documents: [],
    trashDocuments: [],
    hiddenDocumentIds: [],
  };
  const nextDocuments = [
    document,
    ...store.documents.filter((item) => item.id !== document.id),
  ];
  writeDemoStore({
    ...store,
    documents: nextDocuments,
  });
}

function fallbackWorkspaceContent(document, styleSettings = {}) {
  const documentId = document?.id || 'workspace-document';
  const title = document?.title || 'Untitled document';
  const paragraphs = [
    `${title}. This local workspace draft is ready for editing.`,
    'Use the rewriting cards to test applying a replacement sentence, then press Save to keep the changes.',
  ];

  return {
    type: 'doc',
    content: paragraphs.map((text, index) => ({
      type: 'paragraph',
      attrs: demoAttrs(
        `${documentId}-block-${index + 1}`,
        index === 0 ? 'processing' : 'unprocessed',
        text.length,
        {},
        styleSettings,
      ),
      content: [{ type: 'text', text }],
    })),
  };
}

function contentFromPlainText(document, text, styleSettings = {}) {
  const documentId = document?.id || 'workspace-document';
  const sentences = String(text || '')
    .split(/(?<=\.)\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const paragraphs = sentences.length ? sentences : ['Start writing your document.'];

  return {
    type: 'doc',
    content: paragraphs.map((paragraph, index) => ({
      type: 'paragraph',
      attrs: demoAttrs(
        `${documentId}-block-${index + 1}`,
        index === 0 ? 'processing' : 'unprocessed',
        paragraph.length,
        {},
        styleSettings,
      ),
      content: [{ type: 'text', text: paragraph }],
    })),
  };
}

function createWorkspaceUploadDocument({ title, text, filename }, styleName = 'APA', styleSettings = TEMPLATE_STYLE_SETTINGS.APA) {
  const id = `demo-upload-${Date.now()}`;
  const baseDocument = {
    id,
    title: title || filename?.replace(/\.[^.]+$/, '') || 'Uploaded document',
    academic_style: styleName,
    style_settings: styleSettings,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return demoDocumentFromContent(
    baseDocument,
    contentFromPlainText(baseDocument, text, styleSettings),
    styleName,
    styleSettings,
  );
}

function hydrateWorkspaceDocument(document) {
  if (!document) return null;

  const storeDocument = readDemoStore()?.documents?.find((item) => item.id === document.id);
  const source = storeDocument ?? document;
  if (source.content_json || source.blocks?.length) {
    return source;
  }

  const nextStyleName = source.academic_style || 'APA';
  const nextStyleSettings = {
    ...(TEMPLATE_STYLE_SETTINGS[nextStyleName] ?? DEFAULT_CUSTOM_STYLE),
    ...(source.style_settings ?? {}),
  };

  return demoDocumentFromContent(
    {
      ...source,
      title: source.title || 'Untitled document',
      academic_style: nextStyleName,
      style_settings: nextStyleSettings,
    },
    fallbackWorkspaceContent(source, nextStyleSettings),
    nextStyleName,
    nextStyleSettings,
  );
}

export default function WorkspacePage() {
  const [view, setView] = useState('auth');
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [showUnsavedBackPrompt, setShowUnsavedBackPrompt] = useState(false);
  const [editorReloadKey, setEditorReloadKey] = useState(0);
  const [workspaceSidebarOpen, setWorkspaceSidebarOpen] = useState(true);
  const [workspaceMode, setWorkspaceMode] = useState('analyzing');
  const [workspaceOwlLoading, setWorkspaceOwlLoading] = useState(false);
  const [workspaceOwlError, setWorkspaceOwlError] = useState(false);
  const [workspaceOwlErrorKey, setWorkspaceOwlErrorKey] = useState(0);
  const [styleName, setStyleName] = useState('APA');
  const [styleSettings, setStyleSettings] = useState(TEMPLATE_STYLE_SETTINGS.APA);
  const [editorContent, setEditorContent] = useState(null);
  const [activeEditorBlock, setActiveEditorBlock] = useState({ blockId: null, status: 'unprocessed' });
  const [rewriteCards, setRewriteCards] = useState([
    { id: 1, title: 'Rewriting Card 1', response: '', error: '', skipped: false, applyWithExplanation: false },
    { id: 2, title: 'Rewriting Card 2', response: '', error: '', skipped: false, applyWithExplanation: false },
    { id: 3, title: 'Rewriting Card 3', response: '', error: '', skipped: false, applyWithExplanation: false },
  ]);
  const [rewriteCardsLocked, setRewriteCardsLocked] = useState(false);
  const [rewriteAllCompleted, setRewriteAllCompleted] = useState(false);
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [rewriteCooldownUntil, setRewriteCooldownUntil] = useState(0);
  const [practiceInput, setPracticeInput] = useState('');
  const [practiceResponse, setPracticeResponse] = useState('');
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [mobileOwlOpen, setMobileOwlOpen] = useState(false);
  const [mobilePanelMode, setMobilePanelMode] = useState('rewriting');
  const [mobileRewriteIndex, setMobileRewriteIndex] = useState(0);
  const [mobilePracticeIndex, setMobilePracticeIndex] = useState(0);
  const [mobileOptionsOpen, setMobileOptionsOpen] = useState(false);
  const [mobileOptionsTab, setMobileOptionsTab] = useState('setup');
  const [workspaceHistoryDocuments, setWorkspaceHistoryDocuments] = useState([]);
  const [workspaceHistoryExpanded, setWorkspaceHistoryExpanded] = useState(false);
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('error');
  const [showForgot, setShowForgot] = useState(false);
  const [errorKey, setErrorKey] = useState(0);
  const submitButtonRef = useRef(null);
  const submitLockedRef = useRef(false);
  const owlAnimatorRef = useRef(null);
  const workspaceOwlAnimatorRef = useRef(null);
  const mobileWorkspaceOwlAnimatorRef = useRef(null);
  const documentEditorRef = useRef(null);
  const mobileDragEndedAtRef = useRef(0);
  const rewriteRefreshTimerRef = useRef(null);
  const wandHoverTimerRef = useRef(null);
  const workspaceUploadInputRef = useRef(null);
  const mobileOptionsPanelRef = useRef(null);
  const mobileOptionsButtonRef = useRef(null);
  const magicTargets = useMemo(() => [submitButtonRef], []);
  const blackboardStyle = getBlackboardCssVars();
  const {
    windowRef: mobileOwlRef,
    metrics: mobileOwlMetrics,
    position: mobileOwlPosition,
    isDragging: mobileOwlDragging,
    handlers: mobileOwlHandlers,
  } = useFloatingWindow();
  const mobileOwlStyle = useMemo(() => ({
    ...getMobileContainerCssVars(mobileOwlMetrics),
    left: `${mobileOwlPosition.left}px`,
    top: `${mobileOwlPosition.top}px`,
  }), [mobileOwlMetrics, mobileOwlPosition]);
  const styleSettingsSignature = useMemo(() => JSON.stringify(styleSettings ?? {}), [styleSettings]);

  useEffect(() => {
    if (!message || messageTone === 'loading') {
      return undefined;
    }

    const timer = setTimeout(() => {
      setMessage('');
      setMessageTone('error');
      setShowForgot(false);
    }, 5000);

    return () => {
      clearTimeout(timer);
    };
  }, [message, messageTone]);

  useEffect(() => () => {
    if (rewriteRefreshTimerRef.current) {
      clearTimeout(rewriteRefreshTimerRef.current);
    }
    if (wandHoverTimerRef.current) {
      clearTimeout(wandHoverTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!mobileOptionsOpen) return undefined;

    function closeMobileOptions(event) {
      if (
        mobileOptionsPanelRef.current?.contains(event.target)
        || mobileOptionsButtonRef.current?.contains(event.target)
      ) {
        return;
      }
      setMobileOptionsOpen(false);
    }

    document.addEventListener('pointerdown', closeMobileOptions);
    return () => {
      document.removeEventListener('pointerdown', closeMobileOptions);
    };
  }, [mobileOptionsOpen]);

  async function triggerButtonMagic() {
    const animator = owlAnimatorRef.current;
    const target = submitButtonRef.current;
    if (!animator || !target) {
      return;
    }
    await animator.useMagic(target, { effect: 'button-burst' });
  }

  function showError(nextMessage, options = {}) {
    setMessage(nextMessage);
    setMessageTone('error');
    setShowForgot(Boolean(options.showForgot));
    setErrorKey((value) => value + 1);
  }

  async function placeholderTest(event) {
    event.preventDefault();
    if (loading || submitLockedRef.current) {
      return;
    }

    submitLockedRef.current = true;
    try {
      if (mode === 'signup') {
        setShowForgot(false);
        await triggerButtonMagic();
        setMessage('Sign Up is not available yet.');
        setMessageTone('success');
        return;
      }

      const submittedEmail = email.trim().toLowerCase();
      const submittedPassword = password;
      const loginRequest = sleep(TEST_DELAY_MS);

      await triggerButtonMagic();

      setShowForgot(false);
      setMessage('Loading...');
      setMessageTone('loading');
      setLoading(true);

      await loginRequest;

      if (submittedEmail !== TEST_EMAIL) {
        showError('Account not found.');
        setLoading(false);
        return;
      }

      if (submittedPassword !== TEST_PASSWORD) {
        showError('Incorrect Password!', { showForgot: true });
        setLoading(false);
        return;
      }

      setLoading(false);
      setMessage('Login Success!');
      setMessageTone('success');
      await sleep(900);
      setView('home');
    } finally {
      submitLockedRef.current = false;
    }
  }

  function switchMode(nextMode) {
    if (loading || mode === nextMode) {
      return;
    }
    setMode(nextMode);
    setMessage('');
    setMessageTone('error');
    setShowForgot(false);
  }

  function handleResetPassword() {
    if (loading) {
      return;
    }

    if (email.trim().toLowerCase() === TEST_EMAIL) {
      setShowForgot(false);
      setMessage('Reset link ready for test@example.com.');
      setMessageTone('success');
    } else {
      showError('Enter test@example.com first.');
    }
  }

  useEffect(() => {
    if (view !== 'workspace' || !selectedDocument?.id || selectedDocument.id.startsWith('demo-')) {
      return undefined;
    }

    let alive = true;
    getDocument(selectedDocument.id)
      .then(({ document }) => {
        if (!alive) return;
        setSelectedDocument(document);
        const nextStyleName = document.academic_style || 'APA';
        setStyleName(nextStyleName);
        setStyleSettings({
          ...(TEMPLATE_STYLE_SETTINGS[nextStyleName] ?? DEFAULT_CUSTOM_STYLE),
          ...(document.style_settings ?? {}),
        });
      })
      .catch((error) => {
        if (alive) setWorkspaceNotice(error.message || 'Could not load document details.');
      });

    return () => {
      alive = false;
    };
  }, [view, selectedDocument?.id]);

  useEffect(() => {
    if (view !== 'workspace') {
      return undefined;
    }

    let alive = true;
    listDocuments({ sort: 'most_recent' })
      .then((data) => {
        if (!alive) return;
        setWorkspaceHistoryDocuments((data.documents ?? []).filter((document) => (
          document.id !== selectedDocument?.id
        )));
      })
      .catch(() => {
        if (!alive) return;
        setWorkspaceHistoryDocuments(workspaceHistoryFallback(selectedDocument));
      });

    return () => {
      alive = false;
    };
  }, [view, selectedDocument?.id]);

  function openWorkspace(document) {
    const hydratedDocument = hydrateWorkspaceDocument(document);
    setSelectedDocument(hydratedDocument);
    setEditorContent(hydratedDocument?.content_json ?? null);
    setActiveEditorBlock({
      blockId: hydratedDocument?.current_processing_block_id ?? null,
      status: hydratedDocument?.current_processing_block_id ? 'processing' : 'unprocessed',
    });
    setEditorReloadKey((value) => value + 1);
    const nextStyleName = hydratedDocument?.academic_style || 'APA';
    setStyleName(nextStyleName);
    setStyleSettings({
      ...(TEMPLATE_STYLE_SETTINGS[nextStyleName] ?? DEFAULT_CUSTOM_STYLE),
      ...(hydratedDocument?.style_settings ?? {}),
    });
    setWorkspaceDirty(false);
    setWorkspaceNotice('');
    setRewriteCardsLocked(false);
    setRewriteAllCompleted(false);
    setRewriteCards((cards) => cards.map((card) => ({
      ...card,
      response: '',
      error: '',
      skipped: false,
      applyWithExplanation: false,
    })));
    setWorkspaceHistoryExpanded(false);
    setView('workspace');
  }

  function handleTemplateChange(nextStyleName) {
    setStyleName(nextStyleName);
    setStyleSettings(TEMPLATE_STYLE_SETTINGS[nextStyleName] ?? TEMPLATE_STYLE_SETTINGS.APA);
    setWorkspaceDirty(true);
  }

  function handleCustomStyleChange(nextSettings) {
    setStyleName('Customized');
    setStyleSettings({ ...DEFAULT_CUSTOM_STYLE, ...nextSettings });
    setWorkspaceDirty(true);
  }

  function handleWorkspaceTitleChange(nextTitle) {
    setSelectedDocument((document) => (document ? { ...document, title: nextTitle } : document));
    setWorkspaceDirty(true);
  }

  function handleEditorChange(contentJson) {
    const normalized = normalizeWorkspaceContent(selectedDocument, contentJson, styleName, styleSettings);
    setEditorContent(normalized.contentJson ?? contentJson);
    if (normalized.document) {
      setSelectedDocument(normalized.document);
      if (rewriteAllCompleted) {
        refreshRewriteCardsFromDocument(normalized.document);
      }
    }
    setWorkspaceDirty(true);
  }

  const handleActiveEditorBlockChange = useCallback((info) => {
    const nextInfo = info ?? { blockId: null, status: 'unprocessed' };
    setActiveEditorBlock((current) => (
      current?.blockId === nextInfo.blockId && current?.status === nextInfo.status
        ? current
        : nextInfo
    ));
  }, []);

  function normalizedWorkspaceDocument() {
    if (!selectedDocument) return null;
    const contentJson = editorContent
      ?? selectedDocument.content_json
      ?? fallbackWorkspaceContent(selectedDocument, styleSettings);

    return demoDocumentFromContent(selectedDocument, contentJson, styleName, styleSettings);
  }

  async function saveWorkspaceDocument({ leaveAfterSave = false } = {}) {
    const document = normalizedWorkspaceDocument();
    if (!document?.id) return false;

    setWorkspaceSaving(true);
    try {
      if (document.id.startsWith('demo-')) {
        upsertDemoDocumentInStore(document);
        setSelectedDocument(document);
        setEditorContent(document.content_json);
        setWorkspaceNotice('Saved locally');
      } else {
        const result = await saveDocument(document.id, {
          academicStyle: styleName,
          styleSettings,
          contentJson: document.content_json,
          createVersion: true,
          versionLabel: 'Manual save',
        });
        setSelectedDocument(result.document ?? document);
        setEditorContent((result.document ?? document).content_json ?? document.content_json);
        setWorkspaceNotice('Saved');
      }

      setWorkspaceDirty(false);
      setShowUnsavedBackPrompt(false);
      if (leaveAfterSave) {
        setView('home');
      }
      return true;
    } catch (error) {
      setWorkspaceNotice(error.message || 'Save is waiting for the local API.');
      return false;
    } finally {
      setWorkspaceSaving(false);
    }
  }

  function requestWorkspaceBack() {
    if (workspaceDirty) {
      setShowUnsavedBackPrompt(true);
      return;
    }
    setView('home');
  }

  function leaveWorkspaceWithoutSaving() {
    setShowUnsavedBackPrompt(false);
    setWorkspaceDirty(false);
    setView('home');
  }

  function handleWorkspaceUploadInputChange(event) {
    const file = event.target.files?.[0];
    if (file) {
      handleWorkspaceUploadFile(file);
    }
    event.target.value = '';
  }

  function refreshRewriteCardsFromDocument(document, notice = '') {
    const hasProcessing = document?.blocks?.some((block) => block.status === 'processing');
    const hasUnprocessed = document?.blocks?.some((block) => block.status === 'unprocessed');

    if (!hasProcessing && !hasUnprocessed) {
      setRewriteAllCompleted(true);
      setRewriteCardsLocked(true);
      setWorkspaceNotice(notice || 'Congratulations, all blocks are completed.');
      return;
    }

    setRewriteAllCompleted(false);
    setRewriteCardsLocked(false);
    setRewriteCards((cards) => cards.map((card) => ({
      ...card,
      response: '',
      error: '',
      skipped: false,
      applyWithExplanation: false,
    })));
    if (notice) setWorkspaceNotice(notice);
  }

  async function handleWorkspaceUploadFile(file) {
    if (!file) return;

    if (/\.doc$/i.test(file.name)) {
      setWorkspaceNotice('.doc uploads are not supported. Please upload .docx, .md, or .txt.');
      return;
    }

    try {
      const result = await uploadDocument(file, styleName);
      openWorkspace(result.document);
      setWorkspaceNotice(`${file.name} uploaded as a new document.`);
    } catch (error) {
      if (/\.(txt|md)$/i.test(file.name)) {
        const text = await file.text();
        const document = createWorkspaceUploadDocument({
          title: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
          text,
          filename: file.name,
        }, styleName, styleSettings);
        upsertDemoDocumentInStore(document);
        openWorkspace(document);
        setWorkspaceNotice(`${file.name} opened as a local demo upload.`);
        return;
      }
      setWorkspaceNotice(error.message || '.docx parsing needs the local upload API.');
    }
  }

  async function handleEditorBlockStatusChange({ blockId, status }) {
    const contentJson = arguments[0]?.contentJson;
    const nextDocument = contentJson && selectedDocument
      ? demoDocumentFromContent(selectedDocument, contentJson, styleName, styleSettings)
      : null;

    if (nextDocument) {
      setSelectedDocument(nextDocument);
      setEditorContent(nextDocument.content_json);
      refreshRewriteCardsFromDocument(nextDocument);
    }

    if (!selectedDocument?.id || selectedDocument.id.startsWith('demo-')) {
      if (status !== 'processing') {
        setWorkspaceNotice(`Marked block as ${status}.`);
      } else {
        setWorkspaceNotice('');
      }
      setWorkspaceDirty(true);
      return;
    }

    try {
      await updateDocumentBlockStatus(selectedDocument.id, blockId, status);
      const { document } = await getDocument(selectedDocument.id);
      setSelectedDocument(document);
      refreshRewriteCardsFromDocument(document, status === 'processing' ? '' : `Block marked as ${status}.`);
    } catch (error) {
      setWorkspaceNotice(error.message || 'Block status is waiting for the local API.');
    }
  }

  function getWorkspaceOwlAnimator() {
    const isMobileLayout = typeof window !== 'undefined'
      && window.matchMedia('(max-width: 980px)').matches;
    return (
      (isMobileLayout ? mobileWorkspaceOwlAnimatorRef.current : workspaceOwlAnimatorRef.current)
      || workspaceOwlAnimatorRef.current
      || mobileWorkspaceOwlAnimatorRef.current
    );
  }

  function getWorkspaceOwlAnimators() {
    return [
      workspaceOwlAnimatorRef.current,
      mobileWorkspaceOwlAnimatorRef.current,
    ].filter((animator, index, animators) => (
      animator && animators.indexOf(animator) === index
    ));
  }

  async function runWorkspaceMagic(target) {
    const animator = getWorkspaceOwlAnimator();
    if (!animator || !target) return;
    await animator.useMagic(target, { effect: 'button-burst' });
  }

  function showWorkspaceWand() {
    getWorkspaceOwlAnimators().forEach((animator) => {
      animator.showWand();
    });
  }

  function holdWorkspaceWand() {
    showWorkspaceWand();
    [120, 420, 900].forEach((delay) => {
      window.setTimeout(showWorkspaceWand, delay);
    });

    if (wandHoverTimerRef.current) {
      clearTimeout(wandHoverTimerRef.current);
    }
    wandHoverTimerRef.current = window.setTimeout(showWorkspaceWand, 29000);
  }

  useEffect(() => {
    if (view !== 'workspace') {
      return undefined;
    }

    let lastHoverTarget = null;
    function triggerWandFromHover(event) {
      const target = event.target?.closest?.('[data-workspace-wand-target="true"]');
      if (!target) return;

      if (event.type === 'pointerover' && target === lastHoverTarget) {
        return;
      }
      lastHoverTarget = target;
      holdWorkspaceWand();
    }

    function clearHoverTarget(event) {
      const target = event.target?.closest?.('[data-workspace-wand-target="true"]');
      const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (!target || (relatedTarget && target.contains(relatedTarget))) return;
      if (target === lastHoverTarget) {
        lastHoverTarget = null;
      }
    }

    window.addEventListener('workspace:show-wand', holdWorkspaceWand);
    document.addEventListener('pointerover', triggerWandFromHover, true);
    document.addEventListener('focusin', triggerWandFromHover, true);
    document.addEventListener('pointerout', clearHoverTarget, true);

    return () => {
      window.removeEventListener('workspace:show-wand', holdWorkspaceWand);
      document.removeEventListener('pointerover', triggerWandFromHover, true);
      document.removeEventListener('focusin', triggerWandFromHover, true);
      document.removeEventListener('pointerout', clearHoverTarget, true);
    };
  }, [view]);

  function triggerWorkspaceError() {
    setWorkspaceOwlLoading(false);
    setWorkspaceOwlError(true);
    setWorkspaceOwlErrorKey((value) => value + 1);
    setTimeout(() => {
      setWorkspaceOwlError(false);
    }, 5600);
  }

  async function regenerateRewriteCard(cardId) {
    if (rewriteCardsLocked || rewriteAllCompleted) {
      return;
    }
    const now = Date.now();
    if (now < rewriteCooldownUntil) {
      setWorkspaceNotice('Regeneration is cooling down. Please wait a moment.');
      return;
    }
    if (rewriteBusy) {
      setWorkspaceNotice('A regeneration is already running.');
      return;
    }

    setRewriteBusy(true);
    setRewriteCooldownUntil(now + REGEN_COOLDOWN_MS);
    setWorkspaceNotice('');
    setWorkspaceOwlError(false);
    setWorkspaceOwlLoading(true);
    await sleep(PLACEHOLDER_DELAY_MS);

    if (cardId === 2) {
      setRewriteCards((cards) => cards.map((card) => (
        card.id === cardId ? { ...card, error: 'Network Problems', response: '' } : card
      )));
      triggerWorkspaceError();
      setRewriteBusy(false);
      return;
    }

    setRewriteCards((cards) => cards.map((card) => (
      card.id === cardId
        ? { ...card, response: `This is placeholder response of Rewriting Card ${cardId}.`, error: '' }
        : card
    )));
    setWorkspaceOwlLoading(false);
    setRewriteBusy(false);
  }

  async function handleRewriteCardClick(card, event) {
    if (rewriteCardsLocked || rewriteAllCompleted || card.error || card.skipped) return;
    await runWorkspaceMagic(event.currentTarget);
    applyRewriteCard(card);
  }

  function resetRewriteCardsForNextBlock(nextNotice = 'Cards refreshed for the next processing block.') {
    if (rewriteRefreshTimerRef.current) {
      clearTimeout(rewriteRefreshTimerRef.current);
    }

    rewriteRefreshTimerRef.current = setTimeout(() => {
      setRewriteCards((cards) => cards.map((card) => ({
        ...card,
        response: '',
        error: '',
        skipped: false,
        applyWithExplanation: false,
      })));
      setRewriteCardsLocked(false);
      setWorkspaceNotice(nextNotice);
    }, 650);
  }

  function lockOrCompleteRewriteCards(document, nextNotice) {
    const hasProcessing = document?.blocks?.some((block) => block.status === 'processing');
    const hasUnprocessed = document?.blocks?.some((block) => block.status === 'unprocessed');
    setRewriteCardsLocked(true);

    if (!hasProcessing && !hasUnprocessed) {
      setRewriteAllCompleted(true);
      setWorkspaceNotice('Congratulations, all blocks are completed.');
      return;
    }

    setRewriteAllCompleted(false);
    resetRewriteCardsForNextBlock(nextNotice);
  }

  function applyStatusToCurrentProcessingBlock(nextStatus, replacementText = null) {
    if (!selectedDocument) return null;

    const editorContentJson = documentEditorRef.current?.applyCurrentBlockStatus({
      status: nextStatus,
      replacementText,
    });
    if (editorContentJson) {
      const document = demoDocumentFromContent(selectedDocument, editorContentJson, styleName, styleSettings);
      setSelectedDocument(document);
      setEditorContent(document.content_json);
      setActiveEditorBlock({
        blockId: document.current_processing_block_id ?? null,
        status: document.current_processing_block_id ? 'processing' : nextStatus,
      });
      setWorkspaceDirty(true);
      return document;
    }

    const rawSourceContent = editorContent
      ?? selectedDocument.content_json
      ?? fallbackWorkspaceContent(selectedDocument, styleSettings);
    const normalized = normalizeWorkspaceContent(selectedDocument, rawSourceContent, styleName, styleSettings);
    const sourceDocument = normalized.document ?? selectedDocument;
    const sourceContent = normalized.contentJson ?? rawSourceContent;
    const nodes = Array.isArray(sourceContent.content) ? sourceContent.content : [];
    const editableIndexes = nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => isEditableDemoBlock(node) && textFromDemoNode(node).trim());

    if (!editableIndexes.length) {
      setWorkspaceNotice('No editable block is available.');
      return null;
    }

    const activeBlockId = activeEditorBlock?.blockId;
    const currentProcessingId = sourceDocument.current_processing_block_id;
    const target = editableIndexes.find(({ node }) => (
      activeBlockId
      && node.attrs?.blockId === activeBlockId
      && ['processing', 'unprocessed'].includes(node.attrs?.status)
    ))
      ?? editableIndexes.find(({ node }) => node.attrs?.blockId === currentProcessingId)
      ?? editableIndexes.find(({ node }) => node.attrs?.status === 'processing')
      ?? editableIndexes[0];
    const nextProcessingIndex = editableIndexes
      .find(({ node }) => node.attrs?.blockId !== target.node.attrs?.blockId && node.attrs?.status === 'unprocessed')
      ?.index ?? null;

    const nextContent = {
      type: sourceContent.type ?? 'doc',
      content: nodes.map((node, index) => {
        if (!isEditableDemoBlock(node)) return node;
        const attrs = { ...(node.attrs ?? {}) };
        let nextNode = node;

        if (index === target.index) {
          attrs.status = nextStatus;
          if (replacementText !== null) {
            attrs.length = replacementText.length;
            nextNode = {
              ...node,
              attrs,
              content: [{ type: 'text', text: replacementText }],
            };
          } else {
            nextNode = { ...node, attrs };
          }
        } else if (index === nextProcessingIndex) {
          attrs.status = 'processing';
          nextNode = { ...node, attrs };
        } else if (attrs.status === 'processing') {
          attrs.status = 'unprocessed';
          nextNode = { ...node, attrs };
        }

        return nextNode;
      }),
    };

    const document = demoDocumentFromContent(sourceDocument, nextContent, styleName, styleSettings);
    setSelectedDocument(document);
    setEditorContent(document.content_json);
    setActiveEditorBlock({
      blockId: document.current_processing_block_id ?? null,
      status: document.current_processing_block_id ? 'processing' : nextStatus,
    });
    setWorkspaceDirty(true);
    return document;
  }

  function applyRewriteCard(card) {
    const replacement = card.response || `This is placeholder response of Rewriting Card ${card.id}.`;
    const replacementText = replacement;
    const document = applyStatusToCurrentProcessingBlock('processed', replacementText);
    if (document) {
      lockOrCompleteRewriteCards(document, `${card.title} applied. Cards refreshed for the next block.`);
    }
  }

  function toggleRewriteExplanation(cardId) {
    setRewriteCards((cards) => cards.map((card) => (
      card.id === cardId ? { ...card, applyWithExplanation: !card.applyWithExplanation } : card
    )));
  }

  function disableCurrentRewriteBlock() {
    if (rewriteCardsLocked || rewriteAllCompleted || rewriteBusy) return;
    const document = applyStatusToCurrentProcessingBlock('skipped');
    if (document) {
      lockOrCompleteRewriteCards(document, 'Current block skipped. Cards refreshed for the next block.');
    }
  }

  async function tryPracticeResponse(event) {
    const target = event.currentTarget;
    if (practiceBusy) return;
    setPracticeBusy(true);
    setPracticeResponse('');
    setWorkspaceOwlLoading(true);
    runWorkspaceMagic(target);
    await sleep(PLACEHOLDER_DELAY_MS);
    setPracticeResponse(`This is placeholder practice response for: ${practiceInput || 'the selected sentence'}.`);
    setWorkspaceOwlLoading(false);
    setPracticeBusy(false);
  }

  function renderRewriteCard(card) {
    return (
      <article
        key={card.id}
        className={`rewrite-card${card.error ? ' has-error' : ''}${rewriteCardsLocked ? ' is-locked' : ''}`}
        data-workspace-wand-target="true"
        onMouseEnter={holdWorkspaceWand}
        onPointerEnter={holdWorkspaceWand}
        onFocus={holdWorkspaceWand}
        onClick={(event) => handleRewriteCardClick(card, event)}
        tabIndex={0}
      >
        <div className="rewrite-card-header">
          <strong>{card.title}</strong>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              regenerateRewriteCard(card.id);
            }}
            disabled={rewriteBusy || rewriteCardsLocked || rewriteAllCompleted}
          >
            Regenerate
          </button>
        </div>
        <p>{card.error || card.response || 'Hover for wand, click to use magic, or regenerate a placeholder response.'}</p>
      </article>
    );
  }

  function renderRewriteCompleteCard() {
    return (
      <article className="rewrite-card rewrite-card--complete">
        <strong>Congratulations</strong>
        <p>All completed.</p>
      </article>
    );
  }

  function moveMobileRewrite(step) {
    setMobileRewriteIndex((current) => (current + step + rewriteCards.length) % rewriteCards.length);
  }

  function moveMobilePractice(step) {
    setMobilePracticeIndex((current) => (current + step + 2) % 2);
  }

  function handleMobilePracticeTry(event) {
    setMobilePracticeIndex(1);
    tryPracticeResponse(event);
  }

  function handleMobileOwlPointerUp(event) {
    if (mobileOwlDragging) {
      mobileDragEndedAtRef.current = Date.now();
    }
    mobileOwlHandlers.onPointerUp(event);
  }

  function handleMobileOwlClick() {
    if (Date.now() - mobileDragEndedAtRef.current < 250) {
      return;
    }
    setMobileOwlOpen((value) => !value);
  }

  function renderMobileAssistantPanel() {
    const currentRewriteCard = rewriteCards[mobileRewriteIndex] || rewriteCards[0];

    return (
      <section className="workspace-mobile-assistant-panel" aria-label="Mobile owl workspace panel">
        <div className="workspace-mobile-panel-switcher" role="tablist" aria-label="Mobile workspace mode">
          {['rewriting', 'practicing'].map((item) => (
            <button
              key={item}
              type="button"
              className={mobilePanelMode === item ? 'is-active' : ''}
              onClick={() => setMobilePanelMode(item)}
            >
              {item}
            </button>
          ))}
        </div>

        {mobilePanelMode === 'rewriting' ? (
          <div className="workspace-mobile-panel-body">
            <div className="workspace-mobile-card-nav">
              <button type="button" onClick={() => moveMobileRewrite(-1)}>{'<'}</button>
              <span>{mobileRewriteIndex + 1} / {rewriteCards.length}</span>
              <button type="button" onClick={() => moveMobileRewrite(1)}>{'>'}</button>
            </div>
            {!rewriteAllCompleted ? (
              <button
                type="button"
                className="rewrite-disable-current"
                onClick={disableCurrentRewriteBlock}
                disabled={rewriteCardsLocked || rewriteBusy}
              >
                Disable Current Block
              </button>
            ) : null}
            {rewriteAllCompleted ? renderRewriteCompleteCard() : (currentRewriteCard ? renderRewriteCard(currentRewriteCard) : null)}
          </div>
        ) : (
          <div className="workspace-mobile-panel-body">
            <div className="workspace-mobile-card-nav">
              <button type="button" onClick={() => moveMobilePractice(-1)}>{'<'}</button>
              <span>{mobilePracticeIndex + 1} / 2</span>
              <button type="button" onClick={() => moveMobilePractice(1)}>{'>'}</button>
            </div>
            {mobilePracticeIndex === 0 ? (
              <article
                className="practice-card"
                data-workspace-wand-target="true"
                onMouseEnter={holdWorkspaceWand}
                onPointerEnter={holdWorkspaceWand}
                onFocus={holdWorkspaceWand}
              >
                <p>Write a replacement sentence and try a local placeholder response.</p>
                <textarea
                  value={practiceInput}
                  onChange={(event) => setPracticeInput(event.target.value)}
                  placeholder="Type your replacement sentence..."
                />
                <button type="button" onMouseEnter={holdWorkspaceWand} onClick={handleMobilePracticeTry} disabled={practiceBusy}>
                  {practiceBusy ? 'Thinking...' : 'Try Response'}
                </button>
              </article>
            ) : (
              <article
                className="practice-card practice-card--response"
                data-workspace-wand-target="true"
                onMouseEnter={holdWorkspaceWand}
                onPointerEnter={holdWorkspaceWand}
                onFocus={holdWorkspaceWand}
              >
                <span>View only</span>
                <p>{practiceResponse || 'Responses will appear here after the 5s placeholder delay.'}</p>
              </article>
            )}
          </div>
        )}
      </section>
    );
  }

  function renderAnalysisStats() {
    return (
      <dl className="analysis-stats">
        <div><dt>Completion</dt><dd>{Math.round(Number(selectedDocument?.completed_rate ?? 0) * 100)}%</dd></div>
        <div><dt>Blocks</dt><dd>{selectedDocument?.blocks?.length ?? 2}</dd></div>
        <div><dt>Current Style</dt><dd>{styleName}</dd></div>
      </dl>
    );
  }

  function renderMobileOptionsPanel(recentDocuments) {
    const tabs = [
      ['setup', 'New doc'],
      ['styles', 'Styles'],
      ['history', 'History'],
      ['analyzing', 'Analyzing'],
    ];

    return (
      <section ref={mobileOptionsPanelRef} className="workspace-mobile-options-panel" aria-label="Mobile workspace options">
        <div className="workspace-mobile-options-tabs" role="tablist" aria-label="Workspace options">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={mobileOptionsTab === id ? 'is-active' : ''}
              onClick={() => setMobileOptionsTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="workspace-mobile-options-body">
          {mobileOptionsTab === 'setup' ? (
            <section className="workspace-upload-note">
              <p>Uploading creates a new document. Press Save before leaving to keep current edits.</p>
              <button type="button" onClick={() => workspaceUploadInputRef.current?.click()}>
                Upload New Document
              </button>
            </section>
          ) : null}
          {mobileOptionsTab === 'styles' ? (
            <AcademicStylePanel
              styleName={styleName}
              customStyle={styleSettings}
              onTemplateChange={handleTemplateChange}
              onCustomStyleChange={handleCustomStyleChange}
            />
          ) : null}
          {mobileOptionsTab === 'history' ? (
            <HistorySelector
              documents={recentDocuments}
              expanded={workspaceHistoryExpanded}
              onSelect={(document) => {
                openWorkspace(document);
                setMobileOptionsOpen(false);
              }}
              onViewAll={() => setWorkspaceHistoryExpanded((value) => !value)}
            />
          ) : null}
          {mobileOptionsTab === 'analyzing' ? (
            <section className="workspace-mode-card">
              <h2>Analyzing</h2>
              <p>Style statistics and local writing signals will appear here.</p>
              {renderAnalysisStats()}
            </section>
          ) : null}
        </div>
      </section>
    );
  }

  function renderWorkspaceMode() {
    if (workspaceMode === 'analyzing') {
      return (
        <section className="workspace-mode-card">
          <h2>Analyzing</h2>
          <p>Style statistics and local writing signals will appear here.</p>
          {renderAnalysisStats()}
        </section>
      );
    }

    if (workspaceMode === 'rewriting') {
      return (
        <section className="workspace-mode-card workspace-mode-card--interactive">
          <div className="workspace-mode-card-title-row">
            <h2>Rewriting</h2>
            {!rewriteAllCompleted ? (
              <button
                type="button"
                className="rewrite-disable-current"
                onClick={disableCurrentRewriteBlock}
                disabled={rewriteCardsLocked || rewriteBusy}
              >
                Disable Current Block
              </button>
            ) : null}
          </div>
          <div className="rewrite-card-list">
            {rewriteAllCompleted ? renderRewriteCompleteCard() : rewriteCards.map((card) => renderRewriteCard(card))}
          </div>
        </section>
      );
    }

    return (
      <section className="workspace-mode-card workspace-mode-card--interactive">
        <h2>Practicing</h2>
        <article
          className="practice-card"
          data-workspace-wand-target="true"
          onMouseEnter={holdWorkspaceWand}
          onPointerEnter={holdWorkspaceWand}
          onFocus={holdWorkspaceWand}
        >
          <p>Write a replacement sentence and try a local placeholder response.</p>
          <textarea
            value={practiceInput}
            onChange={(event) => setPracticeInput(event.target.value)}
            placeholder="Type your replacement sentence..."
          />
          <button type="button" onMouseEnter={holdWorkspaceWand} onClick={tryPracticeResponse} disabled={practiceBusy}>
            {practiceBusy ? 'Thinking...' : 'Try Response'}
          </button>
        </article>
        <article
          className="practice-card practice-card--response"
          data-workspace-wand-target="true"
          onMouseEnter={holdWorkspaceWand}
          onPointerEnter={holdWorkspaceWand}
          onFocus={holdWorkspaceWand}
        >
          <span>View only</span>
          <p>{practiceResponse || 'Responses will appear here after the 5s placeholder delay.'}</p>
        </article>
      </section>
    );
  }

  if (view === 'home') {
    return (
      <HomePage
        onOpenWorkspace={openWorkspace}
      />
    );
  }

  if (view === 'workspace') {
    const documentTitle = selectedDocument?.title ?? 'Assignment 2: article 2';
    const recentDocuments = workspaceHistoryDocuments.length
      ? workspaceHistoryDocuments
      : workspaceHistoryFallback(selectedDocument);

    return (
      <main className={`document-workspace-page${workspaceSidebarOpen ? '' : ' is-sidebar-collapsed'}`}>
        <input
          ref={workspaceUploadInputRef}
          className="workspace-file-input"
          type="file"
          accept=".txt,.md,.docx"
          onChange={handleWorkspaceUploadInputChange}
        />
        <aside className="workspace-left-panel" aria-label="Document setup">
          <button
            type="button"
            className="workspace-sidebar-toggle-button"
            onClick={() => setWorkspaceSidebarOpen((value) => !value)}
          >
            {workspaceSidebarOpen ? '<' : '>'}
          </button>
          <div className="workspace-left-panel-content">
            <section className="workspace-upload-note">
              <p>Uploading creates a new document. Press Save before leaving to keep current edits.</p>
              <button type="button" onClick={() => workspaceUploadInputRef.current?.click()}>
                Upload New Document
              </button>
            </section>
            <AcademicStylePanel
              styleName={styleName}
              customStyle={styleSettings}
              onTemplateChange={handleTemplateChange}
              onCustomStyleChange={handleCustomStyleChange}
            />
            <HistorySelector
              documents={recentDocuments}
              expanded={workspaceHistoryExpanded}
              onSelect={openWorkspace}
              onViewAll={() => setWorkspaceHistoryExpanded((value) => !value)}
            />
          </div>
        </aside>

        <section className="workspace-paper-region" aria-label="Document editor">
          <div className="workspace-paper-header">
            <div>
              <span>{styleName}</span>
              <input
                className="workspace-title-input"
                value={documentTitle}
                onChange={(event) => handleWorkspaceTitleChange(event.target.value)}
                aria-label="Document title"
              />
            </div>
            <small>{workspaceNotice || (workspaceDirty ? 'Unsaved changes' : 'Ready')}</small>
            <button
              ref={mobileOptionsButtonRef}
              type="button"
              className={`home-sidebar-toggle workspace-mobile-options-button${mobileOptionsOpen ? ' is-open' : ''}`}
              onClick={() => setMobileOptionsOpen((value) => !value)}
              aria-label="Toggle workspace menu"
              aria-expanded={mobileOptionsOpen}
            >
              <span />
              <span />
              <span />
            </button>
            <button type="button" className="workspace-back-button" onClick={requestWorkspaceBack}>Back</button>
          </div>
          <DocumentEditor
            ref={documentEditorRef}
            key={`${selectedDocument?.id ?? 'document'}-${editorReloadKey}`}
            document={selectedDocument}
            styleSettings={styleSettings}
            onChange={handleEditorChange}
            onBlockStatusChange={handleEditorBlockStatusChange}
            onActiveBlockChange={handleActiveEditorBlockChange}
            onSave={() => saveWorkspaceDocument()}
            saveDisabled={!workspaceDirty}
            saving={workspaceSaving}
          />
        </section>

        <aside className="workspace-blackboard-panel" aria-label="Owl workspace panel" style={blackboardStyle}>
          <img className="blackboard__image" src={blackboardUrl} alt="" />
          <div className="workspace-blackboard-content">
            <div className="workspace-mode-switcher" role="tablist" aria-label="Workspace mode">
              {['analyzing', 'rewriting', 'practicing'].map((item) => (
                <button
                  key={item}
                  type="button"
                  className={workspaceMode === item ? 'is-active' : ''}
                  onClick={() => setWorkspaceMode(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            {renderWorkspaceMode()}
          </div>
          <div className="workspace-blackboard-owl">
            <OwlContainer
              variant="desktop"
              standby="random"
              onAnimatorReady={(animator) => {
                workspaceOwlAnimatorRef.current = animator;
              }}
              animation={{
                loading: workspaceOwlLoading,
                error: workspaceOwlError,
                errorKey: workspaceOwlErrorKey,
                trackPointer: true,
                magicClick: false,
              }}
            />
          </div>
        </aside>

        <div
          ref={mobileOwlRef}
          className={`workspace-mobile-owl-window${mobileOwlDragging ? ' is-dragging' : ''}`}
          style={mobileOwlStyle}
          onClick={handleMobileOwlClick}
          onPointerDown={mobileOwlHandlers.onPointerDown}
          onPointerMove={mobileOwlHandlers.onPointerMove}
          onPointerUp={handleMobileOwlPointerUp}
          onPointerCancel={mobileOwlHandlers.onPointerCancel}
        >
          <OwlContainer
            variant="mobile"
            standby="random"
            onAnimatorReady={(animator) => {
              mobileWorkspaceOwlAnimatorRef.current = animator;
            }}
            animation={{
              loading: workspaceOwlLoading,
              error: workspaceOwlError,
              errorKey: workspaceOwlErrorKey,
              trackPointer: true,
              magicClick: false,
            }}
          />
        </div>
        {mobileOwlOpen ? renderMobileAssistantPanel() : null}
        {mobileOptionsOpen ? renderMobileOptionsPanel(recentDocuments) : null}
        {showUnsavedBackPrompt ? (
          <div className="confirm-backdrop" role="presentation">
            <section className="confirm-modal unsaved-save-modal" role="dialog" aria-modal="true" aria-label="Save before leaving?">
              <h2>Save before leaving?</h2>
              <p>Your workspace has unsaved edits.</p>
              <div className="confirm-actions">
                <button type="button" onClick={() => setShowUnsavedBackPrompt(false)}>Cancel</button>
                <button type="button" onClick={leaveWorkspaceWithoutSaving}>Leave Without Saving</button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => saveWorkspaceDocument({ leaveAfterSave: true })}
                  disabled={workspaceSaving}
                >
                  {workspaceSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </main>
    );
  }

  const isLogin = mode === 'login';
  const isError = messageTone === 'error' && Boolean(message) && !loading;

  return (
    <main
      className="auth-page"
      style={{ backgroundImage: `url(${blackboardUrl})` }}
    >
      <section className="auth-board-content" aria-label="Authentication">
        <form className="chalk-auth-form" onSubmit={placeholderTest}>
          <div className="chalk-tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              className={`chalk-tab${isLogin ? ' is-active' : ''}`}
              aria-selected={isLogin}
              role="tab"
              onClick={() => switchMode('login')}
            >
              Login
            </button>
            <button
              type="button"
              className={`chalk-tab${!isLogin ? ' is-active' : ''}`}
              aria-selected={!isLogin}
              role="tab"
              onClick={() => switchMode('signup')}
            >
              Sign Up
            </button>
          </div>

          <input
            className="chalk-input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            aria-label="Email"
            autoComplete="email"
            disabled={loading}
          />

          <input
            className="chalk-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            aria-label="Password"
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            disabled={loading}
          />

          {message ? (
            <div className={`chalk-message chalk-message--${messageTone}`} role={isError ? 'alert' : 'status'}>
              {message}
            </div>
          ) : null}

          {isLogin && showForgot ? (
            <button type="button" className="chalk-forgot" onClick={handleResetPassword}>
              Forget Password?
            </button>
          ) : null}

          <button ref={submitButtonRef} type="submit" className="chalk-submit" disabled={loading}>
            {isLogin ? 'Login' : 'Sign Up'}
          </button>
        </form>
      </section>

      <section className="auth-owl-region" aria-label="Owl assistant">
        <div className="auth-owl-shell">
          <OwlContainer
            variant="desktop"
            standby="head-rotate"
            onAnimatorReady={(animator) => {
              owlAnimatorRef.current = animator;
            }}
            animation={{
              loading,
              error: isError,
              errorKey,
              magicTargets,
              magicClick: false,
              trackPointer: true,
            }}
          />
        </div>
      </section>
    </main>
  );
}
