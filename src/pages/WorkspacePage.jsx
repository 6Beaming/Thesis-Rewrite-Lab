import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import blackboardUrl from '../assets/blackboard.png';
import AcademicStylePanel, {
  DEFAULT_CUSTOM_STYLE,
  TEMPLATE_STYLE_SETTINGS,
} from '../components/AcademicStylePanel.jsx';
import DocumentEditor from '../components/DocumentEditor.jsx';
import HistorySelector from '../components/HistorySelector.jsx';
import MobileSidebarToggle from '../components/MobileSidebarToggle.jsx';
import OwlContainer from '../components/OwlContainer.jsx';
import { getBlackboardCssVars, getMobileContainerCssVars } from './libraries/animations/containerLayout.js';
import { useFloatingWindow } from './libraries/useFloatingWindow.js';
import {
  acceptDocumentBlockRewrite,
  analyzeDocumentBlock,
  generateDocumentBlockRewrites,
  getDocument,
  listDocuments,
  requestDocumentBlockPracticeFeedback,
  saveDocument,
  updateDocumentBlockStatus,
  uploadDocument,
} from '../services/documentsApi.js';
import HomePage from './HomePage.jsx';

const REGEN_COOLDOWN_MS = 10000;
const PRACTICE_MAX_CHARS = 4000;
const DEMO_STORE_KEY = 'project-thesis-rewriter:demo-store:v1';
const LAST_WORKSPACE_DOCUMENT_KEY = 'project-thesis-rewriter:last-workspace-document:v1';
const DEMO_BLOCK_STATUSES = new Set(['unprocessed', 'processing', 'processed', 'skipped']);
const ANALYSIS_FILTER_LABELS = {
  clarity: 'Clear and understandable',
  conciseness: 'Concise and direct',
  'academic-style': 'Academic and precise',
  flow: 'Logical flow',
};
const PRACTICE_SCORE_LABELS = {
  meaningPreservation: 'Meaning kept',
  clarity: 'Clarity',
  academicStyle: 'Academic style',
  grammar: 'Grammar',
};
const REWRITE_TONE_CARDS = Object.freeze([
  {
    id: 1,
    tone: 'formal-academic',
    title: 'Formal & Academic Tone',
    bestFor: 'Best for dissertations, peer-reviewed journals, and committee submissions.',
    focus: 'Objectivity, precise academic vocabulary, neutrality, and research-centered phrasing.',
  },
  {
    id: 2,
    tone: 'persuasive-argumentative',
    title: 'Persuasive & Argumentative Tone',
    bestFor: 'Best for thesis statements, proposals, and op-eds.',
    focus: 'Active verbs, strong reasoning, and the significance of the claim or findings.',
  },
  {
    id: 3,
    tone: 'accessible-concise',
    title: 'Accessible & Concise Tone',
    bestFor: 'Best for executive summaries, abstract overviews, and elevator pitches.',
    focus: 'Short sentences, active verbs, plain language, and no unnecessary filler.',
  },
]);

function createRewriteCards() {
  return REWRITE_TONE_CARDS.map((card) => ({
    ...card,
    rewriteId: null,
    response: '',
    explanation: '',
    changes: [],
    warnings: [],
    meaningPreserved: true,
    error: '',
    applyWithExplanation: false,
  }));
}

function resetRewriteCard(card) {
  return {
    ...card,
    rewriteId: null,
    response: '',
    explanation: '',
    changes: [],
    warnings: [],
    meaningPreserved: true,
    error: '',
    applyWithExplanation: false,
  };
}

function PanelChevron({ direction }) {
  const isLeft = direction === 'left';
  return (
    <svg className="workspace-mobile-card-arrow" viewBox="0 0 24 24" aria-hidden="true">
      <path d={isLeft ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
  );
}

function UploadDocIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5.5v8.5" />
      <path d="M8.75 8.75 12 5.5l3.25 3.25" />
      <path d="M6 16.75v1.1c0 .9.73 1.65 1.65 1.65h8.7c.92 0 1.65-.75 1.65-1.65v-1.1" />
      <path d="M8.4 15.75h7.2" />
    </svg>
  );
}

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

function readLastWorkspaceDocument() {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(window.sessionStorage.getItem(LAST_WORKSPACE_DOCUMENT_KEY) || 'null');
  } catch {
    return null;
  }
}

function rememberWorkspaceDocument(document) {
  if (typeof window === 'undefined' || !document?.id) return;
  window.sessionStorage.setItem(LAST_WORKSPACE_DOCUMENT_KEY, JSON.stringify({
    id: document.id,
    title: document.title,
    academic_style: document.academic_style,
    style_settings: document.style_settings,
  }));
}

function textFromDemoNode(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (!Array.isArray(node.content)) return '';
  return node.content.map(textFromDemoNode).join('');
}

function isEditableDemoBlock(node) {
  if (node?.type === 'blockSegment') return true;
  if (node?.type !== 'paragraph' && node?.type !== 'heading') return false;
  return !node.content?.some((child) => child?.type === 'blockSegment');
}

function normalizeRuntimeBlock(documentId, block, index, styleSettings = {}) {
  const text = block.text ?? block.text_content ?? '';
  const status = DEMO_BLOCK_STATUSES.has(block.status ?? block.attrs?.status)
    ? (block.status ?? block.attrs?.status)
    : 'unprocessed';
  const id = block.id ?? block.blockId ?? block.attrs?.blockId ?? `${documentId}-block-${index + 1}`;
  const attrs = demoAttrs(
    id,
    status,
    text.length,
    block.attrs ?? block.tiptap_node?.attrs ?? {},
    styleSettings
  );

  return {
    id,
    blockId: id,
    document_id: block.document_id ?? documentId,
    block_index: index,
    order: typeof block.order === 'number' ? block.order : index,
    node_type: block.type ?? block.node_type ?? block.tiptap_node?.type ?? 'paragraph',
    text,
    text_content: text,
    status,
    isEmpty: typeof block.isEmpty === 'boolean' ? block.isEmpty : !text.trim(),
    length: text.length,
    char_length: text.length,
    attrs,
    tiptap_node: block.tiptap_node ? {
      ...block.tiptap_node,
      attrs,
    } : null,
    contentIndex: block.contentIndex ?? null,
  };
}

