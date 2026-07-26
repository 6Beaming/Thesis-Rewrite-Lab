import {
  CURRENT_NLP_PIPELINE_VERSION,
  NLP_CONTRACT_VERSION,
  SEMANTIC_PROFILES,
  normalizeSemanticProfile,
} from './config.js';
import {
  AnalyzeBlockResultSchema,
  PartitionDocumentResultSchema,
} from './contracts.js';
import {
  countCodePoints,
  hashNlpText,
  sliceCodePoints,
} from './hash.js';

const STRUCTURAL_SKIP_TYPES = new Set([
  'heading',
  'subheading',
  'customPseudoHeading',
  'figureCaption',
  'bibliographyHeading',
  'bibliographyEntry',
  'referenceEntry',
  'annotation',
  'imageDescription',
  'listLabel',
  'code',
  'equation',
]);

const AUTO_SKIP_CODES = new Set([
  'EMPTY_OR_SYMBOL_ONLY',
  'OCR_GARBAGE',
  'TRUNCATED_EXTRACTION',
  'GENERIC_IMAGE_DESCRIPTION',
  'MEANINGLESS_FRAGMENT',
  'LOW_INFORMATION_SENTENCE',
  'NON_ARGUMENTATIVE_STRUCTURE',
  'PSEUDO_TITLE',
]);

const STOP_TERMS = new Set([
  'about', 'after', 'again', 'also', 'among', 'because', 'been', 'before',
  'being', 'between', 'both', 'could', 'document', 'each', 'from', 'have',
  'into', 'more', 'most', 'other', 'paper', 'same', 'such', 'than', 'that',
  'their', 'there', 'these', 'they', 'this', 'those', 'through', 'using',
  'very', 'were', 'what', 'when', 'where', 'which', 'while', 'with', 'would',
]);

const COMMON_TYPOS = Object.freeze({
  accomodate: 'accommodate',
  becuase: 'because',
  beleive: 'believe',
  definately: 'definitely',
  goverment: 'government',
  grammer: 'grammar',
  occured: 'occurred',
  recieve: 'receive',
  seperate: 'separate',
  sucessful: 'successful',
  teh: 'the',
  untill: 'until',
  wierd: 'weird',
  writting: 'writing',
});

const LOW_INFORMATION_PATTERN = /^(?:hello(?:\s*,?\s*world)?|this is (?:a|the) new line|test(?:ing)?(?:\s+(?:line|sentence|text))?|sample(?:\s+(?:line|sentence|text))?)[.!?]*$/iu;
const ACADEMIC_SIGNAL_PATTERN = /\b(?:argu|claim|eviden|result|research|study|analys|method|finding|valid|reliab|signific|hypothes|theor|conclud|demonstrat|indicat|suggest|support)\w*\b/iu;
const FINITE_VERB_PATTERN = /\b(?:am|are|is|was|were|be|been|being|can|could|do|does|did|has|have|had|may|might|must|shall|should|will|would|[a-z]+(?:ed|es|s))\b/iu;
const FUNCTION_WORD_END_PATTERN = /\b(?:a|an|and|as|at|by|for|from|in|of|on|or|the|to|with)\s*[.!?]?\s*$/iu;
const WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

function tokenize(value) {
  return String(value ?? '').toLocaleLowerCase('en').match(WORD_PATTERN) ?? [];
}

function looksLikePseudoTitle(value) {
  const text = String(value ?? '').trim();
  const words = tokenize(text);
  if (!text || words.length > 16 || /[.!?]$/u.test(text)) return false;
  if (/^(?:references|bibliography|works cited)$/iu.test(text)) return true;
  if (/^(?:assignment|article|chapter|section|part|appendix|abstract|introduction|conclusion)\b/iu.test(text)) {
    return true;
  }
  return /^[\p{Lu}\p{N}][^.!?]{1,120}:\s*[^.!?]{1,100}$/u.test(text);
}

