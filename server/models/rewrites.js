import { query } from './db.js';
import { CURRENT_NLP_PIPELINE_VERSION } from '../nlp/config.js';

export async function findCachedBlockRewrites({
  documentId,
  blockId,
  sourceTextHash,
  tones,
  model,
  promptVersion,
  nlpSupplementFingerprint = 'none',
}) {
  const result = await query(
    `
      select *
      from block_rewrite_options
      where document_id = $1
        and block_id = $2
        and source_text_hash = $3
        and tone = any($4::text[])
        and model = $5
        and prompt_version = $6
        and nlp_supplement_fingerprint = $7
      order by created_at desc
    `,
    [
      documentId,
      blockId,
      sourceTextHash,
      tones,
      model,
      promptVersion,
      nlpSupplementFingerprint,
    ],
  );
  return result.rows;
}

export async function saveBlockRewrite({
  documentId,
  blockId,
  sourceTextHash,
  option,
  usage,
  model,
  promptVersion,
  effectivePreferences = {},
  compiledPreferenceSupplement = '',
  preferenceWarnings = [],
  preferenceSchemaVersion = 1,
  preferenceCompilerVersion = 'writing-preferences-v1',
  nlpSupplementFingerprint = 'none',
  compiledNlpSupplement = '',
  nlpSnapshot = {},
}) {
  const result = await query(
    `
      insert into block_rewrite_options (
        document_id,
        block_id,
        source_text_hash,
        tone,
        rewritten_text,
        explanation,
        changes_json,
        meaning_preserved,
        warnings_json,
        usage_json,
        model,
        prompt_version,
        effective_preferences,
        compiled_preference_supplement,
        preference_warnings,
        preference_schema_version,
        preference_compiler_version,
        nlp_supplement_fingerprint,
        compiled_nlp_supplement,
        nlp_snapshot
      )
      values (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb,
        $11, $12, $13::jsonb, $14, $15::jsonb, $16, $17, $18, $19, $20::jsonb
      )
      on conflict (
        document_id, block_id, source_text_hash, tone, model, prompt_version,
        nlp_supplement_fingerprint
      )
      do update set
        rewritten_text = excluded.rewritten_text,
        explanation = excluded.explanation,
        changes_json = excluded.changes_json,
        meaning_preserved = excluded.meaning_preserved,
        warnings_json = excluded.warnings_json,
        usage_json = excluded.usage_json,
        effective_preferences = excluded.effective_preferences,
        compiled_preference_supplement = excluded.compiled_preference_supplement,
        preference_warnings = excluded.preference_warnings,
        preference_schema_version = excluded.preference_schema_version,
        preference_compiler_version = excluded.preference_compiler_version,
        compiled_nlp_supplement = excluded.compiled_nlp_supplement,
        nlp_snapshot = excluded.nlp_snapshot,
        accepted_at = null,
        created_at = now()
      returning *
    `,
    [
      documentId,
      blockId,
      sourceTextHash,
      option.tone,
      option.rewrittenText,
      option.explanation,
      JSON.stringify(option.changes),
      option.meaningPreserved,
      JSON.stringify(option.warnings),
      JSON.stringify(usage),
      model,
      promptVersion,
      JSON.stringify(effectivePreferences),
      compiledPreferenceSupplement,
      JSON.stringify(preferenceWarnings),
      preferenceSchemaVersion,
      preferenceCompilerVersion,
      nlpSupplementFingerprint,
      compiledNlpSupplement,
      JSON.stringify(nlpSnapshot),
    ],
  );
  return result.rows[0];
}

export async function markRewriteAccepted({ documentId, blockId, rewriteId, userId }) {
  const result = await query(
    `
      update block_rewrite_options bro
      set accepted_at = now()
      from documents d, document_blocks db
      where bro.id = $1
        and bro.document_id = $2
        and bro.block_id = $3
        and d.id = bro.document_id
        and d.user_id = $4
        and d.trashed = false
        and db.document_id = bro.document_id
        and db.id = bro.block_id
        and encode(digest(db.text_content, 'sha256'), 'hex') = bro.source_text_hash
        and db.nlp_status in ('pass', 'warning')
        and db.nlp_text_hash = encode(digest(db.text_content, 'sha256'), 'hex')
        and db.nlp_pipeline_version = $5
        and bro.meaning_preserved = true
      returning bro.*
    `,
    [rewriteId, documentId, blockId, userId, CURRENT_NLP_PIPELINE_VERSION],
  );
  return result.rows[0] ?? null;
}

export function formatBlockRewrite(row) {
  return {
    id: row.id,
    blockId: row.block_id,
    sourceTextHash: row.source_text_hash,
    tone: row.tone,
    rewrittenText: row.rewritten_text,
    explanation: row.explanation,
    changes: row.changes_json,
    meaningPreserved: row.meaning_preserved,
    warnings: row.warnings_json,
    model: row.model,
    promptVersion: row.prompt_version,
    effectivePreferences: row.effective_preferences ?? {},
    compiledPreferenceSupplement: row.compiled_preference_supplement ?? '',
    preferenceWarnings: row.preference_warnings ?? [],
    preferenceSchemaVersion: Number(row.preference_schema_version) || 1,
    preferenceCompilerVersion: row.preference_compiler_version ?? 'writing-preferences-v1',
    nlpSupplementFingerprint: row.nlp_supplement_fingerprint ?? 'none',
    compiledNlpSupplement: row.compiled_nlp_supplement ?? '',
    nlpSnapshot: row.nlp_snapshot ?? {},
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
  };
}