function extractRuntimeBlocksFromContent(document, contentJson, styleSettings = {}) {
  const entries = [];
  let contentIndex = 0;

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (isEditableDemoBlock(node)) {
      const text = textFromDemoNode(node);
      const id = node.attrs?.blockId ?? `${document.id}-block-${entries.length + 1}`;
      const status = DEMO_BLOCK_STATUSES.has(node.attrs?.status) ? node.attrs.status : 'unprocessed';
      const attrs = demoAttrs(id, status, text.length, node.attrs ?? {}, styleSettings);
      entries.push({
        id,
        blockId: id,
        document_id: document.id,
        block_index: entries.length,
        order: entries.length,
        node_type: node.type,
        text,
        text_content: text,
        status,
        isEmpty: !text.trim(),
        length: text.length,
        char_length: text.length,
        attrs,
        tiptap_node: {
          ...node,
          attrs,
        },
        contentIndex,
      });
    }

    if (Array.isArray(node.content)) {
      node.content.forEach((child) => {
        contentIndex += 1;
        walk(child);
      });
    }
  }

  walk(contentJson);
  return entries;
}

function normalizeWorkspaceDraft(document, contentJson, blocks, styleSettings = {}, preferredProcessingBlockId = null) {
  const documentId = document?.id || 'workspace-document';
  const normalizedBlocks = (blocks ?? []).map((block, index) => normalizeRuntimeBlock(documentId, block, index, styleSettings));
  const eligibleBlocks = normalizedBlocks.filter((block) => !block.isEmpty);
  let processingBlockId = preferredProcessingBlockId && eligibleBlocks.some((block) => block.id === preferredProcessingBlockId)
    ? preferredProcessingBlockId
    : eligibleBlocks.find((block) => block.status === 'processing')?.id ?? null;

  if (!processingBlockId) {
    processingBlockId = eligibleBlocks.find((block) => block.status === 'unprocessed')?.id ?? null;
  }

  const nextBlocks = normalizedBlocks.map((block, index) => {
    let status = block.status;
    if (block.isEmpty && status === 'processing') {
      status = 'unprocessed';
    }
    if (!block.isEmpty) {
      if (processingBlockId && block.id === processingBlockId) {
        status = 'processing';
      } else if (status === 'processing') {
        status = 'unprocessed';
      }
    }

    const attrs = demoAttrs(block.id, status, block.text.length, block.attrs, styleSettings);
    return {
      ...block,
      block_index: index,
      order: typeof block.order === 'number' ? block.order : index,
      status,
      attrs,
      tiptap_node: block.tiptap_node ? {
        ...block.tiptap_node,
        attrs,
      } : block.tiptap_node,
    };
  });

  return {
    contentJson,
    blocks: nextBlocks,
    currentProcessingBlockId: processingBlockId ?? null,
    revision: Date.now(),
  };
}

