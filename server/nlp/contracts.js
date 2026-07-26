import { z } from 'zod';
import {
  CURRENT_NLP_PIPELINE_VERSION,
  NLP_STATUS_VALUES,
  normalizeSemanticProfile,
} from './config.js';
import { hashNlpText, stableFingerprint } from './hash.js';

const ConfidenceSchema = z.enum(['low', 'medium', 'high']);
const NlpStatusSchema = z.enum(NLP_STATUS_VALUES);

export const NlpIssueSchema = z.object({
  startCp: z.number().int().nonnegative(),
  endCp: z.number().int().nonnegative(),
  code: z.string().trim().min(1).max(80),
  severity: z.enum(['warning', 'blocking']),
  message: z.string().trim().min(1).max(500),
  original: z.string().max(200).optional(),
  suggestion: z.string().max(200).optional(),
  confidence: ConfidenceSchema.optional(),
}).refine((issue) => issue.endCp >= issue.startCp, {
  message: 'Issue end offset must not precede its start offset.',
});

export const TemporarySentenceSchema = z.object({
  index: z.number().int().nonnegative(),
  startCp: z.number().int().nonnegative(),
  endCp: z.number().int().nonnegative(),
  textHash: z.string().length(64),
  status: NlpStatusSchema,
  issues: z.array(NlpIssueSchema).default([]),
  entities: z.array(z.string().max(160)).default([]),
  nounChunks: z.array(z.string().max(160)).default([]),
  topicTerms: z.array(z.string().max(120)).default([]),
  reasonCodes: z.array(z.string().max(80)).default([]),
  sourceType: z.string().max(80).default('paragraph'),
  hardBoundaryBefore: z.boolean().default(false),
  oversizedSentence: z.boolean().default(false),
}).refine((sentence) => sentence.endCp >= sentence.startCp, {
  message: 'Sentence end offset must not precede its start offset.',
});

export const SemanticAnchorSchema = z.object({
  topicTerms: z.array(z.string().max(120)).max(8),
  representativeStartCp: z.number().int().nonnegative().optional(),
  representativeEndCp: z.number().int().nonnegative().optional(),
  confidence: ConfidenceSchema,
});

export const AnalyzeBlockResultSchema = z.object({
  textHash: z.string().length(64),
  pipelineVersion: z.string().min(1),
  contractVersion: z.string().min(1).optional(),
  status: NlpStatusSchema,
  reasonCodes: z.array(z.string().max(80)).default([]),
  sentenceCount: z.number().int().nonnegative(),
  sentences: z.array(TemporarySentenceSchema),
  issues: z.array(NlpIssueSchema).default([]),
  issueCounts: z.object({
    warning: z.number().int().nonnegative(),
    blocking: z.number().int().nonnegative(),
  }),
  semanticCoherence: z.number().min(0).max(1).nullable(),
  semanticAnchor: SemanticAnchorSchema.nullable(),
  rewriteEligible: z.boolean(),
  degraded: z.boolean().default(false),
  analysisWarnings: z.array(z.string().max(200)).default([]),
});

export const NlpBlockCandidateSchema = z.object({
  text: z.string(),
  startCp: z.number().int().nonnegative(),
  endCp: z.number().int().nonnegative(),
  paragraphIndex: z.number().int().nonnegative(),
  sourceType: z.string().max(80),
  level: z.number().int().nullable().default(null),
  initialStatus: z.enum(['unprocessed', 'skipped']),
  nlpStatus: NlpStatusSchema,
  reasonCodes: z.array(z.string().max(80)),
  semanticCoherence: z.number().min(0).max(1).nullable(),
  semanticAnchor: SemanticAnchorSchema.nullable(),
  nlpAnalysis: AnalyzeBlockResultSchema,
  oversizedSentence: z.boolean().default(false),
});

export const PartitionDocumentResultSchema = z.object({
  pipelineVersion: z.string().min(1),
  semanticProfile: z.enum(['low', 'medium', 'high']),
  candidates: z.array(NlpBlockCandidateSchema),
  degraded: z.boolean().default(false),
  warnings: z.array(z.string().max(200)).default([]),
});

export function createNlpSnapshotFingerprint(result, semanticProfile = 'medium') {
  const parsed = AnalyzeBlockResultSchema.parse(result);
  return stableFingerprint({
    nlpTextHash: parsed.textHash,
    nlpPipelineVersion: parsed.pipelineVersion,
    semanticProfile: normalizeSemanticProfile(semanticProfile),
    nlpStatus: parsed.status,
    issueCodes: [...new Set(parsed.issues.map((issue) => issue.code))].sort(),
    semanticAnchorFingerprint: parsed.semanticAnchor
      ? stableFingerprint(parsed.semanticAnchor)
      : null,
  });
}

export function emptyUnknownNlpSnapshot(text = '', {
  pipelineVersion = CURRENT_NLP_PIPELINE_VERSION,
  warning = 'Automatic language review has not completed.',
} = {}) {
  return {
    textHash: hashNlpText(text),
    pipelineVersion,
    status: 'unknown',
    reasonCodes: [],
    sentenceCount: 0,
    sentences: [],
    issues: [],
    issueCounts: { warning: 0, blocking: 0 },
    semanticCoherence: null,
    semanticAnchor: null,
    rewriteEligible: false,
    degraded: true,
    analysisWarnings: [warning],
  };
}

export function normalizeBlockNlpSnapshot(result, semanticProfile = 'medium') {
  const parsed = AnalyzeBlockResultSchema.parse(result);
  return {
    status: parsed.status,
    reasonCodes: parsed.reasonCodes,
    analysis: parsed,
    textHash: parsed.textHash,
    pipelineVersion: parsed.pipelineVersion,
    snapshotFingerprint: createNlpSnapshotFingerprint(parsed, semanticProfile),
    semanticCoherence: parsed.semanticCoherence,
    semanticAnchor: parsed.semanticAnchor,
    checkedAt: new Date().toISOString(),
  };
}
