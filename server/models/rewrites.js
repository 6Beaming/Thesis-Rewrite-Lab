import { query } from './db.js';

export async function findCachedBlockRewrites({
  documentId,
  blockId,
  sourceTextHash,
  tones,
  model,
  promptVersion,
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
      order by created_at desc
    `,
    [documentId, blockId, sourceTextHash, tones, model, promptVersion],
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
        prompt_version
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb, $11, $12)
      on conflict (document_id, block_id, source_text_hash, tone, model, prompt_version)
      do update set
        rewritten_text = excluded.rewritten_text,
        explanation = excluded.explanation,
        changes_json = excluded.changes_json,
        meaning_preserved = excluded.meaning_preserved,
        warnings_json = excluded.warnings_json,
        usage_json = excluded.usage_json,
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
        and bro.meaning_preserved = true
      returning bro.*
    `,
    [rewriteId, documentId, blockId, userId],
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
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
  };
}
