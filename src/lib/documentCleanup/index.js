import {
  classifyParagraph,
  isAnnotation,
  isFormalFigureCaption,
} from './classifyParagraph.js';
import {
  concatInlineContent,
  inlineContentFromText,
  remapWhitespacePreservingMarks,
  sliceInlineContent,
  textFromInlineContent,
} from './inlineContent.js';

const NO_SPACE_AFTER_LEFT = /[(\[{—–\\/-]$/;
const NO_SPACE_BEFORE_RIGHT = /^[,.;:!?%\)\]\}—–-]/;

export function normalizeForIntegrityCheck(value) {
  return String(value ?? '').replace(/\s+/gu, '').normalize('NFC');
}

export function joinFragments(left, right) {
  const leftText = String(left?.text ?? '').trimEnd();
  const rightText = String(right?.text ?? '').trimStart();
  const separator = (
    NO_SPACE_AFTER_LEFT.test(leftText)
    || NO_SPACE_BEFORE_RIGHT.test(rightText)
  ) ? '' : ' ';
  const content = concatInlineContent(
    left?.content ?? inlineContentFromText(leftText),
    right?.content ?? inlineContentFromText(rightText),
    separator,
  );
  return {
    ...left,
    text: `${leftText}${separator}${rightText}`,
    content,
  };
}

function normalizeBlockWhitespace(block) {
  const sourceContent = block.content ?? inlineContentFromText(block.text);
  const normalizedText = String(block.text ?? textFromInlineContent(sourceContent))
    .replace(/[ \t]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .trim();
  const lines = normalizedText.split('\n');
  let text = lines.shift() ?? '';
  for (const line of lines) {
    const leftLine = text.slice(text.lastIndexOf('\n') + 1);
    const preserveBreak = isAnnotation(leftLine) || isAnnotation(line)
      || (endsCompleteSentence(leftLine) && /^\p{Lu}/u.test(line));
    if (preserveBreak) {
      text += `\n${line}`;
    } else {
      const separator = (
        NO_SPACE_AFTER_LEFT.test(text)
        || NO_SPACE_BEFORE_RIGHT.test(line)
      ) ? '' : ' ';
      text += `${separator}${line}`;
    }
  }
  return {
    ...block,
    text,
    content: remapWhitespacePreservingMarks(sourceContent, text),
  };
}

function repairKnownSpacing(block) {
  const formalCaption = isFormalFigureCaption(block.text);
  let text = block.text.replace(
    /(?<![A-Za-z])(?:[A-Z][ \t]+){1,}[A-Z](?![A-Za-z])/g,
    (match) => match.replace(/\s+/g, ''),
  );
  if (formalCaption) {
    text = text
      .replace(/^(FIGURE\s+\d+(?:\.\d+)+)(?=[A-Z])/u, '$1 ')
      .replace(/([a-z)])\.([A-Z(])/g, '$1. $2');
  }
  if (text === block.text) return block;
  return {
    ...block,
    text,
    content: remapWhitespacePreservingMarks(block.content, text),
  };
}

function endsCompleteSentence(value) {
  return /[.!?][\p{Pe}"'’”]*$/u.test(String(value ?? '').trim());
}

function beginsAsContinuation(value) {
  const text = String(value ?? '').trim();
  return /^[\p{Ll},.;:!?)}\]]/u.test(text)
    || /^(?:and|but|nor|or|so|yet|which|that|because|while|whereas)\b/i.test(text);
}

function splitCaptionMarker(block) {
  const match = /^(.*?\S)\s*(\([a-z0-9ivxlcdm]+\))\s*$/iu.exec(block.text);
  if (!match) return { caption: block, marker: null };
  const markerStart = block.text.lastIndexOf(match[2]);
  const captionText = match[1].trimEnd();
  const markerText = match[2];
  return {
    caption: {
      ...block,
      text: captionText,
      content: sliceInlineContent(block.content, 0, captionText.length),
    },
    marker: {
      sourceType: 'annotation',
      text: markerText,
      attrs: { sourceType: 'annotation', annotationKind: 'panel' },
      content: sliceInlineContent(block.content, markerStart, markerStart + markerText.length),
    },
  };
}

function mergeMarkerWithBlock(marker, block) {
  const merged = joinFragments(marker, block);
  return {
    ...merged,
    sourceType: block.sourceType === 'imageDescription' ? 'imageDescription' : 'paragraph',
    attrs: {
      ...(block.attrs ?? {}),
      sourceType: block.sourceType === 'imageDescription' ? 'imageDescription' : 'paragraph',
      annotation: marker.text,
    },
  };
}

function shouldMerge(previous, current, currentType, continuationOpen) {
  if (!previous || current.attrs?.hardBoundaryBefore) return false;
  const previousType = previous.cleanupType;
  if (['heading', 'figureCaption', 'imageDescription'].includes(previousType)) return false;
  if (['heading', 'figureCaption', 'imageDescription', 'boundary'].includes(currentType)) return false;
  if (continuationOpen || currentType === 'connector' || currentType === 'crossReference') return true;
  if (beginsAsContinuation(current.text)) return true;
  return !endsCompleteSentence(previous.text);
}

/**
 * Deterministic DOCX/HTML cleanup. It changes only whitespace and structural
 * boundaries; character order is validated before the result is accepted.
 */
