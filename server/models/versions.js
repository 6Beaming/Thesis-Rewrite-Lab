import { query, withTransaction } from './db.js';
import { replaceBlocksFromSnapshot, recalculateDocumentProgress } from './blocks.js';
import { CURRENT_NLP_PIPELINE_VERSION } from '../nlp/config.js';

export async function appendDocumentVersion(client, documentId, label) {
  const documentResult = await client.query(
    `
      select id, title, academic_style, style_settings, content_json, revision,
             completed_chars, total_chars, completed_rate, current_processing_block_id,
             nlp_semantic_profile, nlp_status, nlp_pipeline_version,
             nlp_document_snapshot, partition_revision
      from documents
      where id = $1
    `,
    [documentId]
  );
  const document = documentResult.rows[0];

  const blocksResult = await client.query(
    `
      select id, document_id, block_index, text_content, status, resume_status,
             processing_baseline_text, change_source, partition_generation,
             format_overrides, char_length, attrs, tiptap_node,
             nlp_status, nlp_reason_codes, nlp_analysis, nlp_text_hash,
             nlp_pipeline_version, nlp_snapshot_fingerprint, semantic_coherence,
             semantic_anchor, nlp_checked_at
      from document_blocks
      where document_id = $1
      order by block_index asc
    `,
    [documentId]
  );

  const nextVersion = await client.query(
    `
      select coalesce(max(version_number), 0) + 1 as next_version
      from document_versions
      where document_id = $1
    `,
    [documentId]
  );

  const preview = blocksResult.rows
    .map((block) => block.text_content)
    .join(' ')
    .slice(0, 180);

  const snapshot = {
    document,
    blocks: blocksResult.rows,
  };

  const inserted = await client.query(
    `
      insert into document_versions (
        document_id, version_number, label, academic_style_snapshot, text_preview, snapshot_json
      )
      values ($1, $2, $3, $4, $5, $6::jsonb)
      returning id, document_id, version_number, label, academic_style_snapshot, text_preview, created_at
    `,
    [
      documentId,
      Number(nextVersion.rows[0].next_version),
      label,
      document.academic_style,
      preview || 'Text preview is not available',
      JSON.stringify(snapshot),
    ]
  );

  return inserted.rows[0];
}

export async function listVersions(documentId, userId) {
  const result = await query(
    `
      select dv.id, dv.document_id, dv.version_number, dv.label, dv.academic_style_snapshot, dv.text_preview, dv.created_at
      from document_versions dv
      join documents d on d.id = dv.document_id
      where dv.document_id = $1
        and d.user_id = $2
      order by version_number desc
    `,
    [documentId, userId]
  );
  return result.rows;
}

export async function getVersion(documentId, versionId, userId) {
  const result = await query(
    `
      select dv.id, dv.document_id, dv.version_number, dv.label, dv.academic_style_snapshot,
             dv.text_preview, dv.snapshot_json, dv.created_at
      from document_versions dv
      join documents d on d.id = dv.document_id
      where dv.document_id = $1
        and dv.id = $2
        and d.user_id = $3
    `,
    [documentId, versionId, userId]
  );
  return result.rows[0] ?? null;
}

export async function revertDocumentToVersion(documentId, versionId, userId) {
  return withTransaction(async (client) => {
    const versionResult = await client.query(
      `
        select dv.version_number, dv.snapshot_json
        from document_versions dv
        join documents d on d.id = dv.document_id
        where dv.document_id = $1
          and dv.id = $2
          and d.user_id = $3
          and d.trashed = false
        for update of d
      `,
      [documentId, versionId, userId]
    );
    const version = versionResult.rows[0];
    if (!version) {
      return null;
    }

    const snapshot = version.snapshot_json;
    const document = snapshot.document;
    const nlpSnapshotCurrent = document.nlp_pipeline_version === CURRENT_NLP_PIPELINE_VERSION;

    await replaceBlocksFromSnapshot(client, documentId, snapshot.blocks ?? []);
    await client.query(
      `
        update documents
        set title = $2,
            academic_style = $3,
            style_settings = $4::jsonb,
            content_json = $5::jsonb,
            current_processing_block_id = $6,
            nlp_semantic_profile = $7,
            nlp_status = $8,
            nlp_pipeline_version = $9,
            nlp_document_snapshot = $10::jsonb,
            partition_revision = $11,
            revision = revision + 1
        where id = $1
      `,
      [
        documentId,
        document.title,
        document.academic_style,
        JSON.stringify(document.style_settings ?? {}),
        JSON.stringify(document.content_json ?? { type: 'doc', content: [] }),
        document.current_processing_block_id ?? null,
        document.nlp_semantic_profile ?? 'medium',
        nlpSnapshotCurrent ? (document.nlp_status ?? 'pending') : 'pending',
        nlpSnapshotCurrent ? document.nlp_pipeline_version : null,
        JSON.stringify(nlpSnapshotCurrent ? (document.nlp_document_snapshot ?? {}) : {}),
        Number(document.partition_revision) || 0,
      ]
    );
    await recalculateDocumentProgress(client, documentId);
    const appendedVersion = await appendDocumentVersion(
      client,
      documentId,
      `Reverted to Version ${version.version_number}`
    );
    const documentResult = await client.query(
      `
        select id, title, academic_style, style_settings, content_json,
               completed_chars, total_chars, completed_rate,
               current_processing_block_id, revision, trashed, trashed_at,
               nlp_semantic_profile, nlp_status, nlp_pipeline_version,
               nlp_document_snapshot, partition_revision,
               created_at, updated_at
        from documents
        where id = $1 and user_id = $2
      `,
      [documentId, userId]
    );
    const blocksResult = await client.query(
      `
        select id, block_index, text_content, status, resume_status,
               processing_baseline_text, change_source, partition_generation,
               format_overrides, char_length, attrs, tiptap_node,
               nlp_status, nlp_reason_codes, nlp_analysis, nlp_text_hash,
               nlp_pipeline_version, nlp_snapshot_fingerprint, semantic_coherence,
               semantic_anchor, nlp_checked_at,
               created_at, updated_at
        from document_blocks
        where document_id = $1
        order by block_index
      `,
      [documentId]
    );

    return {
      version: appendedVersion,
      document: {
        ...documentResult.rows[0],
        blocks: blocksResult.rows,
      },
    };
  });
}
