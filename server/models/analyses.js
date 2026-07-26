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
          db.nlp_status,
          db.nlp_reason_codes,
          db.nlp_analysis,
          db.nlp_text_hash,
          db.nlp_pipeline_version,
          db.nlp_snapshot_fingerprint,
          db.semantic_coherence,
          db.semantic_anchor,
          d.academic_style,
          d.nlp_semantic_profile,
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
  partitionGeneration,
  filterSignature,
  nlpSnapshotFingerprint,
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
        and partition_generation = $4
        and filter_signature = $5
        and nlp_snapshot_fingerprint = $6
        and model = $7
        and prompt_version = $8
      order by created_at desc
      limit 1
    `,
    [
      documentId,
      blockId,
      sourceTextHash,
      partitionGeneration,
      filterSignature,
      nlpSnapshotFingerprint,
      model,
      promptVersion,
    ],
  );
  return result.rows[0] ?? null;
}

export async function findLatestBlockAnalysis({
  documentId,
  blockId,
  sourceTextHash,
  partitionGeneration,
  nlpSnapshotFingerprint,
  promptVersion,
}) {
  const result = await query(
    `
      select *
      from block_analyses
      where document_id = $1
        and block_id = $2
        and source_text_hash = $3
        and ($4::integer is null or partition_generation = $4)
        and ($5::text is null or nlp_snapshot_fingerprint = $5)
        and ($6::text is null or prompt_version = $6)
      order by created_at desc
      limit 1
    `,
    [
      documentId,
      blockId,
      sourceTextHash,
      partitionGeneration ?? null,
      nlpSnapshotFingerprint ?? null,
      promptVersion ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

export async function saveBlockAnalysis({
  documentId,
  blockId,
  sourceTextHash,
  partitionGeneration,
  filterSignature,
  nlpSnapshotFingerprint,
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
        partition_generation,
        filter_signature,
        nlp_snapshot_fingerprint,
        filters,
        deterministic_metrics,
        result_json,
        usage_json,
        model,
        prompt_version
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12)
      on conflict (
        document_id, block_id, source_text_hash, partition_generation,
        filter_signature, nlp_snapshot_fingerprint, model, prompt_version
      )
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
      partitionGeneration,
      filterSignature,
      nlpSnapshotFingerprint,
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
    partitionGeneration: Number(row.partition_generation) || 0,
    nlpSnapshotFingerprint: row.nlp_snapshot_fingerprint ?? 'none',
    filters: row.filters,
    deterministic: row.deterministic_metrics,
    ai: row.result_json,
    model: row.model,
    promptVersion: row.prompt_version,
    createdAt: row.created_at,
  };
}