export function cleanExtractedBlocks(inputBlocks, { integrityMode = 'strict' } = {}) {
  const sourceText = inputBlocks
    .filter((block) => block?.sourceType !== 'boundary')
    .map((block) => block.text ?? '')
    .join('');
  const normalized = inputBlocks.map((block) => (
    block?.sourceType === 'boundary' ? block : repairKnownSpacing(normalizeBlockWhitespace(block))
  ));
  const classified = normalized.map((block, index) => ({
    ...block,
    cleanupType: classifyParagraph(block, {
      previousText: normalized[index - 1]?.text ?? '',
      nextText: normalized[index + 1]?.text ?? '',
    }),
  }));

  const output = [];
  let pendingMarker = null;
  let hardBoundaryBefore = false;
  let continuationOpen = false;

  for (const candidate of classified) {
    if (candidate.cleanupType === 'boundary') {
      hardBoundaryBefore = true;
      continuationOpen = false;
      continue;
    }

    let block = {
      ...candidate,
      attrs: {
        ...(candidate.attrs ?? {}),
        ...(hardBoundaryBefore ? { hardBoundaryBefore: true } : {}),
      },
    };
    hardBoundaryBefore = false;

    if (candidate.cleanupType === 'figureCaption') {
      if (pendingMarker) {
        output.push({ ...pendingMarker, cleanupType: 'annotation' });
        pendingMarker = null;
      }
      const { caption, marker } = splitCaptionMarker(block);
      output.push({ ...caption, cleanupType: 'figureCaption' });
      pendingMarker = marker;
      continuationOpen = false;
      continue;
    }

    if (candidate.cleanupType === 'annotation' || isAnnotation(candidate.text)) {
      const previous = output.at(-1);
      const isBarePanelLetter = /^[a-z]$/i.test(candidate.text);
      if (isBarePanelLetter && previous?.cleanupType === 'imageDescription') {
        const content = concatInlineContent(previous.content, candidate.content, '\n');
        output[output.length - 1] = {
          ...previous,
          text: `${previous.text}\n${candidate.text}`,
          content,
        };
        continuationOpen = false;
        continue;
      }
      if (pendingMarker) {
        output.push({ ...pendingMarker, cleanupType: 'annotation' });
      }
      pendingMarker = candidate;
      continuationOpen = false;
      continue;
    }

    if (pendingMarker) {
      block = {
        ...mergeMarkerWithBlock(pendingMarker, block),
        cleanupType: candidate.cleanupType,
      };
      pendingMarker = null;
    }

    const previous = output.at(-1);
    if (shouldMerge(previous, block, candidate.cleanupType, continuationOpen)) {
      const merged = joinFragments(previous, block);
      output[output.length - 1] = {
        ...merged,
        cleanupType: previous.cleanupType === 'crossReference'
          ? 'paragraph'
          : previous.cleanupType,
      };
      continuationOpen = (
        candidate.cleanupType === 'connector'
        || candidate.cleanupType === 'crossReference'
        || !endsCompleteSentence(block.text)
      );
      continue;
    }

    output.push(block);
    continuationOpen = false;
  }

  if (pendingMarker) output.push({ ...pendingMarker, cleanupType: 'annotation' });

  const cleaned = output.map(({ cleanupType, ...block }) => {
    const sourceType = cleanupType === 'heading'
      ? 'heading'
      : cleanupType === 'imageDescription'
        ? 'imageDescription'
        : cleanupType === 'figureCaption'
          ? 'figureCaption'
          : block.sourceType === 'heading'
            ? 'heading'
            : 'paragraph';
    const headingLevel = Number(block.attrs?.level) || 1;
    const headingFontSizes = { 1: '24pt', 2: '18pt', 3: '14pt' };
    const structuralStyle = sourceType === 'heading'
      ? {
        textIndent: block.attrs?.textIndent ?? '0in',
        lineHeight: block.attrs?.lineHeight ?? '1.25',
        fontSize: block.attrs?.fontSize ?? headingFontSizes[headingLevel] ?? '12pt',
        formatOverrides: ['textIndent', 'lineHeight', 'fontSize'],
      }
      : ['figureCaption', 'imageDescription'].includes(sourceType)
        ? {
          textIndent: '0in',
          lineHeight: '1.15',
          fontSize: '10pt',
          formatOverrides: ['textIndent', 'lineHeight', 'fontSize'],
        }
        : {};
    const formatOverrides = [
      ...(block.attrs?.formatOverrides ?? []),
      ...(structuralStyle.formatOverrides ?? []),
    ];
    return {
      ...block,
      sourceType,
      attrs: {
        ...(block.attrs ?? {}),
        sourceType,
        ...structuralStyle,
        ...(formatOverrides.length
          ? { formatOverrides: [...new Set(formatOverrides)] }
          : {}),
        ...(sourceType === 'heading'
          ? { level: headingLevel }
          : {}),
      },
    };
  }).filter((block) => block.text.trim());

  const outputText = cleaned.map((block) => block.text).join('');
  const integrityValid = normalizeForIntegrityCheck(sourceText)
    === normalizeForIntegrityCheck(outputText);
  if (!integrityValid && integrityMode === 'strict') {
    const sourceSignature = normalizeForIntegrityCheck(sourceText);
    const outputSignature = normalizeForIntegrityCheck(outputText);
    const mismatchAt = Array.from(sourceSignature).findIndex((
      character,
      index,
    ) => character !== Array.from(outputSignature)[index]);
    throw new Error(
      `Document cleanup stopped because the source-content integrity check failed near character ${mismatchAt}.`,
    );
  }
  return cleaned;
}

export {
  classifyParagraph,
  isAnnotation,
  isFormalFigureCaption,
  textFromInlineContent,
};
