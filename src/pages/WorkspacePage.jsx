import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import blackboardUrl from '../assets/blackboard.png';
import AcademicStylePanel, {
  DEFAULT_CUSTOM_STYLE,
  TEMPLATE_STYLE_SETTINGS,
} from '../components/AcademicStylePanel.jsx';
import DocumentEditor from '../components/DocumentEditor.jsx';
import { useRealtime } from '../components/RealtimeProvider.jsx';
import HistorySelector from '../components/HistorySelector.jsx';
import MobileSidebarToggle from '../components/MobileSidebarToggle.jsx';
import OwlContainer from '../components/OwlContainer.jsx';
import {
  chooseNextUnfinishedBlock,
  convertLegacyTrackedBlocks,
} from '../lib/editorBlockCommands.js';
import { countCharacters } from '../lib/blockSegmentation/index.js';
import {
  activeBlockInfoFromDraft,
  cachePracticeResponse,
  cacheRewriteResponse,
  hashAiSourceText,
  rewriteIdentityMatchesVisible,
} from '../lib/aiResultIdentity.js';
import {
  normalizeBlockStatus,
  normalizeChangeSource,
  normalizeResumeStatus,
} from '../lib/blockState.js';
import { getBlackboardCssVars, getMobileContainerCssVars } from './libraries/animations/containerLayout.js';
import { useFloatingWindow } from './libraries/useFloatingWindow.js';
import {
  acceptDocumentBlockRewrite,
  analyzeDocumentBlock,
  generateDocumentBlockRewrites,
  getDocumentBlockRewrites,
  getDocument,
  listDocuments,
  requestDocumentBlockPracticeFeedback,
  prewarmDocumentBlockRewrites,
  saveDocument,
  uploadDocument,
} from '../services/documentsApi.js';
import HomePage from './HomePage.jsx';

const PRACTICE_MAX_CHARS = 4000;
const BLOCK_STATUSES = new Set(['unprocessed', 'processing', 'processed', 'skipped']);
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
    bestFor: 'For rigorous academic writing.',
    focus: 'Precision, objectivity, and research-first language.',
  },
  {
    id: 2,
    tone: 'persuasive-argumentative',
    title: 'Persuasive & Argumentative Tone',
    bestFor: 'For arguments that must persuade.',
    focus: 'Active verbs, firm reasoning, and clear significance.',
  },
  {
    id: 3,
    tone: 'accessible-concise',
    title: 'Accessible & Concise Tone',
    bestFor: 'For fast, clear communication.',
    focus: 'Plain language, active voice, and no filler.',
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
    state: 'idle',
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
    state: 'idle',
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

function textFromNode(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (!Array.isArray(node.content)) return '';
  return node.content.map(textFromNode).join('');
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function isEditableBlock(node) {
  return node?.type === 'blockSegment';
}

function editableBlocksFromContent(node, blocks = []) {
  if (!node || typeof node !== 'object') return blocks;
  if (isEditableBlock(node) && textFromNode(node).trim()) {
    blocks.push(node);
  }
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => editableBlocksFromContent(child, blocks));
  }
  return blocks;
}

function mapEditableBlocks(node, mapBlock) {
  if (!node || typeof node !== 'object') return node;
  if (isEditableBlock(node)) return mapBlock(node);
  if (!Array.isArray(node.content)) return node;
  return {
    ...node,
    content: node.content.map((child) => mapEditableBlocks(child, mapBlock)),
  };
}

function normalizeRuntimeBlock(documentId, block, index, styleSettings = {}) {
  const text = block.text ?? block.text_content ?? '';
  const status = normalizeBlockStatus(block.status ?? block.attrs?.status);
  const id = block.id ?? block.blockId ?? block.attrs?.blockId ?? `${documentId}-block-${index + 1}`;
  const length = countCharacters(text);
  const storedAttrs = block.attrs ?? block.tiptap_node?.attrs ?? {};
  const attrs = blockAttrs(
    id,
    status,
    length,
    {
      ...storedAttrs,
      resumeStatus: block.resume_status ?? storedAttrs.resumeStatus ?? null,
      processingBaselineText: block.processing_baseline_text
        ?? storedAttrs.processingBaselineText
        ?? null,
      changeSource: block.change_source ?? storedAttrs.changeSource ?? 'none',
      partitionGeneration: block.partition_generation
        ?? storedAttrs.partitionGeneration
        ?? 0,
      formatOverrides: block.format_overrides ?? storedAttrs.formatOverrides ?? [],
    },
    styleSettings
  );
  const storedNode = block.tiptap_node ?? null;
  const storedContent = Array.isArray(storedNode?.content)
    && storedNode.content.every((child) => child?.type === 'text' || child?.type === 'hardBreak')
    ? storedNode.content
    : (text ? [{ type: 'text', text }] : []);

  return {
    id,
    blockId: id,
    document_id: block.document_id ?? documentId,
    block_index: index,
    order: typeof block.order === 'number' ? block.order : index,
    node_type: 'blockSegment',
    text,
    text_content: text,
    status,
    isEmpty: typeof block.isEmpty === 'boolean' ? block.isEmpty : !text.trim(),
    length,
    char_length: length,
    resume_status: attrs.resumeStatus,
    processing_baseline_text: attrs.processingBaselineText,
    change_source: attrs.changeSource,
    partition_generation: attrs.partitionGeneration,
    format_overrides: attrs.formatOverrides,
    attrs,
    tiptap_node: {
      ...(storedNode?.type === 'blockSegment' ? storedNode : {}),
      type: 'blockSegment',
      attrs,
      content: storedContent,
    },
    contentIndex: block.contentIndex ?? null,
  };
}

