import { query } from './db.js';

export async function findCachedPracticeFeedback({
  documentId,
  blockId,
  sourceTextHash,
  attemptTextHash,
  analysisContextKey,
  model,
  promptVersion,
}) {
  const result = await query(
    `
      select *
      from block_practice_attempts
      where document_id = $1
        and block_id = $2
        and source_text_hash = $3
        and attempt_text_hash = $4
        and analysis_context_key = $5
        and model = $6
        and prompt_version = $7
      order by created_at desc
      limit 1
    `,
    [
      documentId,
      blockId,
      sourceTextHash,
      attemptTextHash,
      analysisContextKey,
      model,
      promptVersion,
    ],
  );
  return result.rows[0] ?? null;
}

export async function savePracticeFeedback({
  documentId,
  blockId,
  sourceTextHash,
  attemptText,
  attemptTextHash,
  analysisContextKey,
  result,
  usage,
  model,
  promptVersion,
}) {
  const saved = await query(
    `
      insert into block_practice_attempts (
        document_id,
        block_id,
        source_text_hash,
        attempt_text,
        attempt_text_hash,
        analysis_context_key,
        feedback_json,
        usage_json,
        model,
        prompt_version
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
      on conflict (
        document_id,
        block_id,
        source_text_hash,
        attempt_text_hash,
        analysis_context_key,
        model,
        prompt_version
      )
      do update set
        attempt_text = excluded.attempt_text,
        feedback_json = excluded.feedback_json,
        usage_json = excluded.usage_json,
        created_at = now()
      returning *
    `,
    [
      documentId,
      blockId,
      sourceTextHash,
      attemptText,
      attemptTextHash,
      analysisContextKey,
      JSON.stringify(result),
      JSON.stringify(usage),
      model,
      promptVersion,
    ],
  );
  return saved.rows[0];
}

export function formatPracticeFeedback(row) {
  return {
    id: row.id,
    blockId: row.block_id,
    sourceTextHash: row.source_text_hash,
    attemptText: row.attempt_text,
    analysisContextKey: row.analysis_context_key,
    ...row.feedback_json,
    model: row.model,
    promptVersion: row.prompt_version,
    createdAt: row.created_at,
  };
}
