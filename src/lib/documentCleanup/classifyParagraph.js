const FORMAL_FIGURE_CAPTION = /^FIGURE\s+\d+(?:\.\d+)+/;
const CROSS_REFERENCE = /^(?:Figure\s+\d+(?:\.\d+)*[a-z]?|Chapter\s+\d+)$/;
const PANEL_OR_LIST_MARKER = /^(?:\([a-z0-9ivxlcdm]+\)|[a-z]|(?:\d+|[ivxlcdm]+)[.)]|\d+(?:\.\d+)+)$/i;
const PUNCTUATION_FRAGMENT = /^(?:[,.;:!?)]|and|or|, and|\)\.|\)\. The)$/i;
const IMAGE_DESCRIPTION = /^(?:A|An)\s+.{0,60}\b(?:figure|illustration|MRI|photograph|diagram)\b/i;

function titleCaseRatio(text) {
  const words = text.match(/[A-Za-z][A-Za-z’'-]*/g) ?? [];
  if (!words.length) return 0;
  const ignored = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
  const titleWords = words.filter((word, index) => (
    ignored.has(word.toLowerCase())
      ? index > 0
      : /^\p{Lu}/u.test(word)
  ));
  return titleWords.length / words.length;
}

function isFullyEmphasized(block) {
  const textNodes = (block?.content ?? []).filter((node) => (
    node?.type === 'text' && String(node.text ?? '').trim()
  ));
  return Boolean(
    textNodes.length
    && textNodes.every((node) => node.marks?.some((mark) => mark.type === 'bold')),
  );
}

export function isHeadingCandidate(text) {
  const value = String(text ?? '').trim();
  if (!value || Array.from(value).length > 80) return false;
  if (/[.!?;:]$/.test(value) || !/^\p{Lu}/u.test(value)) return false;
  if (/^Dividing the .+ by .+$/i.test(value)) return true;
  return value.split(/\s+/).length >= 2 && titleCaseRatio(value) >= 0.72;
}

export function classifyParagraph(block, context = {}) {
  const text = String(block?.text ?? '').trim();
  if (block?.sourceType === 'boundary') return 'boundary';
  if (block?.sourceType === 'heading') return 'heading';
  if (
    isFullyEmphasized(block)
    && Array.from(text).length <= 160
    && !/[.!?]$/u.test(text)
  ) {
    return 'heading';
  }
  if (FORMAL_FIGURE_CAPTION.test(text)) return 'figureCaption';
  if (CROSS_REFERENCE.test(text)) return 'crossReference';
  if (PANEL_OR_LIST_MARKER.test(text)) return 'annotation';
  if (PUNCTUATION_FRAGMENT.test(text)) return 'connector';
  if (IMAGE_DESCRIPTION.test(text)) return 'imageDescription';
  if (
    isHeadingCandidate(text)
    && !/^\p{Ll}/u.test(String(context.nextText ?? '').trim())
  ) {
    return 'heading';
  }
  return 'paragraph';
}

export function isFormalFigureCaption(text) {
  return FORMAL_FIGURE_CAPTION.test(String(text ?? '').trim());
}

export function isAnnotation(text) {
  return PANEL_OR_LIST_MARKER.test(String(text ?? '').trim());
}
