export const CURRENT_NLP_PIPELINE_VERSION = 'document-nlp-v1';
export const NLP_CONTRACT_VERSION = 'nlp-contract-v1';
export const NLP_PARTITION_ALGORITHM_VERSION = 'contiguous-semantic-v1';
export const NLP_KNOWN_TERMS_VERSION = 'known-terms-v1';
export const NLP_GRAMMAR_RULES_VERSION = 'thesis-grammar-rules-v1';
export const NLP_SPACY_MODEL = 'en_core_web_sm==3.8.0';
export const NLP_EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2@v1.0';

export const NLP_STATUS_VALUES = Object.freeze([
  'unknown',
  'pass',
  'warning',
  'blocked',
  'skipped',
]);

export const DOCUMENT_NLP_STATUS_VALUES = Object.freeze([
  'pending',
  'processing',
  'ready',
  'degraded',
  'failed',
]);

export const SEMANTIC_PROFILES = Object.freeze({
  low: Object.freeze({
    splitThreshold: 0.30,
    severeBreakThreshold: 0.18,
    preferredMinChars: 600,
    targetChars: 700,
    maxChars: 800,
  }),
  medium: Object.freeze({
    splitThreshold: 0.42,
    severeBreakThreshold: 0.25,
    preferredMinChars: 450,
    targetChars: 650,
    maxChars: 800,
  }),
  high: Object.freeze({
    splitThreshold: 0.52,
    severeBreakThreshold: 0.32,
    preferredMinChars: 250,
    targetChars: 550,
    maxChars: 800,
  }),
});

const MAJOR_FEATURE_FLAGS = Object.freeze([
  'NLP_SERVICE_ENABLED',
  'NLP_UPLOAD_PARTITION_ENABLED',
  'NLP_LIVE_BLOCK_CHECK_ENABLED',
  'NLP_REWRITE_GATE_ENABLED',
  'NLP_ANALYZING_FLIP_CARD_ENABLED',
  'NLP_SEMANTIC_PROFILE_ENABLED',
  'NLP_REPARTITION_ENABLED',
  'MCP_CITATION_V2_ENABLED',
]);

export function environmentFlag(name, fallback = true) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return /^(?:1|true|yes|on)$/iu.test(value);
}

export function nlpFeatureFlags() {
  return Object.fromEntries(MAJOR_FEATURE_FLAGS.map((name) => [
    name,
    environmentFlag(name, true),
  ]));
}

export function normalizeSemanticProfile(value) {
  return Object.hasOwn(SEMANTIC_PROFILES, value) ? value : 'medium';
}

export function nlpVersionInfo() {
  return {
    contractVersion: NLP_CONTRACT_VERSION,
    pipelineVersion: CURRENT_NLP_PIPELINE_VERSION,
    partitionAlgorithmVersion: NLP_PARTITION_ALGORITHM_VERSION,
    spacyModel: NLP_SPACY_MODEL,
    embeddingModel: NLP_EMBEDDING_MODEL,
    grammarRulesVersion: NLP_GRAMMAR_RULES_VERSION,
    knownTermsVersion: NLP_KNOWN_TERMS_VERSION,
  };
}
