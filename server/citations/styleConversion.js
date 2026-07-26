import { withTransaction } from '../models/db.js';
import {
  recalculateDocumentProgress,
  replaceBlocksFromContentJson,
} from '../models/blocks.js';
import { appendDocumentVersion } from '../models/versions.js';
import { countCharacters } from '../../src/lib/blockSegmentation/index.js';
import { countCodePoints } from '../nlp/hash.js';
import { patchInlineContent } from './patches.js';
import {
  citationStyleFromAcademicStyle,
  planCitationStyleConversion,
} from './workflowRouter.js';

function resetNlpAttrs(attrs, text) {
  return {
    ...(attrs ?? {}),
    length: countCharacters(text),
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
}

function replaceChangedNodes(node, changesByBlock) {
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'blockSegment' && changesByBlock.has(node.attrs?.blockId)) {
    const changes = changesByBlock.get(node.attrs.blockId);
    let content = Array.isArray(node.content) ? node.content : [];
    let text = changes[0].blockText;
    for (const change of [...changes].sort((left, right) => right.startCp - left.startCp)) {
      content = patchInlineContent(content, change.startCp, change.endCp, change.replacementText);
    }
    const nextAttrs = resetNlpAttrs(node.attrs, text);
    return { ...node, attrs: nextAttrs, content };
  }
  if (!Array.isArray(node.content)) return node;
  return {
    ...node,
    content: node.content.map((child) => replaceChangedNodes(child, changesByBlock)),
  };
}

function compileContentChanges(plan, blocks) {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const changesByBlock = new Map();
  for (const change of plan.bibliographyChanges) {
    const block = blocksById.get(change.blockId);
    if (!block) continue;
    changesByBlock.set(change.blockId, [{
      phase: 'bibliography',
      startCp: 0,
      endCp: countCodePoints(block.text_content),
      replacementText: change.replacementText,
      blockText: change.replacementText,
    }]);
  }
  for (const change of plan.inlineChanges) {
    const block = blocksById.get(change.blockId);
    if (!block) continue;
    if (!changesByBlock.has(change.blockId)) changesByBlock.set(change.blockId, []);
    changesByBlock.get(change.blockId).push({
      phase: 'inline',
      startCp: change.anchor.citationStartCp,
      endCp: change.anchor.citationEndCp,
      replacementText: change.replacementText,
      blockText: plan.verification.inlineCitations.find(
        (citation) => citation.anchor.blockId === change.blockId,
      )?.anchor?.blockText ?? block.text_content,
    });
  }
  for (const [blockId, changes] of changesByBlock) {
    const block = blocksById.get(blockId);
    if (!block || changes.every((change) => change.phase === 'bibliography')) continue;
    let points = Array.from(block.text_content);
    for (const change of [...changes].sort((left, right) => right.startCp - left.startCp)) {
      if (change.phase !== 'inline') continue;
      points = [
        ...points.slice(0, change.startCp),
        ...Array.from(change.replacementText),
        ...points.slice(change.endCp),
      ];
    }
    for (const change of changes) change.blockText = points.join('');
  }
  return changesByBlock;
}

export async function convertDocumentCitationStyle({
  documentId,
  userId,
  targetAcademicStyle,
  targetStyleSettings,
  expectedRevision,
  expectedPartitionRevision,
}) {
  return withTransaction(async (client) => {
    const documentResult = await client.query(
      `select id, academic_style, content_json, revision, partition_revision
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
      const error = new Error('The document changed before the citation template could be applied.');
      error.statusCode = 409;
      error.publicCode = 'STALE_CITATION_STYLE_CONVERSION';
      throw error;
    }
    const blockResult = await client.query(
      `select * from document_blocks
       where document_id = $1
       order by block_index
       for update`,
      [documentId],
    );
    const sourceStyleName = document.academic_style === 'Customized'
      ? citationStyleFromAcademicStyle(targetAcademicStyle)
      : citationStyleFromAcademicStyle(document.academic_style);
    const targetStyleName = citationStyleFromAcademicStyle(targetAcademicStyle);
    const plan = planCitationStyleConversion({
      documentId,
      revision: Number(document.revision),
      partitionRevision: Number(document.partition_revision),
      blocks: blockResult.rows,
      sourceStyleName,
      targetStyleName,
    });
    const changesByBlock = compileContentChanges(plan, blockResult.rows);
    const nextContentJson = replaceChangedNodes(document.content_json, changesByBlock);
    const synchronized = await replaceBlocksFromContentJson(
      client,
      documentId,
      nextContentJson,
      targetStyleSettings,
    );
    const updated = await client.query(
      `update documents
       set academic_style = $2,
           style_settings = $3::jsonb,
           content_json = $4::jsonb,
           current_processing_block_id = $5,
           revision = revision + 1,
           nlp_status = 'pending'
       where id = $1
       returning revision, partition_revision`,
      [
        documentId,
        targetAcademicStyle,
        JSON.stringify(targetStyleSettings ?? {}),
        JSON.stringify(synchronized.contentJson),
        synchronized.currentProcessingBlockId,
      ],
    );
    await recalculateDocumentProgress(client, documentId);
    const version = await appendDocumentVersion(
      client,
      documentId,
      `Converted citations to ${targetAcademicStyle}`,
    );
    return {
      plan,
      version,
      revision: Number(updated.rows[0].revision),
      partitionRevision: Number(updated.rows[0].partition_revision),
    };
  });
}
