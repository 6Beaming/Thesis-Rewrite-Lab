import { query } from './db.js';

export async function getOwnedBlockContext({ documentId, blockId, userId }) {
  const result = await query(
    `
      with ordered_blocks as (
        select
          db.id,
          db.document_id,
          db.block_index,
          db.text_content,
          db.status,
          db.resume_status,
          db.change_source,
          db.partition_generation,
          d.academic_style,
          lag(db.text_content) over (order by db.block_index) as previous_text,
          lead(db.text_content) over (order by db.block_index) as next_text
        from document_blocks db
        join documents d on d.id = db.document_id
        where db.document_id = $1
          and d.user_id = $2
          and d.trashed = false
      )
      select *
      from ordered_blocks
      where id = $3
    `,
    [documentId, userId, blockId],
  );
  return result.rows[0] ?? null;
}

export async function findCachedBlockAnalysis({
  documentId,
  blockId,
  sourceTextHash,
  filterSignature,
  model,
  promptVersion,
}) {
  const result = await query(
    `
      select *
      from block_analyses
      where document_id = $1
        and block_id = $2
        and source_text_hash = $3
        and filter_signature = $4
        and model = $5
        and prompt_version = $6
      order by created_at desc
      limit 1
    `,
    [documentId, blockId, sourceTextHash, filterSignature, model, promptVersion],
  );
  return result.rows[0] ?? null;
}

export async function findLatestBlockAnalysis({
  documentId,
  blockId,
  sourceTextHash,
  promptVersion,
}) {
  const result = await query(
    `
      select *
      from block_analyses
      where document_id = $1
        and block_id = $2
        and source_text_hash = $3
        and ($4::text is null or prompt_version = $4)
      order by created_at desc
      limit 1
    `,
    [documentId, blockId, sourceTextHash, promptVersion ?? null],
  );
  return result.rows[0] ?? null;
}

export async function saveBlockAnalysis({
  documentId,
  blockId,
  sourceTextHash,
  filterSignature,
  filters,
  deterministicMetrics,
  result,
  usage,
  model,
  promptVersion,
}) {
  const saved = await query(
    `
      insert into block_analyses (
        document_id,
        block_id,
        source_text_hash,
        filter_signature,
        filters,
        deterministic_metrics,
        result_json,
        usage_json,
        model,
        prompt_version
      )
      values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10)
      on conflict (document_id, block_id, source_text_hash, filter_signature, model, prompt_version)
      do update set
        deterministic_metrics = excluded.deterministic_metrics,
        result_json = excluded.result_json,
        usage_json = excluded.usage_json,
        created_at = now()
      returning *
    `,
    [
      documentId,
      blockId,
      sourceTextHash,
      filterSignature,
      JSON.stringify(filters),
      JSON.stringify(deterministicMetrics),
      JSON.stringify(result),
      JSON.stringify(usage),
      model,
      promptVersion,
    ],
  );
  return saved.rows[0];
}

export function formatBlockAnalysis(row) {
  return {
    id: row.id,
    blockId: row.block_id,
    sourceTextHash: row.source_text_hash,
    filters: row.filters,
    deterministic: row.deterministic_metrics,
    ai: row.result_json,
    model: row.model,
    promptVersion: row.prompt_version,
    createdAt: row.created_at,
  };
}
