import { withTransaction } from '../models/db.js';
import { appendDocumentVersion } from '../models/versions.js';
import { validateCitationAnchor } from './citationAnchors.js';
import { countCharacters } from '../../src/lib/blockSegmentation/index.js';
import { countCodePoints, sliceCodePoints } from '../nlp/hash.js';

export function patchInlineContent(content, startCp, endCp, replacement) {
  let offset = 0;
  let inserted = false;
  const output = [];
  for (const node of content ?? []) {
    const source = node.type === 'hardBreak' ? '\n' : String(node.text ?? '');
    const nodeLength = countCodePoints(source);
    const nodeEnd = offset + nodeLength;
    if (nodeEnd <= startCp || offset >= endCp) {
      if (!inserted && offset >= endCp) {
        output.push({ type: 'text', text: replacement });
        inserted = true;
      }
      output.push(node);
      offset = nodeEnd;
      continue;
    }
    const prefix = sliceCodePoints(source, 0, Math.max(0, startCp - offset));
    const suffix = sliceCodePoints(source, Math.max(0, endCp - offset), nodeLength);
    if (prefix) output.push({ ...node, text: prefix });
    if (!inserted) {
      output.push({ ...node, type: 'text', text: replacement });
      inserted = true;
    }
    if (suffix) output.push({ ...node, text: suffix });
    offset = nodeEnd;
  }
  if (!inserted) output.push({ type: 'text', text: replacement });
  return output.filter((node) => node.type === 'hardBreak' || node.text);
}

export function replaceTrackedNode(node, blockId, replacementNode) {
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'blockSegment' && node.attrs?.blockId === blockId) return replacementNode;
  if (!Array.isArray(node.content)) return node;
  return {
    ...node,
    content: node.content.map((child) => replaceTrackedNode(child, blockId, replacementNode)),
  };
}

export async function applyCitationPatch({
  documentId,
  userId,
  expectedRevision,
  expectedPartitionRevision,
  anchor,
  replacementText,
}) {
  return withTransaction(async (client) => {
    const documentResult = await client.query(
      `select id, revision, partition_revision, content_json
       from documents
       where id = $1 and user_id = $2 and trashed = false
       for update`,
      [documentId, userId],
    );
    const document = documentResult.rows[0];
    if (!document) return null;
    if (
      Number(document.revision) !== Number(expectedRevision)
      || Number(document.partition_revision) !== Number(expectedPartitionRevision)
    ) {
      const error = new Error('The citation location is stale.');
      error.statusCode = 409;
      error.publicCode = 'STALE_CITATION_ANCHOR';
      throw error;
    }
    const blockResult = await client.query(
      `select * from document_blocks
       where document_id = $1 and id = $2
       for update`,
      [documentId, anchor.blockId],
    );
    const block = blockResult.rows[0];
    const validation = validateCitationAnchor(block, anchor);
    if (!validation.ok) {
      const error = new Error('The citation location is stale.');
      error.statusCode = 409;
      error.publicCode = validation.code;
      throw error;
    }
    const nextText = [
      sliceCodePoints(block.text_content, 0, anchor.citationStartCp),
      replacementText,
      sliceCodePoints(block.text_content, anchor.citationEndCp),
    ].join('');
    const nextAttrs = {
      ...(block.attrs ?? {}),
      length: countCharacters(nextText),
      changeSource: 'manual',
      nlpStatus: 'unknown',
      nlpReasonCodes: [],
      nlpAnalysis: {},
      nlpTextHash: null,
      nlpPipelineVersion: null,
      nlpSnapshotFingerprint: null,
      semanticCoherence: null,
      semanticAnchor: null,
      nlpCheckedAt: null,
    };
    const nextNode = {
      ...(block.tiptap_node ?? {}),
      attrs: nextAttrs,
      content: patchInlineContent(
        block.tiptap_node?.content ?? [{ type: 'text', text: block.text_content }],
        anchor.citationStartCp,
        anchor.citationEndCp,
        replacementText,
      ),
    };
    await client.query(
      `update document_blocks
       set text_content = $3, char_length = $4, attrs = $5::jsonb,
           tiptap_node = $6::jsonb, change_source = 'manual',
           nlp_status = 'unknown', nlp_reason_codes = '[]'::jsonb,
           nlp_analysis = '{}'::jsonb, nlp_text_hash = null,
           nlp_pipeline_version = null, nlp_snapshot_fingerprint = null,
           semantic_coherence = null, semantic_anchor = null, nlp_checked_at = null
       where document_id = $1 and id = $2`,
      [
        documentId,
        block.id,
        nextText,
        countCharacters(nextText),
        JSON.stringify(nextAttrs),
        JSON.stringify(nextNode),
      ],
    );
    const contentJson = replaceTrackedNode(document.content_json, block.id, nextNode);
    const updated = await client.query(
      `update documents
       set content_json = $2::jsonb, revision = revision + 1,
           nlp_status = 'pending'
       where id = $1
       returning revision, partition_revision`,
      [documentId, JSON.stringify(contentJson)],
    );
    const version = await appendDocumentVersion(client, documentId, 'Accepted citation patch');
    return {
      blockId: block.id,
      textContent: nextText,
      revision: Number(updated.rows[0].revision),
      partitionRevision: Number(updated.rows[0].partition_revision),
      version,
    };
  });
}