function topicTerms(value) {
  const counts = new Map();
  for (const token of tokenize(value)) {
    if (token.length < 4 || STOP_TERMS.has(token) || /^\d+$/u.test(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([term]) => term);
}

function hashFeature(token, dimension) {
  let hash = 2166136261;
  for (const character of token) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % dimension;
}

function semanticVector(value, dimension = 48) {
  const vector = Array.from({ length: dimension }, () => 0);
  const terms = tokenize(value).filter((term) => !STOP_TERMS.has(term));
  for (const term of terms) {
    vector[hashFeature(term, dimension)] += 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + (item * item), 0));
  return magnitude ? vector.map((item) => item / magnitude) : vector;
}

function cosine(left, right) {
  if (!left?.length || left.length !== right?.length) return 0;
  return Math.max(0, Math.min(1, left.reduce(
    (sum, value, index) => sum + (value * right[index]),
    0,
  )));
}

function averageVectors(vectors) {
  if (!vectors.length) return [];
  const output = Array.from({ length: vectors[0].length }, () => 0);
  for (const vector of vectors) {
    vector.forEach((value, index) => {
      output[index] += value / vectors.length;
    });
  }
  const magnitude = Math.sqrt(output.reduce((sum, item) => sum + (item * item), 0));
  return magnitude ? output.map((item) => item / magnitude) : output;
}

function normalizedOverlap(left = [], right = []) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (!leftSet.size || !rightSet.size) return 0;
  let overlap = 0;
  for (const value of leftSet) if (rightSet.has(value)) overlap += 1;
  return overlap / Math.max(leftSet.size, rightSet.size);
}

function segmentSentenceRanges(text) {
  const source = String(text ?? '');
  if (!source) return [];
  const ranges = [];
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    for (const segment of segmenter.segment(source)) {
      const startCp = countCodePoints(source.slice(0, segment.index));
      const endCp = startCp + countCodePoints(segment.segment);
      ranges.push({ startCp, endCp });
    }
  }
  if (!ranges.length) {
    const codePoints = Array.from(source);
    let startCp = 0;
    for (let index = 0; index < codePoints.length; index += 1) {
      const character = codePoints[index];
      if (!/[.!?]/u.test(character)) continue;
      let endCp = index + 1;
      while (endCp < codePoints.length && /\s/u.test(codePoints[endCp])) endCp += 1;
      ranges.push({ startCp, endCp });
      startCp = endCp;
      index = endCp - 1;
    }
    if (startCp < codePoints.length) ranges.push({ startCp, endCp: codePoints.length });
  }
  return ranges.filter((range) => range.endCp > range.startCp);
}

function delimiterMismatch(value) {
  const pairs = [['(', ')'], ['[', ']'], ['{', '}'], ['“', '”']];
  return pairs.some(([open, close]) => (
    value.split(open).length !== value.split(close).length
  ));
}

function issue({
  startCp,
  endCp,
  code,
  severity,
  message,
  original,
  suggestion,
  confidence,
}) {
  return {
    startCp,
    endCp,
    code,
    severity,
    message,
    ...(original ? { original } : {}),
    ...(suggestion ? { suggestion } : {}),
    ...(confidence ? { confidence } : {}),
  };
}