function extractRuntimeBlocksFromContent(document, contentJson, styleSettings = {}) {
  const entries = [];
  let contentIndex = 0;

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (isEditableBlock(node)) {
      const text = textFromNode(node);
      const id = node.attrs?.blockId ?? `${document.id}-block-${entries.length + 1}`;
      const status = BLOCK_STATUSES.has(node.attrs?.status) ? node.attrs.status : 'unprocessed';
      const length = countCharacters(text);
      const attrs = blockAttrs(id, status, length, node.attrs ?? {}, styleSettings);
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
        length,
        char_length: length,
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

  const nextBlocks = normalizedBlocks.map((block, index) => {
    let status = block.status;
    let resumeStatus = block.attrs.resumeStatus ?? null;
    let processingBaselineText = block.attrs.processingBaselineText ?? null;
    let changeSource = normalizeChangeSource(block.attrs.changeSource);
    if (block.isEmpty && status === 'processing') {
      status = normalizeResumeStatus(resumeStatus);
      resumeStatus = null;
      processingBaselineText = null;
      changeSource = 'none';
    }
    if (!block.isEmpty) {
      if (processingBlockId && block.id === processingBlockId) {
        if (status !== 'processing') {
          resumeStatus = normalizeResumeStatus(status);
          processingBaselineText = block.text;
          changeSource = 'none';
        }
        status = 'processing';
      } else if (status === 'processing') {
        const unchanged = block.text === String(processingBaselineText ?? block.text);
        status = unchanged ? normalizeResumeStatus(resumeStatus) : 'unprocessed';
        resumeStatus = null;
        processingBaselineText = null;
        changeSource = unchanged ? 'none' : 'manual';
      }
    }

    const attrs = blockAttrs(block.id, status, countCharacters(block.text), {
      ...block.attrs,
      resumeStatus,
      processingBaselineText,
      changeSource,
    }, styleSettings);
    return {
      ...block,
      block_index: index,
      order: typeof block.order === 'number' ? block.order : index,
      status,
      resume_status: attrs.resumeStatus,
      processing_baseline_text: attrs.processingBaselineText,
      change_source: attrs.changeSource,
      partition_generation: attrs.partitionGeneration,
      format_overrides: attrs.formatOverrides,
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
  };
}

function draftFromDocument(document, styleSettings = {}) {
  const documentId = document?.id || 'workspace-document';
  const contentJson = convertLegacyTrackedBlocks(
    document?.content_json ?? { type: 'doc', content: [] },
    (index) => `${documentId}-block-${index + 1}`,
  );
  const sourceBlocks = Array.isArray(document?.blocks) && document.blocks.length
    ? document.blocks
    : extractRuntimeBlocksFromContent({ ...(document ?? {}), id: documentId }, contentJson, styleSettings);

  return normalizeWorkspaceDraft(
    document,
    contentJson,
    sourceBlocks,
    styleSettings,
    document?.current_processing_block_id ?? sourceBlocks.find((block) => block.status === 'processing')?.id ?? null
  );
}

function blockAttrs(blockId, status, length, existingAttrs = {}, styleSettings = {}) {
  return {
    lineHeight: styleSettings.spacing || styleSettings.lineHeight || existingAttrs.lineHeight || '2.0',
    textIndent: styleSettings.indentation || styleSettings.textIndent || existingAttrs.textIndent || '0.5in',
    textAlign: existingAttrs.textAlign || 'left',
    fontFamily: styleSettings.font || styleSettings.fontFamily || existingAttrs.fontFamily || 'Times New Roman',
    fontSize: styleSettings.fontSize || existingAttrs.fontSize || '12pt',
    ...existingAttrs,
    blockId,
    status,
    resumeStatus: status === 'processing'
      ? normalizeResumeStatus(existingAttrs.resumeStatus)
      : null,
    processingBaselineText: status === 'processing'
      ? String(existingAttrs.processingBaselineText ?? '')
      : null,
    changeSource: normalizeChangeSource(existingAttrs.changeSource),
    partitionGeneration: Math.max(0, Number(existingAttrs.partitionGeneration) || 0),
    formatOverrides: existingAttrs.formatOverrides
      && typeof existingAttrs.formatOverrides === 'object'
      ? existingAttrs.formatOverrides
      : [],
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

function documentFromContent(document, contentJson, styleName, styleSettings, blockSnapshots = null, preferredProcessingBlockId = null) {
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

function hydrateWorkspaceDocument(document) {
  if (!document) return null;
  return document;
}

export default function WorkspacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { documentId } = useParams();
  const {
    state: realtimeState,
    applyDocument,
    subscribeDocument,
  } = useRealtime();
  const [view, setView] = useState(() => (
    documentId ? 'workspace' : 'home'
  ));
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [showUnsavedBackPrompt, setShowUnsavedBackPrompt] = useState(false);
  const [formatReview, setFormatReview] = useState(null);
  const [editorReloadKey, setEditorReloadKey] = useState(0);
  const [workspaceDraft, setWorkspaceDraft] = useState(null);
  const [workspaceSidebarOpen, setWorkspaceSidebarOpen] = useState(true);
  const [workspaceMode, setWorkspaceMode] = useState('rewriting');
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
  const [rewriteApplyBusy, setRewriteApplyBusy] = useState(false);
  const [rewriteError, setRewriteError] = useState('');
  const [rewriteCache, setRewriteCache] = useState({});
  const [practiceInput, setPracticeInput] = useState('');
  const [practiceFeedback, setPracticeFeedback] = useState(null);
  const [practiceCache, setPracticeCache] = useState({});
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
  const [blockAnalysisHighlights, setBlockAnalysisHighlights] = useState({});
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const workspaceOwlAnimatorRef = useRef(null);
  const mobileWorkspaceOwlAnimatorRef = useRef(null);
  const documentEditorRef = useRef(null);
  const mobileDragEndedAtRef = useRef(0);
  const rewriteRefreshTimerRef = useRef(null);
  const rewriteContextKeyRef = useRef('');
  const rewriteVisibleIdentityRef = useRef(null);
  const practiceContextKeyRef = useRef('');
  const wandHoverTimerRef = useRef(null);
  const workspaceUploadInputRef = useRef(null);
  const mobileOptionsPanelRef = useRef(null);
  const mobileOptionsButtonRef = useRef(null);
  const pendingDocumentMutationsRef = useRef(new Set());
  const localDocumentRevisionsRef = useRef(new Map());
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
  const activeSourceBlock = activeEditorBlock?.blockId
    ? workspaceDraft?.blocks?.find((block) => block.id === activeEditorBlock.blockId) ?? null
    : null;
  const activeSourceText = activeEditorBlock?.text
    ?? activeSourceBlock?.text
    ?? activeSourceBlock?.text_content
    ?? '';
  const currentAnalysisKey = useMemo(() => (
    activeEditorBlock?.blockId
      ? `${activeEditorBlock.blockId}|${activeSourceText}|${selectedAnalysisFilters.join(',')}`
      : ''
  ), [activeEditorBlock?.blockId, activeSourceText, selectedAnalysisFilters]);
  const currentBlockAnalysis = currentAnalysisKey ? blockAnalyses[currentAnalysisKey] ?? null : null;
  const analysisHighlights = useMemo(
    () => Object.values(blockAnalysisHighlights),
    [blockAnalysisHighlights],
  );
  const currentRewriteBlockId = activeEditorBlock?.blockId
    ?? workspaceDraft?.currentProcessingBlockId
    ?? null;
  const currentRewriteBlock = workspaceDraft?.blocks?.find((block) => block.id === currentRewriteBlockId)
    ?? null;
  const currentRewriteKey = selectedDocument?.id && currentRewriteBlockId
    ? `${selectedDocument.id}|${currentRewriteBlockId}|${currentRewriteBlock?.text ?? ''}`
    : '';
  rewriteContextKeyRef.current = currentRewriteKey;
  rewriteVisibleIdentityRef.current = selectedDocument?.id && currentRewriteBlockId
    ? {
      documentId: selectedDocument.id,
      blockId: currentRewriteBlockId,
      partitionGeneration: Number(currentRewriteBlock?.partition_generation
        ?? currentRewriteBlock?.attrs?.partitionGeneration
        ?? 0),
      localKey: currentRewriteKey,
    }
    : null;
  const currentPracticeKey = selectedDocument?.id && activeEditorBlock?.blockId
    ? `${selectedDocument.id}|${activeEditorBlock.blockId}|${activeSourceText}`
    : '';
  const currentPracticeRequestKey = `${currentPracticeKey}|${practiceInput}`;
  practiceContextKeyRef.current = currentPracticeRequestKey;

  useEffect(() => {
    setAnalysisError('');
  }, [currentAnalysisKey]);

  useEffect(() => {
    if (!workspaceDirty || !currentRewriteBlock?.text) return undefined;
    let alive = true;
    hashAiSourceText(currentRewriteBlock.text).then((sourceTextHash) => {
      if (!alive) return;
      setRewriteCards((cards) => cards.map((card) => {
        const option = rewriteCache[`${sourceTextHash}|${card.tone}`];
        if (!option) return resetRewriteCard(card);
        return {
          ...card,
          rewriteId: option.id,
          response: option.rewrittenText,
          explanation: option.explanation,
          changes: option.changes ?? [],
          warnings: option.warnings ?? [],
          meaningPreserved: option.meaningPreserved,
          error: '',
          state: 'cache-hit',
        };
      }));
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, [currentRewriteBlock?.text, rewriteCache, workspaceDirty]);

  useEffect(() => {
    let alive = true;
    let refreshTimer = null;
    setRewriteError('');
    setRewriteCards(createRewriteCards());
    if (!selectedDocument?.id || !currentRewriteBlockId || workspaceDirty) {
      return () => {
        alive = false;
      };
    }

    const visibleAtStart = { ...rewriteVisibleIdentityRef.current };
    const applyState = (response) => {
      if (!alive) return false;
      const visible = rewriteVisibleIdentityRef.current;
      if (
        !visible
        || visible.localKey !== visibleAtStart.localKey
        || response.identity?.documentId !== visible.documentId
        || response.identity?.blockId !== visible.blockId
        || Number(response.identity?.partitionGeneration) !== visible.partitionGeneration
        || response.canonical === false
      ) {
        return false;
      }

      const activeJob = response.jobs?.find((job) => (
        job.status === 'running' || job.status === 'queued'
      ));
      const failedJob = response.jobs?.find((job) => job.status === 'failed');
      setRewriteCache((cache) => {
        const next = { ...cache };
        for (const rewrite of response.rewrites ?? []) {
          next[`${response.identity.sourceTextHash}|${rewrite.tone}`] = rewrite;
        }
        return next;
      });
      setRewriteCards((cards) => cards.map((card) => {
        const option = response.rewrites?.find((rewrite) => rewrite.tone === card.tone);
        if (option) {
          return {
            ...card,
            rewriteId: option.id,
            response: option.rewrittenText,
            explanation: option.explanation,
            changes: option.changes ?? [],
            warnings: option.warnings ?? [],
            meaningPreserved: option.meaningPreserved,
            error: '',
            state: 'cache-hit',
          };
        }
        return {
          ...resetRewriteCard(card),
          state: activeJob?.status ?? (failedJob ? 'failed' : 'idle'),
          error: failedJob?.errorCode ? 'Automatic rewrite generation failed.' : '',
        };
      }));
      setWorkspaceOwlLoading(Boolean(activeJob));
      return Boolean(activeJob);
    };

    const refresh = async ({ enqueue = false } = {}) => {
      try {
        if (enqueue) {
          await prewarmDocumentBlockRewrites(selectedDocument.id, currentRewriteBlockId);
        }
        const response = await getDocumentBlockRewrites(
          selectedDocument.id,
          currentRewriteBlockId,
        );
        const pending = applyState(response);
        if (pending && alive) {
          refreshTimer = window.setTimeout(() => void refresh(), 1200);
        }
      } catch (error) {
        if (!alive) return;
        setRewriteError(error.message || 'Could not load rewrite suggestions.');
        setRewriteCards((cards) => cards.map((card) => (
          card.response ? card : { ...card, state: 'failed', error: error.message }
        )));
        setWorkspaceOwlLoading(false);
      }
    };
    void refresh({ enqueue: true });

    return () => {
      alive = false;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [
    currentRewriteKey,
    currentRewriteBlockId,
    selectedDocument?.id,
    workspaceDirty,
  ]);

  useEffect(() => {
    setPracticeInput('');
    setPracticeFeedback(null);
    setPracticeError('');
    setMobilePracticeIndex(0);
  }, [currentPracticeKey]);

  useEffect(() => {
    if (!currentPracticeRequestKey) return;
    const cached = practiceCache[currentPracticeRequestKey];
    if (cached) {
      setPracticeFeedback(cached);
      setPracticeError('');
      return;
    }
    setPracticeFeedback((current) => (
      current?.requestKey === currentPracticeRequestKey ? current : null
    ));
  }, [currentPracticeRequestKey, practiceCache]);

  useEffect(() => () => {
    if (rewriteRefreshTimerRef.current) {
      clearTimeout(rewriteRefreshTimerRef.current);
    }
    if (wandHoverTimerRef.current) {
      clearTimeout(wandHoverTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!documentId) {
      setView('home');
      setSelectedDocument(null);
      return undefined;
    }

    setView('workspace');
    let alive = true;
    setWorkspaceNotice('Loading document...');
    getDocument(documentId)
      .then(({ document }) => {
        if (!alive) return;
        applyDocument('document:updated', document, { force: true });
        openWorkspace(document, { updateRoute: false });
      })
      .catch((error) => {
        if (!alive) return;
        setSelectedDocument(null);
        setWorkspaceNotice(error.message || 'Could not load the document.');
      });

    return () => {
      alive = false;
    };
  }, [applyDocument, documentId]);

  useEffect(() => {
    if (view !== 'workspace' || !documentId) return undefined;
    return subscribeDocument(documentId);
  }, [documentId, subscribeDocument, view]);

  useEffect(() => {
    if (!documentId || selectedDocument?.id !== documentId) return;
    if (
      realtimeState.trashDocuments.some((document) => document.id === documentId)
      || realtimeState.deletedDocumentIds.some((document) => document.id === documentId)
    ) {
      setWorkspaceDirty(false);
      setWorkspaceNotice('This document was removed from the workspace in another session.');
      setView('home');
      navigate('/');
      return;
    }

    const remoteDocument = realtimeState.documentDetails[documentId];
    if (
      remoteDocument
      && Number(remoteDocument.revision) > Number(selectedDocument.revision ?? 0)
      && Number(remoteDocument.revision) > (localDocumentRevisionsRef.current.get(documentId) ?? 0)
      && !pendingDocumentMutationsRef.current.has(documentId)
    ) {
      // A keyed editor remount loads this canonical document as initial state, so
      // Tiptap does not emit an onUpdate/save cycle for a remote replacement.
      openWorkspace(remoteDocument, { updateRoute: false });
      setWorkspaceNotice('Updated from another session.');
    }
  }, [documentId, navigate, realtimeState.deletedDocumentIds, realtimeState.documentDetails, realtimeState.trashDocuments, selectedDocument?.id, selectedDocument?.revision, view]);

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
      .catch((error) => {
        if (!alive) return;
        setWorkspaceHistoryDocuments([]);
        setWorkspaceNotice(error.message || 'Could not load recent documents.');
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
    setActiveEditorBlock(activeBlockInfoFromDraft(nextDraft));
    setEditorReloadKey((value) => value + 1);
    setStyleName(nextStyleName);
    setStyleSettings(nextStyleSettings);
    setWorkspaceDirty(false);
    setWorkspaceNotice('');
    setBlockAnalyses({});
    setBlockAnalysisHighlights({});
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
    setView('workspace');
    const targetPath = `/workspace/${hydratedDocument.id}`;
    if (updateRoute && location.pathname !== targetPath) {
      navigate(targetPath);
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
    if (nextInfo.blockId) {
      setRewriteAllCompleted(false);
      setRewriteCardsLocked(false);
    }
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

  async function persistWorkspaceDocument(document, versionLabel) {
    if (!document?.id) throw new Error('No persisted document is open.');

    pendingDocumentMutationsRef.current.add(document.id);
    try {
      const result = await saveDocument(document.id, {
        title: document.title,
        academicStyle: document.academic_style || styleName,
        styleSettings: document.style_settings || styleSettings,
        contentJson: document.content_json,
        createVersion: true,
        versionLabel,
      });
      const persistedDocument = result.document ?? document;
      const persistedStyleName = persistedDocument.academic_style || styleName;
      const persistedStyleSettings = {
        ...(TEMPLATE_STYLE_SETTINGS[persistedStyleName] ?? DEFAULT_CUSTOM_STYLE),
        ...(persistedDocument.style_settings ?? styleSettings),
      };
      const persistedDraft = draftFromDocument(persistedDocument, persistedStyleSettings);
      setWorkspaceDraft(persistedDraft);
      setSelectedDocument(documentFromWorkspaceDraft(
        persistedDocument,
        persistedDraft,
        persistedStyleName,
        persistedStyleSettings,
      ));
      setEditorContent(persistedDraft.contentJson ?? document.content_json);
      setActiveEditorBlock(activeBlockInfoFromDraft(persistedDraft));
      setStyleName(persistedStyleName);
      setStyleSettings(persistedStyleSettings);
      setWorkspaceDirty(false);
      const revision = Number(persistedDocument.revision);
      if (Number.isFinite(revision)) {
        localDocumentRevisionsRef.current.set(persistedDocument.id, revision);
      }
      applyDocument('document:updated', persistedDocument);
      return persistedDocument;
    } finally {
      pendingDocumentMutationsRef.current.delete(document.id);
    }
  }

  async function saveWorkspaceDocument({
    leaveAfterSave = false,
    formatDecision = null,
  } = {}) {
    const audit = documentEditorRef.current?.getFormatAudit?.();
    if (!formatDecision && audit?.hasDifferences) {
      setFormatReview({ audit, leaveAfterSave });
      return false;
    }

    let nextStyleName = styleName;
    let nextStyleSettings = styleSettings;
    let snapshot = null;
    if (formatDecision === 'normalize') {
      snapshot = documentEditorRef.current?.normalizeFormatting?.();
    } else if (formatDecision === 'keep') {
      snapshot = documentEditorRef.current?.keepLocalFormatting?.();
      nextStyleName = 'Customized';
      setStyleName('Customized');
    }

    const document = snapshot?.contentJson && selectedDocument
      ? documentFromContent(
        selectedDocument,
        snapshot.contentJson,
        nextStyleName,
        nextStyleSettings,
        snapshot.blocks,
        snapshot.currentProcessingBlockId,
      )
      : normalizedWorkspaceDocument();
    if (!document?.id) return false;
    document.academic_style = nextStyleName;
    document.style_settings = nextStyleSettings;

    setWorkspaceSaving(true);
    try {
      await persistWorkspaceDocument(document, 'Manual save');
      setWorkspaceNotice('Saved');
      setShowUnsavedBackPrompt(false);
      setFormatReview(null);
      if (leaveAfterSave) {
        setView('home');
        navigate('/');
      }
      return true;
    } catch (error) {
      setWorkspaceNotice(error.message || 'Could not save the document.');
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
    setSelectedDocument(null);
    setWorkspaceDraft(null);
    setEditorContent(null);
    setActiveEditorBlock({ blockId: null, status: 'unprocessed' });
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
      applyDocument('document:created', result.document);
      openWorkspace(result.document);
      setWorkspaceNotice(`${file.name} uploaded as a new document.`);
    } catch (error) {
      setWorkspaceNotice(error.message || 'Could not upload the document.');
    }
  }

  async function analyzeActiveBlock() {
    const documentId = selectedDocument?.id;
    const blockId = activeEditorBlock?.blockId;
    if (!documentId || !blockId) {
      setAnalysisError('Select a text block to analyze.');
      return;
    }
    if (!selectedAnalysisFilters.length) {
      setAnalysisError('Select at least one analysis filter.');
      return;
    }
    if (analysisBusy) return;

    const requestKey = currentAnalysisKey;
    const requestBlockText = activeSourceText
      ?? workspaceDraft?.blocks?.find((block) => block.id === blockId)?.text
      ?? '';
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
      setBlockAnalysisHighlights((current) => ({
        ...current,
        [blockId]: {
          blockId,
          sourceText: requestBlockText,
          issues: response.analysis?.ai?.issues ?? [],
        },
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

    // Rewrites are saved from the complete editor snapshot after the replacement
    // is applied. A separate status-only request here could publish the old block
    // text and overwrite the local rewrite before that save finishes.
    if (payload.replacementText !== null && payload.replacementText !== undefined) {
      setWorkspaceDirty(true);
      return;
    }

    const nextDocument = payload.contentJson && selectedDocument
      ? documentFromContent(
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
      const hasRemainingBlocks = nextDocument.blocks?.some((block) => (
        block.status === 'processing' || block.status === 'unprocessed'
      ));
      const actionNotice = status === 'processing'
        ? ''
        : status === 'skipped'
          ? 'Skipped block. Moved to the next block.'
          : 'Completed block. Moved to the next block.';
      refreshRewriteCardsFromDocument(nextDocument, hasRemainingBlocks ? actionNotice : '');
    }

    if (!selectedDocument?.id) {
      if (status !== 'processing') {
        setWorkspaceNotice(`Marked block as ${status}.`);
      } else {
        setWorkspaceNotice('');
      }
      setWorkspaceDirty(true);
      return;
    }

    if (!nextDocument) {
      setWorkspaceNotice('Could not save the block status from the editor.');
      return;
    }

    try {
      const versionLabel = status === 'processing'
        ? 'Selected processing block'
        : status === 'skipped'
          ? 'Skipped block'
          : 'Completed block';
      await persistWorkspaceDocument(nextDocument, versionLabel);
    } catch (error) {
      setWorkspaceNotice(error.message || 'Could not update the block status.');
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
    const requestedCard = rewriteCards.find((card) => card.tone === tone);
    if (
      rewriteCardsLocked
      || rewriteAllCompleted
      || ['queued', 'running'].includes(requestedCard?.state)
    ) return;

    const requestKey = currentRewriteKey;
    setRewriteCards((cards) => cards.map((card) => (
      card.tone === tone ? { ...card, state: 'running', error: '' } : card
    )));
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
      setRewriteCache((cache) => cacheRewriteResponse(cache, response));
      const visible = rewriteVisibleIdentityRef.current;
      const stillVisible = rewriteIdentityMatchesVisible(
        response.identity,
        visible,
        requestKey,
        rewriteContextKeyRef.current,
      );
      if (!stillVisible) {
        setWorkspaceNotice('Rewrite finished and was saved for the earlier block state.');
        return;
      }

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
          state: response.cached ? 'cache-hit' : 'completed',
          applyWithExplanation: false,
        };
      }));
      setWorkspaceNotice(response.cached ? 'Loaded the saved rewrite.' : 'Rewrite is ready.');
    } catch (error) {
      setRewriteError(error.message || 'AI rewriting is temporarily unavailable.');
      setRewriteCards((cards) => cards.map((card) => (
        card.tone === tone ? { ...card, state: 'failed', error: error.message } : card
      )));
      triggerWorkspaceError();
    } finally {
      setWorkspaceOwlLoading(false);
      setRewriteCards((cards) => cards.map((card) => (
        card.tone === tone && card.state === 'running'
          ? { ...card, state: card.response ? 'completed' : 'idle' }
          : card
      )));
    }
  }

  async function regenerateRewriteCard(cardId) {
    if (rewriteCardsLocked || rewriteAllCompleted) return;
    const card = rewriteCards.find((item) => item.id === cardId);
    if (!card) return;
    await generateRewrites({ tone: card.tone, force: Boolean(card.response) });
  }

  async function handleRewriteCardClick(card, event) {
    if (
      rewriteCardsLocked
      || rewriteAllCompleted
      || rewriteApplyBusy
      || !card.rewriteId
      || !card.response
      || !card.meaningPreserved
    ) return;
    const animationTarget = event.currentTarget;
    setRewriteApplyBusy(true);
    setRewriteError('');
    try {
      await acceptDocumentBlockRewrite(selectedDocument.id, currentRewriteBlockId, card.rewriteId);
      const document = applyRewriteCard(card);
      if (!document) {
        throw new Error('The selected block could not be updated. Please select it and try again.');
      }
      await persistWorkspaceDocument(document, `Accepted ${card.title} rewrite`);
      void runWorkspaceMagic(animationTarget).catch(() => {});
    } catch (error) {
      setRewriteError(error.message || 'The rewrite could not be applied.');
      triggerWorkspaceError();
    } finally {
      setWorkspaceOwlLoading(false);
      setRewriteApplyBusy(false);
    }
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

  function applyStatusToSelectedBlock(
    nextStatus,
    replacementText = null,
    changeSource = replacementText === null ? 'none' : 'ai-replacement',
  ) {
    if (!selectedDocument) return null;

    const nextSnapshot = documentEditorRef.current?.applyCurrentBlockStatus({
      status: nextStatus,
      replacementText,
      changeSource,
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
      setActiveEditorBlock(activeBlockInfoFromDraft(
        normalized.draft,
        document.current_processing_block_id,
        nextStatus,
      ));
      setWorkspaceDirty(true);
      return document;
    }

    const rawSourceContent = editorContent
      ?? selectedDocument.content_json
      ?? { type: 'doc', content: [] };
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
    const editableBlocks = editableBlocksFromContent(sourceContent);

    if (!editableBlocks.length) {
      setWorkspaceNotice('No editable block is available.');
      return null;
    }

    const activeBlockId = activeEditorBlock?.blockId;
    const currentProcessingId = sourceDocument.current_processing_block_id;
    const target = editableBlocks.find((node) => (
      activeBlockId
      && node.attrs?.blockId === activeBlockId
      && ['processing', 'unprocessed'].includes(node.attrs?.status)
    ))
      ?? editableBlocks.find((node) => node.attrs?.blockId === currentProcessingId)
      ?? editableBlocks.find((node) => node.attrs?.status === 'processing')
      ?? editableBlocks[0];
    const nextProcessingBlockId = chooseNextUnfinishedBlock(
      editableBlocks.map((node) => ({
        blockId: node.attrs?.blockId ?? null,
        status: node.attrs?.status ?? 'unprocessed',
        isEmpty: false,
      })),
      target.attrs?.blockId ?? null,
    )?.blockId ?? null;

    const nextContent = mapEditableBlocks(sourceContent, (node) => {
      if (!textFromNode(node).trim()) return node;
      const attrs = { ...(node.attrs ?? {}) };
      const blockId = attrs.blockId ?? null;

      if (blockId === target.attrs?.blockId) {
        attrs.status = nextStatus;
        attrs.resumeStatus = null;
        attrs.processingBaselineText = null;
        attrs.changeSource = changeSource;
        if (replacementText !== null) {
          attrs.length = countCharacters(replacementText);
          return {
            ...node,
            attrs,
            content: [{ type: 'text', text: replacementText }],
          };
        }
        return { ...node, attrs };
      }
      if (blockId === nextProcessingBlockId) {
        return {
          ...node,
          attrs: {
            ...attrs,
            status: 'processing',
            resumeStatus: 'unprocessed',
            processingBaselineText: textFromNode(node),
            changeSource: 'none',
          },
        };
      }
      if (attrs.status === 'processing') {
        const unchanged = textFromNode(node) === String(attrs.processingBaselineText ?? textFromNode(node));
        return {
          ...node,
          attrs: {
            ...attrs,
            status: unchanged ? normalizeResumeStatus(attrs.resumeStatus) : 'unprocessed',
            resumeStatus: null,
            processingBaselineText: null,
            changeSource: unchanged ? 'none' : 'manual',
          },
        };
      }
      return node;
    });

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
    setActiveEditorBlock(activeBlockInfoFromDraft(
      nextDraft,
      document.current_processing_block_id,
      nextStatus,
    ));
    setWorkspaceDirty(true);
    return document;
  }

  function applyRewriteCard(card) {
    if (!card.response) return null;
    const document = applyStatusToSelectedBlock('processed', card.response);
    if (document) {
      lockOrCompleteRewriteCards(document, `${card.title} applied. Cards refreshed for the next block.`);
    }
    return document;
  }

  function toggleRewriteExplanation(cardId) {
    setRewriteCards((cards) => cards.map((card) => (
      card.id === cardId ? { ...card, applyWithExplanation: !card.applyWithExplanation } : card
    )));
  }

  async function tryPracticeResponse(event, { showMobileFeedback = false } = {}) {
    const documentId = selectedDocument?.id;
    const blockId = activeEditorBlock?.blockId;
    const attemptText = practiceInput.trim();

    if (!documentId || !blockId) {
      setPracticeError('Select a text block before starting practice.');
      return;
    }
    if (!attemptText) {
      setPracticeError('Write your own revision before requesting feedback.');
      return;
    }
    if (practiceBusy) return;

    const requestKey = currentPracticeRequestKey;
    setPracticeBusy(true);
    setPracticeError('');
    setWorkspaceNotice('');
    setWorkspaceOwlError(false);
    setWorkspaceOwlLoading(true);
    if (showMobileFeedback) setMobilePracticeIndex(1);

    try {
      if (workspaceDirty) {
        const saved = await saveWorkspaceDocument();
        if (!saved) {
          setPracticeError('Save the current document before requesting AI feedback.');
          return;
        }
      }

      const response = await requestDocumentBlockPracticeFeedback(documentId, blockId, attemptText);
      const savedFeedback = {
        ...response.practice,
        identity: response.identity,
        requestContextKey: currentPracticeKey,
        requestKey,
      };
      const cacheKey = [
        response.identity?.documentId,
        response.identity?.blockId,
        response.identity?.sourceTextHash,
        response.identity?.attemptTextHash,
        response.identity?.analysisContextKey,
      ].join('|');
      setPracticeCache((cache) => cachePracticeResponse(
        cache,
        requestKey,
        cacheKey,
        savedFeedback,
      ));
      if (practiceContextKeyRef.current !== requestKey) {
        setWorkspaceNotice('Practice feedback finished and was saved for the earlier attempt.');
        return;
      }

      setPracticeFeedback(savedFeedback);
      setWorkspaceNotice(response.cached ? 'Loaded saved practice feedback.' : 'Practice feedback is ready.');
    } catch (error) {
      if (practiceContextKeyRef.current === requestKey) {
        setPracticeError(
          `${error.message || 'AI practice feedback is temporarily unavailable.'}${error.correlationId
            ? ` Reference: ${error.correlationId}`
            : ''}`,
        );
      }
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

  async function applyPracticeAttempt(event) {
    const feedback = practiceFeedback;
    if (
      !feedback?.attemptText
      || feedback.requestContextKey !== currentPracticeKey
      || feedback.identity?.blockId !== activeEditorBlock?.blockId
      || Number(feedback.identity?.partitionGeneration) !== Number(
        activeEditorBlock?.partitionGeneration ?? currentRewriteBlock?.partition_generation ?? 0,
      )
    ) {
      setPracticeError('This feedback belongs to an older block state. Request fresh feedback first.');
      return;
    }

    setPracticeBusy(true);
    setPracticeError('');
    try {
      const document = applyStatusToSelectedBlock(
        'processed',
        feedback.attemptText,
        'practice-replacement',
      );
      if (!document) throw new Error('The reviewed revision could not be applied.');
      await persistWorkspaceDocument(document, 'Applied reviewed Practice revision');
      lockOrCompleteRewriteCards(
        document,
        'Your reviewed revision was applied. Suggestions are warming for the next block.',
      );
      await runWorkspaceMagic(event.currentTarget);
    } catch (error) {
      setPracticeError(error.message || 'The reviewed revision could not be applied.');
      triggerWorkspaceError();
    } finally {
      setPracticeBusy(false);
    }
  }

  function renderPracticeComposer({ mobile = false } = {}) {
    const learningGoals = currentBlockAnalysis?.ai?.learningGoals ?? [];
    const practiceDisabled = (
      practiceBusy
      || !activeEditorBlock?.blockId
      || !currentBlockAnalysis
      || !practiceInput.trim()
    );

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
          <button
            type="button"
            className={practiceDisabled ? 'ai-action-disabled' : ''}
            onMouseEnter={holdWorkspaceWand}
            onClick={mobile ? handleMobilePracticeTry : tryPracticeResponse}
            disabled={practiceDisabled}
          >
            {practiceBusy ? 'Reviewing...' : 'Get AI feedback'}
          </button>
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
        <div className="practice-composer-actions">
          <span>{practiceInput.length} / {PRACTICE_MAX_CHARS}</span>
        </div>
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
            <button
              type="button"
              className="practice-apply-button"
              onClick={applyPracticeAttempt}
              disabled={
                practiceBusy
                || feedback.requestContextKey !== currentPracticeKey
              }
            >
              Apply Your Rewritten Version
            </button>
          </>
        ) : null}
      </article>
    );
  }

  function renderRewriteCard(card) {
    const tonePending = card.state === 'queued' || card.state === 'running';
    const skippedOrigin = currentRewriteBlock?.attrs?.resumeStatus === 'skipped'
      || currentRewriteBlock?.resume_status === 'skipped';
    const manuallyEdited = currentRewriteBlock?.attrs?.changeSource === 'manual'
      || currentRewriteBlock?.change_source === 'manual';
    const automaticMiss = (
      !card.response
      && !skippedOrigin
      && !manuallyEdited
      && card.state !== 'failed'
    );
    const generateLabel = tonePending
      ? 'Processing...'
      : card.response
        ? 'Regenerate'
        : skippedOrigin
          ? 'Regenerate for skipped'
          : manuallyEdited
            ? 'Regenerate for edited'
            : card.state === 'failed'
              ? 'Retry rewrite'
              : 'Processing...';
    const generationDisabled = (
      tonePending
      || automaticMiss
      || rewriteCardsLocked
      || rewriteAllCompleted
    );
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
            className={generationDisabled
              ? 'ai-action-disabled'
              : ''}
            disabled={generationDisabled}
          >
            {generateLabel}
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
                onClick={(event) => handleRewriteCardClick(card, event)}
                className={`rewrite-card-apply${rewriteApplyBusy || rewriteCardsLocked || !card.meaningPreserved
                  ? ' ai-action-disabled'
                  : ''}`}
                disabled={rewriteApplyBusy || rewriteCardsLocked || !card.meaningPreserved}
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
        ) : null}
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
          {['rewriting', 'analyzing', 'practicing'].map((item) => (
            <button
              key={item}
              type="button"
              className={mobilePanelMode === item ? 'is-active' : ''}
              onClick={() => setMobilePanelMode(item)}
              role="tab"
              aria-selected={mobilePanelMode === item}
              id={`mobile-assistant-tab-${item}`}
              aria-controls="mobile-assistant-panel"
            >
              {item}
            </button>
          ))}
        </div>

        {mobilePanelMode === 'rewriting' ? (
          <div className="workspace-mobile-panel-body" role="tabpanel" id="mobile-assistant-panel" aria-labelledby="mobile-assistant-tab-rewriting">
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
        ) : mobilePanelMode === 'analyzing' ? (
          <div className="workspace-mobile-panel-body" role="tabpanel" id="mobile-assistant-panel" aria-labelledby="mobile-assistant-tab-analyzing">
            {renderAnalysisStats()}
          </div>
        ) : (
          <div className="workspace-mobile-panel-body" role="tabpanel" id="mobile-assistant-panel" aria-labelledby="mobile-assistant-tab-practicing">
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
    const analysisResults = ai?.results ?? [];
    const filterCounts = Object.fromEntries(Object.keys(ANALYSIS_FILTER_LABELS).map((key) => [
      key,
      analysisResults.find((result) => result.type === key)?.issues?.length ?? null,
    ]));

    return (
      <>
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

            <div className="analysis-result-list">
              {analysisResults.map((result) => (
                <section
                  key={result.type}
                  className={`analysis-result-card analysis-result-card--${result.type}`}
                >
                  <div className="analysis-result-card__heading">
                    <h3>{ANALYSIS_FILTER_LABELS[result.type]}</h3>
                    <span>
                      {result.status === 'clear'
                        ? 'Checked — clear'
                        : `${result.issues.length} ${result.issues.length === 1 ? 'note' : 'notes'}`}
                    </span>
                  </div>
                  {result.status === 'clear' ? (
                    <p>No issue was found for this check.</p>
                  ) : result.issues.map((issue, index) => (
                    <article
                      key={`${result.type}-${index}`}
                      className={`analysis-issue analysis-issue--${result.type}`}
                    >
                      <q>{issue.evidence}</q>
                      <p>{issue.explanation}</p>
                      <small>{issue.suggestion}</small>
                    </article>
                  ))}
                </section>
              ))}
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
      ['history', 'Others'],
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
              role="tab"
              aria-selected={mobileOptionsTab === id}
              id={`mobile-options-tab-${id}`}
              aria-controls="mobile-options-panel"
            >
              {label}
            </button>
          ))}
        </div>
        <div
          className="workspace-mobile-options-body"
          role="tabpanel"
          id="mobile-options-panel"
          aria-labelledby={`mobile-options-tab-${mobileOptionsTab}`}
        >
          {mobileOptionsTab === 'setup' ? (
            <section className="workspace-upload-note">
              <button type="button" className="home-upload workspace-upload-button" onClick={() => workspaceUploadInputRef.current?.click()}>
                <UploadDocIcon />
                Upload
              </button>
              <span>Upload a new document. Save current edits before leaving.</span>
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
        </div>
      </section>
    );
  }

  function renderWorkspaceMode() {
    if (workspaceMode === 'analyzing') {
      return (
        <section className="workspace-mode-card workspace-mode-card--interactive" role="tabpanel" id="workspace-mode-panel" aria-labelledby="workspace-mode-tab-analyzing">
          <div className="workspace-mode-card-content">
          {!currentBlockAnalysis ? (
            <p>Select a block, choose your goals, and learn with our AI coach.</p>
          ) : null}
          {renderAnalysisStats()}
          </div>
        </section>
      );
    }

    if (workspaceMode === 'rewriting') {
      return (
        <section className="workspace-mode-card workspace-mode-card--interactive" role="tabpanel" id="workspace-mode-panel" aria-labelledby="workspace-mode-tab-rewriting">
          <div className="workspace-mode-card-content">
          {rewriteError ? <p className="rewrite-panel-error" role="alert">{rewriteError}</p> : null}
          <div className="rewrite-card-list">
            {rewriteAllCompleted ? renderRewriteCompleteCard() : rewriteCards.map((card) => renderRewriteCard(card))}
          </div>
          </div>
        </section>
      );
    }

    return (
      <section className="workspace-mode-card workspace-mode-card--interactive" role="tabpanel" id="workspace-mode-panel" aria-labelledby="workspace-mode-tab-practicing">
        <div className="workspace-mode-card-content">
        {renderPracticeComposer()}
        {renderPracticeFeedback()}
        </div>
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
    if (!selectedDocument) {
      return (
        <main className="document-workspace-page">
          <p role="status">{workspaceNotice || 'Loading document...'}</p>
        </main>
      );
    }

    const documentTitle = selectedDocument.title || 'Untitled document';
    const recentDocuments = workspaceHistoryDocuments;

    return (
      <main className={`document-workspace-page${workspaceSidebarOpen ? '' : ' is-sidebar-collapsed'}`}>
        <input
          ref={workspaceUploadInputRef}
          className="workspace-file-input"
          type="file"
          accept=".txt,.md,.docx"
          aria-label="Upload a document"
          tabIndex={-1}
          onChange={handleWorkspaceUploadInputChange}
        />
        <aside className="workspace-left-panel" aria-label="Document setup">
          <MobileSidebarToggle
            open={workspaceSidebarOpen}
            onClick={() => setWorkspaceSidebarOpen((value) => !value)}
            className="workspace-sidebar-toggle-button"
            ariaLabel={workspaceSidebarOpen ? 'Collapse setup sidebar' : 'Open setup sidebar'}
            variant="side"
          />
          <div className="workspace-left-panel-content">
            <section className="workspace-upload-note">
              <button type="button" className="home-upload workspace-upload-button" onClick={() => workspaceUploadInputRef.current?.click()}>
                <UploadDocIcon />
                Upload
              </button>
              <span>Upload a new document. Save current edits before leaving.</span>
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
            <div className="workspace-paper-header-main">
              <input
                className="workspace-title-input"
                value={documentTitle}
                onChange={(event) => handleWorkspaceTitleChange(event.target.value)}
                aria-label="Document title"
              />
            </div>
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
            <button
              type="button"
              className="workspace-back-button"
              onClick={requestWorkspaceBack}
              aria-label="Leave workspace"
              title="Leave workspace"
            >
              <CloseIcon />
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
            analysisHighlights={analysisHighlights}
            onSave={() => saveWorkspaceDocument()}
            saveDisabled={!workspaceDirty}
            saving={workspaceSaving}
          />
        </section>

        <aside className="workspace-blackboard-panel" aria-label="Owl workspace panel" style={blackboardStyle}>
          <img
            className="blackboard__image"
            src={blackboardUrl}
            alt=""
            draggable={false}
            aria-hidden="true"
          />
          <div className="workspace-blackboard-content">
            <div className="workspace-mode-switcher" role="tablist" aria-label="Workspace mode">
              {['rewriting', 'analyzing', 'practicing'].map((item) => (
                <button
                  key={item}
                  type="button"
                  className={workspaceMode === item ? 'is-active' : ''}
                  onClick={() => setWorkspaceMode(item)}
                  role="tab"
                  aria-selected={workspaceMode === item}
                  id={`workspace-mode-tab-${item}`}
                  aria-controls="workspace-mode-panel"
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
        {formatReview ? (
          <div className="confirm-backdrop" role="presentation">
            <section className="confirm-modal format-review-modal" role="dialog" aria-modal="true" aria-labelledby="format-review-title">
              <h2 id="format-review-title">Review local formatting</h2>
              <p>
                {formatReview.audit.differences.length} block(s) differ from the global format.
                Choose whether to normalize them or preserve their property-level overrides.
              </p>
              <ul>
                {formatReview.audit.differences.slice(0, 8).map((item, index) => (
                  <li key={item.blockId || index}>
                    Block {index + 1}: {item.properties.join(', ')}
                  </li>
                ))}
              </ul>
              <div className="confirm-actions">
                <button type="button" onClick={() => setFormatReview(null)}>Cancel</button>
                <button
                  type="button"
                  onClick={() => saveWorkspaceDocument({
                    leaveAfterSave: formatReview.leaveAfterSave,
                    formatDecision: 'keep',
                  })}
                >
                  Keep local formatting
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => saveWorkspaceDocument({
                    leaveAfterSave: formatReview.leaveAfterSave,
                    formatDecision: 'normalize',
                  })}
                >
                  Normalize to global
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </main>
    );
  }

}
