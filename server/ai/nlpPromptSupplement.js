import { stableFingerprint } from '../nlp/hash.js';
import { normalizePersistedBlockNlp } from '../nlp/blockAggregation.js';

export const NLP_REWRITE_SUPPLEMENT_COMPILER_VERSION = 'nlp-rewrite-supplement-v1';

function normalizedTypoIssues(analysis = {}) {
  return (analysis.issues ?? [])
    .filter((issue) => (
      issue.code === 'SPELLING_TYPO'
      && issue.severity === 'warning'
      && issue.confidence === 'high'
      && issue.original
      && issue.suggestion
    ))
    .map((issue) => ({
      code: issue.code,
      original: String(issue.original).trim(),
      suggestion: String(issue.suggestion).trim(),
    }))
    .filter((issue) => (
      issue.original
      && issue.suggestion
      && issue.original.toLocaleLowerCase('en') !== issue.suggestion.toLocaleLowerCase('en')
    ))
    .slice(0, 3);
}

export function compileNlpRewriteSupplement(block) {
  const nlp = normalizePersistedBlockNlp(block);
  if (!nlp.current || !['pass', 'warning'].includes(nlp.nlpStatus)) {
    return {
      supplement: '',
      fingerprint: 'none',
      compilerVersion: NLP_REWRITE_SUPPLEMENT_COMPILER_VERSION,
      snapshot: {},
    };
  }
  const typos = normalizedTypoIssues(nlp.nlpAnalysis);
  const anchor = nlp.semanticAnchor?.confidence === 'high'
    && Array.isArray(nlp.semanticAnchor.topicTerms)
    && nlp.semanticAnchor.topicTerms.length
    ? {
      topicTerms: nlp.semanticAnchor.topicTerms.slice(0, 4),
      confidence: 'high',
    }
    : null;
  const instructions = [];
  if (typos.length === 1) {
    instructions.push(
      `Fix the detected typo "${typos[0].original}" to "${typos[0].suggestion}".`,
    );
  } else if (typos.length > 1) {
    instructions.push('Correct the detected spelling and punctuation errors.');
  }
  if (anchor) {
    instructions.push(`Preserve the block's focus on: ${anchor.topicTerms.join(', ')}.`);
  }
  const supplement = instructions.join(' ');
  if (!supplement) {
    return {
      supplement: '',
      fingerprint: 'none',
      compilerVersion: NLP_REWRITE_SUPPLEMENT_COMPILER_VERSION,
      snapshot: {},
    };
  }
  const snapshot = {
    status: nlp.nlpStatus,
    textHash: nlp.nlpTextHash,
    pipelineVersion: nlp.nlpPipelineVersion,
    snapshotFingerprint: nlp.nlpSnapshotFingerprint,
    issues: typos,
    semanticAnchor: anchor,
    compilerVersion: NLP_REWRITE_SUPPLEMENT_COMPILER_VERSION,
  };
  return {
    supplement,
    fingerprint: stableFingerprint(snapshot).slice(0, 16),
    compilerVersion: NLP_REWRITE_SUPPLEMENT_COMPILER_VERSION,
    snapshot,
  };
}

export function nlpAwareRewritePromptVersion(basePromptVersion, nlpContext) {
  return nlpContext?.fingerprint && nlpContext.fingerprint !== 'none'
    ? `${basePromptVersion}:nlp-v1:${nlpContext.fingerprint}`
    : basePromptVersion;
}