function typoIssues(sentenceText, sentenceStartCp, knownTerms) {
  const protectedTerms = new Set((knownTerms ?? []).map((term) => term.toLocaleLowerCase('en')));
  const issues = [];
  const expression = /\b[\p{L}][\p{L}'’-]*\b/gu;
  for (const match of sentenceText.matchAll(expression)) {
    const original = match[0];
    const normalized = original.toLocaleLowerCase('en');
    const suggestion = COMMON_TYPOS[normalized];
    if (!suggestion || protectedTerms.has(normalized)) continue;
    const startCp = sentenceStartCp + countCodePoints(sentenceText.slice(0, match.index));
    issues.push(issue({
      startCp,
      endCp: startCp + countCodePoints(original),
      code: 'SPELLING_TYPO',
      severity: 'warning',
      message: `Possible spelling issue: “${original}”.`,
      original,
      suggestion,
      confidence: 'high',
    }));
  }
  return issues;
}

function analyzeSentence({
  text,
  startCp,
  endCp,
  index,
  sourceType,
  knownTerms,
}) {
  const trimmed = text.trim();
  const reasonCodes = [];
  const issues = typoIssues(text, startCp, knownTerms);
  const structuralSkip = STRUCTURAL_SKIP_TYPES.has(sourceType);
  const letters = trimmed.match(/\p{L}/gu)?.length ?? 0;
  const visible = trimmed.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const noFiniteVerb = !FINITE_VERB_PATTERN.test(trimmed);
  const unmatchedDelimiter = delimiterMismatch(trimmed);
  const endsWithFunctionWord = FUNCTION_WORD_END_PATTERN.test(trimmed);

  if (structuralSkip) {
    reasonCodes.push('NON_ARGUMENTATIVE_STRUCTURE');
  } else if (!trimmed || !visible) {
    reasonCodes.push('EMPTY_OR_SYMBOL_ONLY');
  } else if (LOW_INFORMATION_PATTERN.test(trimmed)) {
    reasonCodes.push('LOW_INFORMATION_SENTENCE');
  } else if (looksLikePseudoTitle(trimmed)) {
    reasonCodes.push('PSEUDO_TITLE');
  } else if (trimmed.length >= 8 && letters / Math.max(1, trimmed.length) < 0.35) {
    reasonCodes.push('OCR_GARBAGE');
  } else if (/(?:\uFFFD{2,}|\.{4,}|\[\s*(?:truncated|missing)\s*\])$/iu.test(trimmed)) {
    reasonCodes.push('TRUNCATED_EXTRACTION');
  } else if (
    /^(?:an?\s+)?(?:image|picture|photo)\s+of\b/iu.test(trimmed)
    && tokenize(trimmed).length < 12
  ) {
    reasonCodes.push('GENERIC_IMAGE_DESCRIPTION');
  } else if (noFiniteVerb && unmatchedDelimiter && endsWithFunctionWord) {
    reasonCodes.push('MEANINGLESS_FRAGMENT');
  } else if (
    tokenize(trimmed).length <= 3
    && !ACADEMIC_SIGNAL_PATTERN.test(trimmed)
    && !/\d/u.test(trimmed)
  ) {
    reasonCodes.push('LOW_INFORMATION_SENTENCE');
  }

  if (!reasonCodes.length && noFiniteVerb && tokenize(trimmed).length > 2) {
    issues.push(issue({
      startCp,
      endCp,
      code: 'POSSIBLE_FRAGMENT',
      severity: 'warning',
      message: 'This sentence may be incomplete.',
      confidence: 'medium',
    }));
  }
  if (!reasonCodes.length && unmatchedDelimiter) {
    issues.push(issue({
      startCp,
      endCp,
      code: 'UNMATCHED_DELIMITER',
      severity: 'blocking',
      message: 'A bracket or quotation mark appears to be unmatched.',
      confidence: 'high',
    }));
  }
  if (
    !reasonCodes.length
    && tokenize(trimmed).length >= 4
    && !/[.!?]["')\]}]*$/u.test(trimmed)
  ) {
    issues.push(issue({
      startCp,
      endCp,
      code: 'MISSING_END_PUNCTUATION',
      severity: 'warning',
      message: 'This sentence may need ending punctuation.',
      confidence: 'high',
    }));
  }

  const automaticSkip = reasonCodes.some((code) => AUTO_SKIP_CODES.has(code));
  const blocking = automaticSkip || issues.some((item) => item.severity === 'blocking');
  const status = automaticSkip
    ? 'skipped'
    : blocking
      ? 'blocked'
      : issues.length
        ? 'warning'
        : 'pass';
  const terms = topicTerms(trimmed);
  return {
    index,
    startCp,
    endCp,
    textHash: hashNlpText(text),
    status,
    issues,
    entities: [],
    nounChunks: terms.slice(0, 5),
    topicTerms: terms,
    reasonCodes,
    sourceType,
    hardBoundaryBefore: false,
    oversizedSentence: countCodePoints(text) > 800,
    text,
    vector: semanticVector(text),
  };
}

function semanticCoherence(sentences) {
  const usable = sentences.filter((sentence) => sentence.status !== 'skipped');
  if (usable.length < 2) return usable.length ? 1 : null;
  let total = 0;
  for (let index = 1; index < usable.length; index += 1) {
    total += cosine(usable[index - 1].vector, usable[index].vector);
  }
  return Number((total / (usable.length - 1)).toFixed(4));
}

function createSemanticAnchor(sentences, coherence) {
  const usable = sentences.filter((sentence) => (
    sentence.status === 'pass' || sentence.status === 'warning'
  ));
  if (!usable.length) return null;
  const centroid = averageVectors(usable.map((sentence) => sentence.vector));
  const representative = [...usable].sort((left, right) => (
    cosine(right.vector, centroid) - cosine(left.vector, centroid)
    || left.index - right.index
  ))[0];
  const terms = topicTerms(usable.map((sentence) => sentence.text).join(' ')).slice(0, 5);
  if (!terms.length) return null;
  const representativeSimilarity = cosine(representative.vector, centroid);
  const score = (
    (Number(coherence ?? 0.5) * 0.55)
    + (representativeSimilarity * 0.35)
    + (Math.min(1, terms.length / 4) * 0.10)
  );
  if (score < 0.42) return null;
  return {
    topicTerms: terms,
    representativeStartCp: representative.startCp,
    representativeEndCp: representative.endCp,
    confidence: score >= 0.7 ? 'high' : score >= 0.55 ? 'medium' : 'low',
  };
}

function publicSentence(sentence) {
  const { text: _text, vector: _vector, ...result } = sentence;
  return result;
}

export function analyzeBlockLocally({
  text,
  sourceType = 'paragraph',
  knownTerms = [],
  degraded = false,
} = {}) {
  const source = String(text ?? '');
  const sentences = segmentSentenceRanges(source).map((range, index) => analyzeSentence({
    text: sliceCodePoints(source, range.startCp, range.endCp),
    startCp: range.startCp,
    endCp: range.endCp,
    index,
    sourceType,
    knownTerms,
  }));
  const issues = sentences.flatMap((sentence) => sentence.issues);
  const reasonCodes = [...new Set(sentences.flatMap((sentence) => sentence.reasonCodes))];
  const coherence = semanticCoherence(sentences);
  const anchor = createSemanticAnchor(sentences, coherence);
  const automaticSkip = sentences.length > 0 && sentences.every((sentence) => sentence.status === 'skipped');
  const hasBlocking = issues.some((item) => item.severity === 'blocking');
  const hasWarning = issues.some((item) => item.severity === 'warning');
  const status = automaticSkip
    ? 'skipped'
    : hasBlocking
      ? 'blocked'
      : (hasWarning || degraded)
        ? 'warning'
        : sentences.length
          ? 'pass'
          : 'blocked';
  const result = {
    textHash: hashNlpText(source),
    pipelineVersion: CURRENT_NLP_PIPELINE_VERSION,
    contractVersion: NLP_CONTRACT_VERSION,
    status,
    reasonCodes,
    sentenceCount: sentences.length,
    sentences: sentences.map(publicSentence),
    issues,
    issueCounts: {
      warning: issues.filter((item) => item.severity === 'warning').length,
      blocking: issues.filter((item) => item.severity === 'blocking').length,
    },
    semanticCoherence: coherence,
    semanticAnchor: anchor,
    rewriteEligible: status === 'pass' || status === 'warning',
    degraded,
    analysisWarnings: degraded
      ? ['The full language reviewer was unavailable, so a basic local review was used.']
      : [],
  };
  return AnalyzeBlockResultSchema.parse(result);
}

function candidateCoherence(sentence, current) {
  const centroid = averageVectors(current.map((item) => item.vector));
  const previous = current.at(-1);
  const entityOverlap = normalizedOverlap(sentence.entities, current.flatMap((item) => item.entities));
  const nounOverlap = normalizedOverlap(sentence.nounChunks, current.flatMap((item) => item.nounChunks));
  return (
    (0.45 * cosine(sentence.vector, centroid))
    + (0.30 * cosine(sentence.vector, previous.vector))
    + (0.10 * entityOverlap)
    + (0.10 * nounOverlap)
    + (0.05 * (sentence.text.trimStart().match(/^(?:however|therefore|moreover|consequently|thus)\b/iu) ? 0.8 : 0.5))
  );
}

function buildCandidate({
  structural,
  paragraphIndex,
  startCp,
  endCp,
  initialStatus,
  degraded,
}) {
  const text = sliceCodePoints(structural.text, startCp, endCp);
  const nlpAnalysis = analyzeBlockLocally({
    text,
    sourceType: structural.sourceType,
    knownTerms: structural.knownTerms,
    degraded,
  });
  const nlpStatus = initialStatus === 'skipped' ? 'skipped' : nlpAnalysis.status;
  return {
    text,
    startCp,
    endCp,
    paragraphIndex,
    sourceType: structural.sourceType,
    level: Number.isInteger(structural.level) ? structural.level : null,
    initialStatus,
    nlpStatus,
    reasonCodes: nlpAnalysis.reasonCodes,
    semanticCoherence: nlpAnalysis.semanticCoherence,
    semanticAnchor: nlpAnalysis.semanticAnchor,
    nlpAnalysis: {
      ...nlpAnalysis,
      status: nlpStatus,
      rewriteEligible: nlpStatus === 'pass' || nlpStatus === 'warning',
    },
    oversizedSentence: nlpAnalysis.sentences.some((sentence) => sentence.oversizedSentence),
  };
}

function partitionStructuralBlock(structural, paragraphIndex, profile, degraded) {
  if (STRUCTURAL_SKIP_TYPES.has(structural.sourceType)) {
    return [buildCandidate({
      structural,
      paragraphIndex,
      startCp: 0,
      endCp: countCodePoints(structural.text),
      initialStatus: 'skipped',
      degraded,
    })];
  }
  const analyzed = analyzeBlockLocally({
    text: structural.text,
    sourceType: structural.sourceType,
    knownTerms: structural.knownTerms,
    degraded,
  });
  const sentences = analyzed.sentences.map((sentence) => ({
    ...sentence,
    text: sliceCodePoints(structural.text, sentence.startCp, sentence.endCp),
    vector: semanticVector(sliceCodePoints(structural.text, sentence.startCp, sentence.endCp)),
  }));
  const groups = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    groups.push({ sentences: current, initialStatus: 'unprocessed' });
    current = [];
  };

  for (const sentence of sentences) {
    if (sentence.status === 'skipped') {
      flush();
      groups.push({ sentences: [sentence], initialStatus: 'skipped' });
      continue;
    }
    if (!current.length) {
      current = [sentence];
      continue;
    }
    const startCp = current[0].startCp;
    const projectedLength = sentence.endCp - startCp;
    const currentLength = current.at(-1).endCp - startCp;
    const score = candidateCoherence(sentence, current);
    const mustSplit = (
      projectedLength > profile.maxChars
      || score < profile.severeBreakThreshold
      || (score < profile.splitThreshold && currentLength >= profile.preferredMinChars)
    );
    if (mustSplit) {
      flush();
      current = [sentence];
    } else {
      current.push(sentence);
    }
  }
  flush();

  return groups.map((group) => buildCandidate({
    structural,
    paragraphIndex,
    startCp: group.sentences[0].startCp,
    endCp: group.sentences.at(-1).endCp,
    initialStatus: group.initialStatus,
    degraded,
  }));
}

export function partitionDocumentLocally({
  structuralBlocks = [],
  semanticProfile = 'medium',
  degraded = false,
} = {}) {
  const profileName = normalizeSemanticProfile(semanticProfile);
  const profile = SEMANTIC_PROFILES[profileName];
  const candidates = structuralBlocks.flatMap((input, paragraphIndex) => {
    const structural = {
      text: String(input?.text ?? input?.textContent ?? ''),
      sourceType: String(input?.sourceType ?? input?.attrs?.sourceType ?? 'paragraph'),
      level: input?.level ?? input?.attrs?.level ?? null,
      knownTerms: input?.knownTerms ?? [],
    };
    if (!structural.text) return [];
    return partitionStructuralBlock(structural, paragraphIndex, profile, degraded);
  });
  return PartitionDocumentResultSchema.parse({
    pipelineVersion: CURRENT_NLP_PIPELINE_VERSION,
    semanticProfile: profileName,
    candidates,
    degraded,
    warnings: degraded
      ? ['The full sentence grouper was unavailable, so basic local grouping was used.']
      : [],
  });
}
