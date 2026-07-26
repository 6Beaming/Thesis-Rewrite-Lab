import { query } from './db.js';

export async function findCitationResult({
  documentId,
  documentRevision,
  partitionRevision,
  workflow,
  requestFingerprint,
}) {
  const result = await query(
    `select * from document_citation_results
     where document_id = $1 and document_revision = $2
       and partition_revision = $3 and workflow = $4
       and request_fingerprint = $5`,
    [documentId, documentRevision, partitionRevision, workflow, requestFingerprint],
  );
  return result.rows[0] ?? null;
}

export async function saveCitationResult({
  documentId,
  documentRevision,
  partitionRevision,
  workflow,
  requestFingerprint,
  result,
  rendererVersion = null,
}) {
  const saved = await query(
    `insert into document_citation_results (
       document_id, document_revision, partition_revision, workflow,
       request_fingerprint, result_json, renderer_version
     ) values ($1, $2, $3, $4, $5, $6::jsonb, $7)
     on conflict (
       document_id, document_revision, partition_revision, workflow, request_fingerprint
     ) do update set result_json = excluded.result_json,
       renderer_version = excluded.renderer_version
     returning *`,
    [
      documentId,
      documentRevision,
      partitionRevision,
      workflow,
      requestFingerprint,
      JSON.stringify(result),
      rendererVersion,
    ],
  );
  return saved.rows[0];
}