function draftFromDocument(document, styleSettings = {}) {
  const contentJson = document?.content_json ?? fallbackWorkspaceContent(document, styleSettings);
  const sourceBlocks = Array.isArray(document?.blocks) && document.blocks.length
    ? document.blocks
    : extractRuntimeBlocksFromContent(document ?? { id: 'workspace-document' }, contentJson, styleSettings);

  return normalizeWorkspaceDraft(
    document,
    contentJson,
    sourceBlocks,
    styleSettings,
    document?.current_processing_block_id ?? sourceBlocks.find((block) => block.status === 'processing')?.id ?? null
  );
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

function documentFromWorkspaceDraft(document, draft, styleName, styleSettings) {
  const visibleBlocks = (draft?.blocks ?? []).filter((block) => !block.isEmpty);
  const totalChars = visibleBlocks.reduce((sum, block) => sum + block.char_length, 0);
  const completedChars = visibleBlocks
    .filter((block) => block.status === 'processed' || block.status === 'skipped')
    .reduce((sum, block) => sum + block.char_length, 0);

  return {
    ...document,
    academic_style: styleName,
    style_settings: styleSettings,
    snippet: visibleBlocks[0]?.text_content ?? document.snippet,
    secondarySnippet: visibleBlocks[1]?.text_content ?? document.secondarySnippet,
    content_json: draft?.contentJson ?? document.content_json,
    blocks: visibleBlocks.map((block, index) => ({
      ...block,
      block_index: index,
    })),
    current_processing_block_id: draft?.currentProcessingBlockId ?? null,
    completed_chars: completedChars,
    total_chars: totalChars,
    completed_rate: totalChars > 0 ? completedChars / totalChars : 0,
    updated_at: new Date().toISOString(),
  };
}

function demoDocumentFromContent(document, contentJson, styleName, styleSettings, blockSnapshots = null, preferredProcessingBlockId = null) {
  const draft = normalizeWorkspaceDraft(
    document,
    contentJson,
    blockSnapshots ?? extractRuntimeBlocksFromContent(document, contentJson, styleSettings),
    styleSettings,
    preferredProcessingBlockId
  );
  return documentFromWorkspaceDraft(document, draft, styleName, styleSettings);
}

function normalizeWorkspaceContent(document, contentJson, styleName, styleSettings, blockSnapshots = null, preferredProcessingBlockId = null) {
  if (!document || !contentJson) return { document, contentJson, draft: null };
  const draft = normalizeWorkspaceDraft(
    document,
    contentJson,
    blockSnapshots ?? extractRuntimeBlocksFromContent(document, contentJson, styleSettings),
    styleSettings,
    preferredProcessingBlockId
  );
  const normalizedDocument = documentFromWorkspaceDraft(document, draft, styleName, styleSettings);
  return {
    document: normalizedDocument,
    contentJson: normalizedDocument.content_json,
    draft,
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
  const location = useLocation();
  const navigate = useNavigate();
  const [view, setView] = useState(() => (
    location.pathname === '/worksapce' ? 'workspace' : 'home'
  ));
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [showUnsavedBackPrompt, setShowUnsavedBackPrompt] = useState(false);
  const [editorReloadKey, setEditorReloadKey] = useState(0);
  const [workspaceDraft, setWorkspaceDraft] = useState(null);
  const [workspaceSidebarOpen, setWorkspaceSidebarOpen] = useState(true);
  const [workspaceMode, setWorkspaceMode] = useState('analyzing');
  const [workspaceOwlLoading, setWorkspaceOwlLoading] = useState(false);
  const [workspaceOwlError, setWorkspaceOwlError] = useState(false);
  const [workspaceOwlErrorKey, setWorkspaceOwlErrorKey] = useState(0);
  const [styleName, setStyleName] = useState('APA');
  const [styleSettings, setStyleSettings] = useState(TEMPLATE_STYLE_SETTINGS.APA);
  const [editorContent, setEditorContent] = useState(null);
  const [activeEditorBlock, setActiveEditorBlock] = useState({ blockId: null, status: 'unprocessed' });
  const [rewriteCards, setRewriteCards] = useState(createRewriteCards);
  const [rewriteCardsLocked, setRewriteCardsLocked] = useState(false);
  const [rewriteAllCompleted, setRewriteAllCompleted] = useState(false);
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [rewriteError, setRewriteError] = useState('');
  const [rewriteCooldownUntil, setRewriteCooldownUntil] = useState(0);
  const [practiceInput, setPracticeInput] = useState('');
  const [practiceFeedback, setPracticeFeedback] = useState(null);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [practiceError, setPracticeError] = useState('');
  const [mobileOwlOpen, setMobileOwlOpen] = useState(false);
  const [mobilePanelMode, setMobilePanelMode] = useState('rewriting');
  const [mobileRewriteIndex, setMobileRewriteIndex] = useState(0);
  const [mobilePracticeIndex, setMobilePracticeIndex] = useState(0);
  const [mobileOptionsOpen, setMobileOptionsOpen] = useState(false);
  const [mobileOptionsTab, setMobileOptionsTab] = useState('setup');
  const [workspaceHistoryDocuments, setWorkspaceHistoryDocuments] = useState([]);
  const [workspaceHistoryExpanded, setWorkspaceHistoryExpanded] = useState(false);
  const [analysisFilters, setAnalysisFilters] = useState({
    clarity: true,
    conciseness: true,
    'academic-style': true,
    flow: true,
  });
  const [blockAnalyses, setBlockAnalyses] = useState({});
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const workspaceOwlAnimatorRef = useRef(null);
  const mobileWorkspaceOwlAnimatorRef = useRef(null);
  const documentEditorRef = useRef(null);
  const mobileDragEndedAtRef = useRef(0);
  const rewriteRefreshTimerRef = useRef(null);
  const rewriteContextKeyRef = useRef('');
  const practiceContextKeyRef = useRef('');
  const wandHoverTimerRef = useRef(null);
  const workspaceUploadInputRef = useRef(null);
  const mobileOptionsPanelRef = useRef(null);
  const mobileOptionsButtonRef = useRef(null);
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
  const selectedAnalysisFilters = useMemo(() => (
    Object.entries(analysisFilters)
      .filter(([, enabled]) => enabled)
      .map(([filter]) => filter)
      .sort()
  ), [analysisFilters]);
  const currentAnalysisKey = useMemo(() => (
    activeEditorBlock?.blockId
      ? `${activeEditorBlock.blockId}|${activeEditorBlock.text ?? ''}|${selectedAnalysisFilters.join(',')}`
      : ''
  ), [activeEditorBlock?.blockId, activeEditorBlock?.text, selectedAnalysisFilters]);
  const currentBlockAnalysis = currentAnalysisKey ? blockAnalyses[currentAnalysisKey] ?? null : null;
  const currentRewriteBlockId = activeEditorBlock?.blockId
    ?? workspaceDraft?.currentProcessingBlockId
    ?? null;
  const currentRewriteBlock = workspaceDraft?.blocks?.find((block) => block.id === currentRewriteBlockId)
    ?? null;
  const currentRewriteKey = selectedDocument?.id && currentRewriteBlockId
    ? `${selectedDocument.id}|${currentRewriteBlockId}|${currentRewriteBlock?.text ?? ''}`
    : '';
  rewriteContextKeyRef.current = currentRewriteKey;
  const currentPracticeKey = selectedDocument?.id && activeEditorBlock?.blockId
    ? `${selectedDocument.id}|${activeEditorBlock.blockId}|${activeEditorBlock.text ?? ''}`
    : '';
  const currentPracticeRequestKey = `${currentPracticeKey}|${practiceInput}`;
  practiceContextKeyRef.current = currentPracticeRequestKey;

  useEffect(() => {
    setAnalysisError('');
  }, [currentAnalysisKey]);

  useEffect(() => {
    setRewriteError('');
    setRewriteCards(createRewriteCards());
  }, [currentRewriteKey]);

  useEffect(() => {
    setPracticeInput('');
    setPracticeFeedback(null);
    setPracticeError('');
    setMobilePracticeIndex(0);
  }, [currentPracticeKey]);

  useEffect(() => () => {
    if (rewriteRefreshTimerRef.current) {
      clearTimeout(rewriteRefreshTimerRef.current);
    }
    if (wandHoverTimerRef.current) {
      clearTimeout(wandHoverTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (location.pathname !== '/worksapce') {
      setView('home');
      return undefined;
    }

    setView('workspace');
    if (selectedDocument) return undefined;

    const rememberedDocument = readLastWorkspaceDocument();
    if (rememberedDocument) {
      openWorkspace(rememberedDocument, { updateRoute: false });
      return undefined;
    }

    let alive = true;
    listDocuments({ sort: 'most_recent' })
      .then((data) => {
        if (!alive) return;
        const document = data.documents?.[0] ?? workspaceHistoryFallback(null)[0];
        openWorkspace(document, { updateRoute: false });
      })
      .catch(() => {
        if (!alive) return;
        openWorkspace(workspaceHistoryFallback(null)[0], { updateRoute: false });
      });

    return () => {
      alive = false;
    };
  }, [location.pathname]);

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

  useEffect(() => {
    if (view !== 'workspace' || !selectedDocument?.id || selectedDocument.id.startsWith('demo-')) {
      return undefined;
    }

    let alive = true;
    getDocument(selectedDocument.id)
      .then(({ document }) => {
        if (!alive) return;
        const nextStyleName = document.academic_style || 'APA';
        const nextStyleSettings = {
          ...(TEMPLATE_STYLE_SETTINGS[nextStyleName] ?? DEFAULT_CUSTOM_STYLE),
          ...(document.style_settings ?? {}),
        };
        const nextDraft = draftFromDocument(document, nextStyleSettings);
        setWorkspaceDraft(nextDraft);
        setSelectedDocument(documentFromWorkspaceDraft(document, nextDraft, nextStyleName, nextStyleSettings));
        setStyleName(nextStyleName);
        setStyleSettings(nextStyleSettings);
        setEditorContent(nextDraft.contentJson);
        setEditorReloadKey((value) => value + 1);
      })
      .catch(() => {
        if (alive) setWorkspaceNotice('');
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

  function openWorkspace(document, { updateRoute = true } = {}) {
    const hydratedDocument = hydrateWorkspaceDocument(document);
    if (!hydratedDocument) return;

    const nextStyleName = hydratedDocument?.academic_style || 'APA';
    const nextStyleSettings = {
      ...(TEMPLATE_STYLE_SETTINGS[nextStyleName] ?? DEFAULT_CUSTOM_STYLE),
      ...(hydratedDocument?.style_settings ?? {}),
    };
    const nextDraft = draftFromDocument(hydratedDocument, nextStyleSettings);

    setWorkspaceDraft(nextDraft);
    setSelectedDocument(documentFromWorkspaceDraft(hydratedDocument, nextDraft, nextStyleName, nextStyleSettings));
    setEditorContent(nextDraft.contentJson ?? null);
    setActiveEditorBlock({
      blockId: nextDraft.currentProcessingBlockId ?? null,
      status: nextDraft.currentProcessingBlockId ? 'processing' : 'unprocessed',
    });
    setEditorReloadKey((value) => value + 1);
    setStyleName(nextStyleName);
    setStyleSettings(nextStyleSettings);
    setWorkspaceDirty(false);
    setWorkspaceNotice('');
    setBlockAnalyses({});
    setAnalysisError('');
    setRewriteCardsLocked(false);
    setRewriteAllCompleted(false);
    setRewriteCards((cards) => cards.map(resetRewriteCard));
    setRewriteError('');
    setPracticeInput('');
    setPracticeFeedback(null);
    setPracticeError('');
    setMobilePracticeIndex(0);
    setWorkspaceHistoryExpanded(false);
    rememberWorkspaceDocument(hydratedDocument);
    setView('workspace');
    if (updateRoute && location.pathname !== '/worksapce') {
      navigate('/worksapce');
    }
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

  function handleEditorChange(change) {
    const payload = change && typeof change === 'object' && 'contentJson' in change
      ? change
      : { contentJson: change };
    const normalized = normalizeWorkspaceContent(
      selectedDocument,
      payload.contentJson,
      styleName,
      styleSettings,
      payload.blocks ?? workspaceDraft?.blocks ?? null,
      payload.currentProcessingBlockId ?? workspaceDraft?.currentProcessingBlockId ?? null
    );
    setWorkspaceDraft(normalized.draft);
    setEditorContent(normalized.contentJson ?? payload.contentJson);
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
      current?.blockId === nextInfo.blockId
      && current?.status === nextInfo.status
      && current?.originalStatus === nextInfo.originalStatus
      && current?.text === nextInfo.text
        ? current
        : nextInfo
    ));
  }, []);

  function normalizedWorkspaceDocument() {
    if (!selectedDocument) return null;
    if (workspaceDraft?.contentJson) {
      return documentFromWorkspaceDraft(selectedDocument, workspaceDraft, styleName, styleSettings);
    }
    const fallbackDraft = draftFromDocument(selectedDocument, styleSettings);
    return documentFromWorkspaceDraft(selectedDocument, fallbackDraft, styleName, styleSettings);
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
        setWorkspaceDraft(draftFromDocument(document, styleSettings));
        setWorkspaceNotice('Saved locally');
      } else {
        const result = await saveDocument(document.id, {
          title: document.title,
          academicStyle: styleName,
          styleSettings,
          contentJson: document.content_json,
          createVersion: true,
          versionLabel: 'Manual save',
        });
        const persistedDocument = result.document ?? document;
        const persistedDraft = draftFromDocument(persistedDocument, styleSettings);
        setWorkspaceDraft(persistedDraft);
        setSelectedDocument(documentFromWorkspaceDraft(persistedDocument, persistedDraft, styleName, styleSettings));
        setEditorContent(persistedDraft.contentJson ?? document.content_json);
        setWorkspaceNotice('Saved');
      }

      setWorkspaceDirty(false);
      setShowUnsavedBackPrompt(false);
      if (leaveAfterSave) {
        setView('home');
        navigate('/');
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
    navigate('/');
  }

  function leaveWorkspaceWithoutSaving() {
    setShowUnsavedBackPrompt(false);
    setWorkspaceDirty(false);
    setView('home');
    navigate('/');
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
    setRewriteCards((cards) => cards.map(resetRewriteCard));
    setRewriteError('');
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

  async function analyzeActiveBlock() {
    const documentId = selectedDocument?.id;
    const blockId = activeEditorBlock?.blockId;
    if (!documentId || !blockId) {
      setAnalysisError('Select a text block to analyze.');
      return;
    }
    if (documentId.startsWith('demo-')) {
      setAnalysisError('Save this document to the backend before using AI analysis.');
      return;
    }
    if (!selectedAnalysisFilters.length) {
      setAnalysisError('Select at least one analysis filter.');
      return;
    }
    if (analysisBusy) return;

    const requestKey = currentAnalysisKey;
    setAnalysisBusy(true);
    setAnalysisError('');
    setWorkspaceNotice('');
    setWorkspaceOwlError(false);
    setWorkspaceOwlLoading(true);

    try {
      if (workspaceDirty) {
        const saved = await saveWorkspaceDocument();
        if (!saved) return;
      }

      const response = await analyzeDocumentBlock(documentId, blockId, selectedAnalysisFilters);
      setBlockAnalyses((current) => ({
        ...current,
        [requestKey]: response.analysis,
      }));
      setWorkspaceNotice(response.cached ? 'Loaded saved block analysis.' : 'Block analysis complete.');
    } catch (error) {
      setAnalysisError(error.message || 'AI analysis is temporarily unavailable.');
      triggerWorkspaceError();
    } finally {
      setAnalysisBusy(false);
      setWorkspaceOwlLoading(false);
    }
  }

  async function handleEditorBlockStatusChange({ blockId, status }) {
    const payload = arguments[0] ?? {};
    const nextDocument = payload.contentJson && selectedDocument
      ? demoDocumentFromContent(
        selectedDocument,
        payload.contentJson,
        styleName,
        styleSettings,
        payload.blocks ?? workspaceDraft?.blocks ?? null,
        payload.currentProcessingBlockId ?? workspaceDraft?.currentProcessingBlockId ?? null
      )
      : null;
    const nextDraft = payload.contentJson && selectedDocument
      ? normalizeWorkspaceDraft(
        selectedDocument,
        payload.contentJson,
        payload.blocks ?? workspaceDraft?.blocks ?? [],
        styleSettings,
        payload.currentProcessingBlockId ?? workspaceDraft?.currentProcessingBlockId ?? null
      )
      : null;

    if (nextDocument && nextDraft) {
      setWorkspaceDraft(nextDraft);
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
      if (status !== 'processing') {
        setWorkspaceNotice(`Marked block as ${status}.`);
      }
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

  async function generateRewrites({ tone, force = false }) {
    const documentId = selectedDocument?.id;
    const blockId = currentRewriteBlockId;
    if (!documentId || !blockId) {
      setRewriteError('Select a text block to rewrite.');
      return;
    }
    if (documentId.startsWith('demo-')) {
      setRewriteError('Save this document to the backend before using AI rewriting.');
      return;
    }
    if (rewriteCardsLocked || rewriteAllCompleted || rewriteBusy) return;

    const requestKey = currentRewriteKey;
    setRewriteBusy(true);
    setRewriteError('');
    setWorkspaceNotice('');
    setWorkspaceOwlError(false);
    setWorkspaceOwlLoading(true);

    try {
      if (workspaceDirty) {
        const saved = await saveWorkspaceDocument();
        if (!saved) return;
      }

      const response = await generateDocumentBlockRewrites(documentId, blockId, { tone, force });
      if (rewriteContextKeyRef.current !== requestKey) return;

      setRewriteCards((cards) => cards.map((card) => {
        const option = response.rewrites.find((rewrite) => rewrite.tone === card.tone);
        if (!option) return card;
        return {
          ...card,
          rewriteId: option.id,
          response: option.rewrittenText,
          explanation: option.explanation,
          changes: option.changes ?? [],
          warnings: option.warnings ?? [],
          meaningPreserved: option.meaningPreserved,
          error: '',
          applyWithExplanation: false,
        };
      }));
      setWorkspaceNotice(response.cached ? 'Loaded the saved rewrite.' : 'Rewrite is ready.');
    } catch (error) {
      setRewriteError(error.message || 'AI rewriting is temporarily unavailable.');
      triggerWorkspaceError();
    } finally {
      setWorkspaceOwlLoading(false);
      setRewriteBusy(false);
    }
  }

  async function regenerateRewriteCard(cardId) {
    if (rewriteCardsLocked || rewriteAllCompleted) return;
    const now = Date.now();
    if (now < rewriteCooldownUntil) {
      setWorkspaceNotice('Regeneration is cooling down. Please wait a moment.');
      return;
    }
    if (rewriteBusy) {
      setWorkspaceNotice('A regeneration is already running.');
      return;
    }
    const card = rewriteCards.find((item) => item.id === cardId);
    if (!card) return;
    setRewriteCooldownUntil(now + REGEN_COOLDOWN_MS);
    await generateRewrites({ tone: card.tone, force: Boolean(card.response) });
  }

  async function handleRewriteCardClick(card, event) {
    if (
      rewriteCardsLocked
      || rewriteAllCompleted
      || rewriteBusy
      || !card.rewriteId
      || !card.response
      || !card.meaningPreserved
    ) return;
    setRewriteBusy(true);
    setRewriteError('');
    try {
      await acceptDocumentBlockRewrite(selectedDocument.id, currentRewriteBlockId, card.rewriteId);
    } catch (error) {
      setRewriteError(error.message || 'The rewrite could not be applied.');
      triggerWorkspaceError();
      setRewriteBusy(false);
      return;
    }
    await runWorkspaceMagic(event.currentTarget);
    applyRewriteCard(card);
    setRewriteBusy(false);
  }

  function resetRewriteCardsForNextBlock(nextNotice = 'Cards refreshed for the next processing block.') {
    if (rewriteRefreshTimerRef.current) {
      clearTimeout(rewriteRefreshTimerRef.current);
    }

    rewriteRefreshTimerRef.current = setTimeout(() => {
      setRewriteCards((cards) => cards.map(resetRewriteCard));
      setRewriteError('');
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

  function applyStatusToSelectedBlock(nextStatus, replacementText = null) {
    if (!selectedDocument) return null;

    const nextSnapshot = documentEditorRef.current?.applyCurrentBlockStatus({
      status: nextStatus,
      replacementText,
      targetBlockId: activeEditorBlock?.blockId ?? workspaceDraft?.currentProcessingBlockId ?? null,
    });
    if (nextSnapshot?.contentJson) {
      const normalized = normalizeWorkspaceContent(
        selectedDocument,
        nextSnapshot.contentJson,
        styleName,
        styleSettings,
        nextSnapshot.blocks,
        nextSnapshot.currentProcessingBlockId
      );
      const document = normalized.document;
      setWorkspaceDraft(normalized.draft);
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
    const normalized = normalizeWorkspaceContent(
      selectedDocument,
      rawSourceContent,
      styleName,
      styleSettings,
      workspaceDraft?.blocks ?? null,
      workspaceDraft?.currentProcessingBlockId ?? null
    );
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

    const nextDraft = normalizeWorkspaceDraft(
      sourceDocument,
      nextContent,
      workspaceDraft?.blocks ?? normalized.draft?.blocks ?? [],
      styleSettings,
      activeEditorBlock?.blockId ?? normalized.draft?.currentProcessingBlockId ?? null
    );
    const document = documentFromWorkspaceDraft(sourceDocument, nextDraft, styleName, styleSettings);
    setWorkspaceDraft(nextDraft);
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
    if (!card.response) return;
    const document = applyStatusToSelectedBlock('processed', card.response);
    if (document) {
      lockOrCompleteRewriteCards(document, `${card.title} applied. Cards refreshed for the next block.`);
    }
  }

  function toggleRewriteExplanation(cardId) {
    setRewriteCards((cards) => cards.map((card) => (
      card.id === cardId ? { ...card, applyWithExplanation: !card.applyWithExplanation } : card
    )));
  }

  async function tryPracticeResponse(event, { showMobileFeedback = false } = {}) {
    const target = event.currentTarget;
    const documentId = selectedDocument?.id;
    const blockId = activeEditorBlock?.blockId;
    const attemptText = practiceInput.trim();

    if (!documentId || !blockId) {
      setPracticeError('Select a text block before starting practice.');
      return;
    }
    if (documentId.startsWith('demo-')) {
      setPracticeError('Save this document to the backend before using AI practice.');
      return;
    }
    if (!attemptText) {
      setPracticeError('Write your own revision before requesting feedback.');
      return;
    }
    if (practiceBusy) return;

    const requestKey = currentPracticeRequestKey;
    setPracticeBusy(true);
    setPracticeFeedback(null);
    setPracticeError('');
    setWorkspaceNotice('');
    setWorkspaceOwlError(false);
    setWorkspaceOwlLoading(true);
    if (showMobileFeedback) setMobilePracticeIndex(1);
    void runWorkspaceMagic(target);

    try {
      if (workspaceDirty) {
        const saved = await saveWorkspaceDocument();
        if (!saved) {
          setPracticeError('Save the current document before requesting AI feedback.');
          return;
        }
      }

      const response = await requestDocumentBlockPracticeFeedback(documentId, blockId, attemptText);
      if (practiceContextKeyRef.current !== requestKey) return;

      setPracticeFeedback(response.practice);
      setWorkspaceNotice(response.cached ? 'Loaded saved practice feedback.' : 'Practice feedback is ready.');
    } catch (error) {
      if (practiceContextKeyRef.current !== requestKey) return;
      setPracticeError(error.message || 'AI practice feedback is temporarily unavailable.');
      triggerWorkspaceError();
    } finally {
      setWorkspaceOwlLoading(false);
      setPracticeBusy(false);
    }
  }

  function handlePracticeInputChange(event) {
    setPracticeInput(event.target.value);
    setPracticeFeedback(null);
    setPracticeError('');
  }

  function renderPracticeComposer({ mobile = false } = {}) {
    const learningGoals = currentBlockAnalysis?.ai?.learningGoals ?? [];

    return (
      <article
        className="practice-card practice-card--composer"
        data-workspace-wand-target="true"
        onMouseEnter={holdWorkspaceWand}
        onPointerEnter={holdWorkspaceWand}
        onFocus={holdWorkspaceWand}
      >
        <div className="practice-card-heading">
          <strong>Your revision</strong>
          <span>{practiceInput.length} / {PRACTICE_MAX_CHARS}</span>
        </div>
        <div className="practice-goals">
          <strong>Practice goals from analysis</strong>
          <ul>
            {learningGoals.length
              ? learningGoals.map((goal) => <li key={goal}>{goal}</li>)
              : <li>Analyze this block first to get targeted practice goals.</li>}
          </ul>
        </div>
        <textarea
          value={practiceInput}
          onChange={handlePracticeInputChange}
          maxLength={PRACTICE_MAX_CHARS}
          aria-label="Your practice revision"
          placeholder="Rewrite the selected block in your own words..."
        />
        {practiceError ? <p className="practice-error" role="alert">{practiceError}</p> : null}
        <button
          type="button"
          onMouseEnter={holdWorkspaceWand}
          onClick={mobile ? handleMobilePracticeTry : tryPracticeResponse}
          disabled={practiceBusy || !activeEditorBlock?.blockId || !practiceInput.trim()}
        >
          {practiceBusy ? 'Reviewing...' : 'Get AI feedback'}
        </button>
      </article>
    );
  }

  function renderPracticeFeedback({ mobile = false } = {}) {
    const feedback = practiceFeedback;
    const originalScores = feedback?.scores?.original ?? {};
    const revisionScores = feedback?.scores?.revision ?? {};

    return (
      <article
        className={`practice-card practice-card--response${feedback?.readyToApply ? ' is-ready' : ''}`}
        data-workspace-wand-target="true"
        onMouseEnter={holdWorkspaceWand}
        onPointerEnter={holdWorkspaceWand}
        onFocus={holdWorkspaceWand}
        aria-live="polite"
      >
        <div className="practice-card-heading">
          <strong>AI coaching</strong>
          {feedback ? (
            <span className={feedback.readyToApply ? 'is-ready' : 'needs-revision'}>
              {feedback.readyToApply ? 'Ready for review' : 'Revise and retry'}
            </span>
          ) : null}
        </div>
        {practiceBusy ? <p className="practice-feedback-empty">Reviewing your revision...</p> : null}
        {!practiceBusy && mobile && practiceError ? <p className="practice-error" role="alert">{practiceError}</p> : null}
        {!practiceBusy && !practiceError && !feedback ? (
          <p className="practice-feedback-empty">Submit your own revision to receive coaching.</p>
        ) : null}
        {feedback ? (
          <>
            <p className="practice-feedback-summary">{feedback.summary}</p>
            <div className="practice-score-table">
              <table aria-label="Original and revision score comparison">
                <thead>
                  <tr>
                    <th scope="col">Measure</th>
                    <th scope="col">Original</th>
                    <th scope="col">Yours</th>
                    <th scope="col">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(PRACTICE_SCORE_LABELS).map(([key, label]) => {
                    const originalScore = originalScores[key] ?? 0;
                    const revisionScore = revisionScores[key] ?? 0;
                    const difference = revisionScore - originalScore;
                    const changeClass = difference > 0
                      ? 'is-improved'
                      : difference < 0 ? 'is-lower' : 'is-same';

                    return (
                      <tr key={key}>
                        <th scope="row">{label}</th>
                        <td>{originalScore}</td>
                        <td>{revisionScore}</td>
                        <td className={`practice-score-change ${changeClass}`}>
                          {difference > 0 ? `+${difference}` : difference}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <section className="practice-feedback-section">
              <h3>What you did well</h3>
              {feedback.strengths?.length ? (
                <ul>
                  {feedback.strengths.map((strength) => <li key={strength}>{strength}</li>)}
                </ul>
              ) : (
                <p>No clear improvement from the original yet.</p>
              )}
            </section>
            <section className="practice-feedback-section">
              <h3>Hints for your next revision</h3>
              {feedback.hints?.length ? (
                <div className="practice-hint-list">
                  {feedback.hints.map((hint, index) => (
                    <article className={`practice-hint priority-${hint.priority}`} key={`${hint.issue}-${index}`}>
                      <div>
                        <strong>{hint.issue}</strong>
                        <span>{hint.priority}</span>
                      </div>
                      <p>{hint.explanation}</p>
                      <p className="practice-try"><strong>Try:</strong> <q>{hint.suggestedPhrase}</q></p>
                    </article>
                  ))}
                </div>
              ) : (
                <p>No substantial issues were identified.</p>
              )}
            </section>
            <div className="practice-next-step">
              <strong>Next step</strong>
              <p>{feedback.nextStep}</p>
            </div>
            {mobile ? (
              <button type="button" onClick={() => setMobilePracticeIndex(0)}>Revise my attempt</button>
            ) : null}
          </>
        ) : null}
      </article>
    );
  }

  function renderRewriteCard(card) {
    return (
      <article
        key={card.id}
        className={`rewrite-card${card.error ? ' has-error' : ''}${rewriteCardsLocked ? ' is-locked' : ''}${card.meaningPreserved === false ? ' is-unsafe' : ''}`}
        data-workspace-wand-target="true"
        onMouseEnter={holdWorkspaceWand}
        onPointerEnter={holdWorkspaceWand}
        onFocus={holdWorkspaceWand}
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
            {card.response ? 'Regenerate' : 'Generate'}
          </button>
        </div>
        <p className="rewrite-card-best-for">{card.bestFor}</p>
        <p className="rewrite-card-focus"><strong>Focus:</strong> {card.focus}</p>
        {card.error ? <p className="rewrite-card-error">{card.error}</p> : null}
        {card.response ? (
          <>
            <p className="rewrite-card-response">{card.response}</p>
            {card.warnings.length ? (
              <ul className="rewrite-card-warnings">
                {card.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            ) : null}
            <div className="rewrite-card-actions">
              <button type="button" onClick={() => toggleRewriteExplanation(card.id)}>
                {card.applyWithExplanation ? 'Hide explanation' : 'Why this works'}
              </button>
              <button
                type="button"
                className="rewrite-card-apply"
                onClick={(event) => handleRewriteCardClick(card, event)}
                disabled={rewriteBusy || rewriteCardsLocked || !card.meaningPreserved}
              >
                Use this rewrite
              </button>
            </div>
            {card.applyWithExplanation ? (
              <div className="rewrite-card-explanation">
                <p>{card.explanation}</p>
                <ul>
                  {card.changes.map((change) => <li key={change}>{change}</li>)}
                </ul>
              </div>
            ) : null}
            {!card.meaningPreserved ? (
              <p className="rewrite-card-safety">This option is disabled because the model could not preserve the original meaning safely.</p>
            ) : null}
          </>
        ) : (
          <p className="rewrite-card-empty">Generate this tone to create a rewrite for the selected block.</p>
        )}
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
    tryPracticeResponse(event, { showMobileFeedback: true });
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
            {rewriteAllCompleted ? (
              renderRewriteCompleteCard()
            ) : (
              <>
                <div className="workspace-mobile-card-nav">
                  <button type="button" onClick={() => moveMobileRewrite(-1)} aria-label="Previous rewriting card">
                    <PanelChevron direction="left" />
                  </button>
                  <span>{mobileRewriteIndex + 1} / {rewriteCards.length}</span>
                  <button type="button" onClick={() => moveMobileRewrite(1)} aria-label="Next rewriting card">
                    <PanelChevron direction="right" />
                  </button>
                </div>
                {rewriteError ? <p className="rewrite-panel-error" role="alert">{rewriteError}</p> : null}
                {currentRewriteCard ? renderRewriteCard(currentRewriteCard) : null}
              </>
            )}
          </div>
        ) : (
          <div className="workspace-mobile-panel-body">
            <div className="workspace-mobile-card-nav">
              <button type="button" onClick={() => moveMobilePractice(-1)} aria-label="Previous practice card">
                <PanelChevron direction="left" />
              </button>
              <span>{mobilePracticeIndex + 1} / 2</span>
              <button type="button" onClick={() => moveMobilePractice(1)} aria-label="Next practice card">
                <PanelChevron direction="right" />
              </button>
            </div>
            {mobilePracticeIndex === 0
              ? renderPracticeComposer({ mobile: true })
              : renderPracticeFeedback({ mobile: true })}
          </div>
        )}
      </section>
    );
  }

  function renderAnalysisStats() {
    const analysis = currentBlockAnalysis;
    const metrics = analysis?.deterministic;
    const ai = analysis?.ai;
    const sourceLookup = ai?.sourceLookup;
    const filterCounts = Object.fromEntries(Object.keys(ANALYSIS_FILTER_LABELS).map((key) => [
      key,
      ai?.issues?.filter((issue) => issue.type === key).length ?? null,
    ]));

    return (
      <>
        <div className="analysis-selected-block">
          <span>Selected block</span>
          <p>{activeEditorBlock?.text || 'Click a text block in the editor.'}</p>
        </div>

        <div className="analysis-filter-list">
          {Object.entries(ANALYSIS_FILTER_LABELS).map(([key, label]) => (
            <label key={key} className="analysis-filter-row">
              <input
                type="checkbox"
                checked={analysisFilters[key]}
                onChange={() => {
                  setAnalysisFilters((current) => ({
                    ...current,
                    [key]: !current[key],
                  }));
                }}
              />
              <span>{label}</span>
              <span className="analysis-filter-count">{filterCounts[key] ?? '—'}</span>
            </label>
          ))}
        </div>

        <button
          type="button"
          className="analysis-run-button"
          onClick={analyzeActiveBlock}
          disabled={analysisBusy || !activeEditorBlock?.blockId || !selectedAnalysisFilters.length}
        >
          {analysisBusy ? 'Analyzing block...' : analysis ? 'Analyze again' : 'Analyze selected block'}
        </button>

        {analysisError ? <p className="analysis-error" role="alert">{analysisError}</p> : null}

        {analysis ? (
          <>
            <div className="analysis-result-heading">
              <strong>{ai.summary}</strong>
              <span>{ai.purpose} · {analysis.model}</span>
            </div>

            <div className="analysis-stat-grid">
              <div className="analysis-stat-card">
                <strong>{metrics.wordCount}</strong>
                <span>Words</span>
              </div>
              <div className="analysis-stat-card">
                <strong>{metrics.averageSentenceLength}</strong>
                <span>Avg. sentence length</span>
              </div>
              <div className="analysis-stat-card">
                <strong>{metrics.sentenceCount}</strong>
                <span>Sentences</span>
              </div>
              <div className="analysis-stat-card">
                <strong>{metrics.characterCount}</strong>
                <span>Characters</span>
              </div>
            </div>

            {sourceLookup && sourceLookup.status !== 'not-needed' ? (
              <section className="analysis-source-lookup">
                <div className="analysis-source-lookup-heading">
                  <h3>External source check</h3>
                  <span>MCP · Crossref</span>
                </div>

                {sourceLookup.items?.length ? (
                  <ul>
                    {sourceLookup.items.map((source) => (
                      <li key={source.doi}>
                        <strong>{source.title}</strong>
                        <span>
                          {[
                            source.authors?.join(', '),
                            source.publishedYear,
                            source.containerTitle,
                          ].filter(Boolean).join(' · ') || 'Bibliographic metadata'}
                        </span>
                        <code>{source.doi}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Crossref could not be reached. Analysis continued without external metadata.</p>
                )}

                {sourceLookup.status === 'partial' ? (
                  <small>Some DOI records could not be retrieved.</small>
                ) : null}
              </section>
            ) : null}

            <dl className="analysis-stats">
              {Object.entries(ai.scores).map(([label, score], index) => (
                <div className="analysis-score-row" key={label}>
                  <div>
                    <dt>{label}</dt>
                    <dd>{score}%</dd>
                  </div>
                  <div className="analysis-bar-track">
                    <div
                      className={`analysis-bar-fill${index === 0 ? ' analysis-bar-fill--green' : ''}`}
                      style={{ width: `${score}%` }}
                    />
                  </div>
                </div>
              ))}
            </dl>

            <div className="analysis-issue-list">
              <h3>Coaching notes</h3>
              {ai.issues.length ? ai.issues.map((issue, index) => (
                <article key={`${issue.type}-${index}`} className={`analysis-issue analysis-issue--${issue.severity}`}>
                  <div><strong>{ANALYSIS_FILTER_LABELS[issue.type]}</strong><span>{issue.severity}</span></div>
                  <q>{issue.evidence}</q>
                  <p>{issue.explanation}</p>
                  <small>{issue.suggestion}</small>
                </article>
              )) : <p>No selected issues were found in this block.</p>}
            </div>

            <div className="analysis-learning-goals">
              <h3>Practice goals</h3>
              <ul>
                {ai.learningGoals.map((goal) => <li key={goal}>{goal}</li>)}
              </ul>
            </div>
          </>
        ) : (
          <div className="analysis-empty-result">
            Analysis uses this block and its immediate neighbors. The full paper is not sent.
          </div>
        )}
      </>
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
              <p>Upload a new document. Save current edits before leaving.</p>
              <button type="button" className="home-upload workspace-upload-button" onClick={() => workspaceUploadInputRef.current?.click()}>
                <UploadDocIcon />
                Upload
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
            <section className="workspace-mode-card workspace-mode-card--interactive">
              <h2>Analyzing</h2>
              <p>Select a block, choose your goals, and learn with our AI coach.</p>
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
        <section className="workspace-mode-card workspace-mode-card--interactive">
          <h2>Analyzing</h2>
          <p>Select a block, choose your goals, and learn with our AI coach.</p>
          {renderAnalysisStats()}
        </section>
      );
    }

    if (workspaceMode === 'rewriting') {
      return (
        <section className="workspace-mode-card workspace-mode-card--interactive">
          <div className="workspace-mode-card-title-row">
            <h2>Rewriting</h2>
          </div>
          {rewriteError ? <p className="rewrite-panel-error" role="alert">{rewriteError}</p> : null}
          <div className="rewrite-card-list">
            {rewriteAllCompleted ? renderRewriteCompleteCard() : rewriteCards.map((card) => renderRewriteCard(card))}
          </div>
        </section>
      );
    }

    return (
      <section className="workspace-mode-card workspace-mode-card--interactive">
        <h2>Practicing</h2>
        {renderPracticeComposer()}
        {renderPracticeFeedback()}
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
    const headerNotice = /document not found/i.test(workspaceNotice) ? '' : workspaceNotice;
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
          <MobileSidebarToggle
            open={workspaceSidebarOpen}
            onClick={() => setWorkspaceSidebarOpen((value) => !value)}
            className="workspace-sidebar-toggle-button"
            ariaLabel={workspaceSidebarOpen ? 'Collapse setup sidebar' : 'Open setup sidebar'}
          />
          <div className="workspace-left-panel-content">
            <section className="workspace-upload-note">
              <p>Upload a new document. Save current edits before leaving.</p>
              <button type="button" className="home-upload workspace-upload-button" onClick={() => workspaceUploadInputRef.current?.click()}>
                <UploadDocIcon />
                Upload
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
            <button type="button" className="workspace-back-button" onClick={requestWorkspaceBack}>Back</button>
            <div className="workspace-paper-header-main">
              <input
                className="workspace-title-input"
                value={documentTitle}
                onChange={(event) => handleWorkspaceTitleChange(event.target.value)}
                aria-label="Document title"
              />
            </div>
            {(headerNotice || workspaceDirty) && (
              <small>{headerNotice || 'Unsaved changes'}</small>
            )}
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

}
