import { randomUUID } from 'crypto';
import { query, withTransaction } from './db.js';
import { countCharacters } from '../../src/lib/blockSegmentation/index.js';
import {
  normalizeBlockStatus,
  normalizeChangeSource,
  normalizeResumeStatus,
} from '../../src/lib/blockState.js';
import {
  blockNlpFields,
  isRewriteEligibleBlock,
  nlpAttrs,
  normalizePersistedBlockNlp,
  persistedNlpSnapshot,
} from '../nlp/blockAggregation.js';
import { CURRENT_NLP_PIPELINE_VERSION } from '../nlp/config.js';
import { hashNlpText } from '../nlp/hash.js';
import { applyLanguageIssueRejections } from '../../src/lib/nlp/issueRejections.js';

const DEFAULT_BLOCK_ATTRS = {
  lineHeight: '2.0',
  textIndent: '0.5in',
  textAlign: 'left',
  fontFamily: 'Times New Roman',
  fontSize: '12pt',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRUCTURAL_TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading']);

function styleAttrsFromSettings(styleSettings = {}) {
  return {
    ...(styleSettings.font || styleSettings.fontFamily ? {
      fontFamily: styleSettings.font || styleSettings.fontFamily,
    } : {}),
    ...(styleSettings.spacing || styleSettings.lineHeight ? {
      lineHeight: styleSettings.spacing || styleSettings.lineHeight,
    } : {}),
    ...(styleSettings.indentation || styleSettings.textIndent ? {
      textIndent: styleSettings.indentation || styleSettings.textIndent,
    } : {}),
    ...(styleSettings.fontSize ? { fontSize: styleSettings.fontSize } : {}),
    ...(styleSettings.textAlign ? { textAlign: styleSettings.textAlign } : {}),
  };
}

function textFromNode(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (!Array.isArray(node.content)) return '';
  return node.content.map(textFromNode).join('');
}

function validBlockId(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function normalizeBlockInput(input) {
  if (typeof input === 'string') {
    return {
      text: input,
      attrs: { paragraphIndex: null },
      content: input ? [{ type: 'text', text: input }] : [],
      initialStatus: null,
      nlp: null,
    };
  }

  const text = String(input?.text ?? '');
  const content = Array.isArray(input?.content) && input.content.length
    ? input.content
    : (text ? [{ type: 'text', text }] : []);

  return {
    text,
    attrs: input?.attrs ?? {},
    content,
    initialStatus: input?.initialStatus ?? null,
    nlp: input?.nlp ?? input?.nlpAnalysis ?? null,
  };
}

export function createBlockRecords(textBlocks, styleSettings = {}) {
  const mergedAttrs = { ...DEFAULT_BLOCK_ATTRS, ...styleSettings };
  const normalizedBlocks = textBlocks.map(normalizeBlockInput);
  const hasExplicitNlp = normalizedBlocks.some((block) => block.nlp?.pipelineVersion);
  const firstEligibleIndex = hasExplicitNlp
    ? normalizedBlocks.findIndex((block) => (
      block.initialStatus !== 'skipped'
      && ['pass', 'warning'].includes(block.nlp?.status)
    ))
    : 0;
  return normalizedBlocks.map((normalized, index) => {
    const id = randomUUID();
    const baseStatus = normalized.initialStatus === 'skipped' ? 'skipped' : 'unprocessed';
    const status = index === firstEligibleIndex ? 'processing' : baseStatus;
    const resumeStatus = index === firstEligibleIndex ? baseStatus : null;
    const processingBaselineText = index === firstEligibleIndex ? normalized.text : null;
    const charLength = countCharacters(normalized.text);
    const formatOverrides = Array.isArray(normalized.attrs.formatOverrides)
      ? [...new Set(normalized.attrs.formatOverrides)]
      : [];
    const normalizedNlp = normalized.nlp?.pipelineVersion
      ? persistedNlpSnapshot(normalized.nlp, normalized.attrs.semanticProfile ?? 'medium')
      : {
        nlpStatus: normalized.initialStatus === 'skipped' ? 'skipped' : 'unknown',
        nlpReasonCodes: normalized.nlp?.reasonCodes ?? [],
        nlpAnalysis: normalized.nlp ?? {},
        nlpTextHash: normalized.nlp?.textHash ?? null,
        nlpPipelineVersion: normalized.nlp?.pipelineVersion ?? null,
        nlpSnapshotFingerprint: null,
        semanticCoherence: normalized.nlp?.semanticCoherence ?? null,
        semanticAnchor: normalized.nlp?.semanticAnchor ?? null,
        nlpCheckedAt: null,
      };
    const attrs = {
      ...mergedAttrs,
      ...normalized.attrs,
      paragraphIndex: Number.isInteger(normalized.attrs.paragraphIndex)
        ? normalized.attrs.paragraphIndex
        : index,
      blockId: id,
      status,
      resumeStatus,
      processingBaselineText,
      changeSource: 'none',
      partitionGeneration: 0,
      formatOverrides,
      length: charLength,
      ...nlpAttrs(normalizedNlp),
    };

    return {
      id,
      blockIndex: index,
      textContent: normalized.text,
      status,
      resumeStatus,
      processingBaselineText,
      changeSource: 'none',
      partitionGeneration: 0,
      formatOverrides,
      charLength,
      ...normalizedNlp,
      attrs,
      tiptapNode: {
        type: 'blockSegment',
        attrs,
        content: normalized.content,
      },
    };
  });
}

export function createContentJson(blocks) {
  const paragraphs = [];

  for (const block of blocks) {
    const paragraphIndex = block.attrs.paragraphIndex;
    let paragraph = paragraphs.at(-1);
    if (!paragraph || paragraph.paragraphIndex !== paragraphIndex) {
      paragraph = {
        paragraphIndex,
        attrs: {
          lineHeight: block.attrs.lineHeight,
          textIndent: block.attrs.textIndent,
          textAlign: block.attrs.textAlign,
          fontFamily: block.attrs.fontFamily,
          fontSize: block.attrs.fontSize,
        },
        content: [],
        lastText: '',
      };
      paragraphs.push(paragraph);
    }

    if (
      paragraph.content.length
      && !/\s$/u.test(paragraph.lastText)
      && !/^\s/u.test(block.textContent)
    ) {
      paragraph.content.push({ type: 'text', text: ' ' });
    }
    paragraph.content.push(block.tiptapNode);
    paragraph.lastText = block.textContent;
  }

  return {
    type: 'doc',
    content: paragraphs.map((paragraph) => {
      const firstSegment = paragraph.content.find((node) => node.type === 'blockSegment');
      const sourceType = firstSegment?.attrs?.sourceType ?? 'paragraph';
      const isHeading = sourceType === 'heading';
      return {
        type: isHeading ? 'heading' : 'paragraph',
        attrs: {
          ...paragraph.attrs,
          outlineLevel: isHeading ? String(firstSegment?.attrs?.level ?? 1) : 'none',
          ...(isHeading ? { level: Number(firstSegment?.attrs?.level) || 1 } : {}),
        },
        content: paragraph.content,
      };
    }),
  };
}

export async function insertBlocks(client, documentId, blocks) {
  for (const block of blocks) {
    await client.query(
      `
        insert into document_blocks (
          id, document_id, block_index, text_content, status, resume_status,
          processing_baseline_text, change_source, partition_generation,
          format_overrides, char_length, attrs, tiptap_node,
          nlp_status, nlp_reason_codes, nlp_analysis, nlp_text_hash,
          nlp_pipeline_version, nlp_snapshot_fingerprint, semantic_coherence,
          semantic_anchor, nlp_checked_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13::jsonb,
          $14, $15::jsonb, $16::jsonb, $17, $18, $19, $20, $21::jsonb, $22
        )
      `,
      [
        block.id,
        documentId,
        block.blockIndex,
        block.textContent,
        block.status,
        block.resumeStatus,
        block.processingBaselineText,
        block.changeSource,
        block.partitionGeneration,
        JSON.stringify(block.formatOverrides),
        block.charLength,
        JSON.stringify(block.attrs),
        JSON.stringify(block.tiptapNode),
        block.nlpStatus ?? 'unknown',
        JSON.stringify(block.nlpReasonCodes ?? []),
        JSON.stringify(block.nlpAnalysis ?? {}),
        block.nlpTextHash ?? null,
        block.nlpPipelineVersion ?? null,
        block.nlpSnapshotFingerprint ?? null,
        block.semanticCoherence ?? null,
        JSON.stringify(block.semanticAnchor ?? null),
        block.nlpCheckedAt ?? null,
      ]
    );
  }
}

export async function getBlocksByDocument(documentId) {
  const result = await query(
    `
      select id, document_id, block_index, text_content, status, resume_status,
             processing_baseline_text, change_source, partition_generation,
             format_overrides, char_length, attrs, tiptap_node,
             nlp_status, nlp_reason_codes, nlp_analysis, nlp_text_hash,
             nlp_pipeline_version, nlp_snapshot_fingerprint, semantic_coherence,
             semantic_anchor, nlp_checked_at, created_at, updated_at
      from document_blocks
      where document_id = $1
      order by block_index asc
    `,
    [documentId]
  );
  return result.rows;
}

export async function recalculateDocumentProgress(client, documentId) {
  const result = await client.query(
    `
      select
        coalesce(sum(char_length), 0)::int as total_chars,
        coalesce(sum(case when status in ('processed', 'skipped') then char_length else 0 end), 0)::int as completed_chars
      from document_blocks
      where document_id = $1
    `,
    [documentId]
  );

  const totalChars = Number(result.rows[0]?.total_chars ?? 0);
  const completedChars = Number(result.rows[0]?.completed_chars ?? 0);
  const completedRate = totalChars > 0 ? completedChars / totalChars : 0;

  await client.query(
    `
      update documents
      set total_chars = $2,
          completed_chars = $3,
          completed_rate = $4
      where id = $1
    `,
    [documentId, totalChars, completedChars, completedRate]
  );

  const owner = await client.query('select user_id from documents where id = $1', [documentId]);
  if (owner.rows[0]) {
    await recalculateUserProgress(client, owner.rows[0].user_id);
  }

  return { totalChars, completedChars, completedRate };
}

export async function recalculateUserProgress(client, userId) {
  const result = await client.query(
    `
      select
        coalesce(sum(total_chars), 0)::int as total_chars,
        coalesce(sum(completed_chars), 0)::int as completed_chars
      from documents
      where user_id = $1
        and trashed = false
    `,
    [userId]
  );
  const totalChars = Number(result.rows[0]?.total_chars ?? 0);
  const completedChars = Number(result.rows[0]?.completed_chars ?? 0);
  const completedRate = totalChars > 0 ? completedChars / totalChars : 0;

  await client.query(
    `
      update user_stats
      set total_chars = $2,
          completed_chars = $3,
          completed_rate = $4,
          updated_at = now()
      where user_id = $1
    `,
    [userId, totalChars, completedChars, completedRate]
  );

  return { totalChars, completedChars, completedRate };
}

export async function chooseNextProcessingBlock(client, documentId, fromBlockId = null) {
  const blocks = await client.query(
    `
      select id, block_index, text_content, status, resume_status,
             partition_generation, nlp_status, nlp_text_hash,
             nlp_pipeline_version, nlp_snapshot_fingerprint, attrs
      from document_blocks
      where document_id = $1
      order by block_index asc
    `,
    [documentId]
  );

  const rows = blocks.rows;
  const currentIndex = rows.find((row) => row.id === fromBlockId)?.block_index ?? -1;
  const eligible = rows.filter((row) => (
    row.status === 'unprocessed'
    && isRewriteEligibleBlock(row)
  ));
  const below = eligible.find((row) => row.block_index > currentIndex);
  const wrapped = eligible[0] ?? null;
  const repair = rows.find((row) => (
    row.status === 'unprocessed'
    && !isRewriteEligibleBlock(row)
  ));
  const next = below ?? wrapped ?? repair ?? null;

  await client.query(
    `
      update document_blocks
      set status = case
            when text_content = processing_baseline_text then coalesce(resume_status, 'unprocessed')
            else 'unprocessed'
          end,
          resume_status = null,
          processing_baseline_text = null,
          change_source = case
            when text_content = processing_baseline_text then 'none'
            else 'manual'
          end,
          attrs = attrs || jsonb_build_object(
            'status', case
              when text_content = processing_baseline_text then coalesce(resume_status, 'unprocessed')
              else 'unprocessed'
            end,
            'resumeStatus', null,
            'processingBaselineText', null,
            'changeSource', case
              when text_content = processing_baseline_text then 'none'
              else 'manual'
            end
          ),
          tiptap_node = jsonb_set(
            tiptap_node,
            '{attrs}',
            coalesce(tiptap_node->'attrs', '{}'::jsonb) || jsonb_build_object(
              'status', case
                when text_content = processing_baseline_text then coalesce(resume_status, 'unprocessed')
                else 'unprocessed'
              end,
              'resumeStatus', null,
              'processingBaselineText', null,
              'changeSource', case
                when text_content = processing_baseline_text then 'none'
                else 'manual'
              end
            ),
            true
          )
      where document_id = $1
        and status = 'processing'
        and ($2::uuid is null or id <> $2)
    `,
    [documentId, next?.id ?? null]
  );

  if (next) {
    await client.query(
      `
        update document_blocks
        set status = 'processing',
            resume_status = 'unprocessed',
            processing_baseline_text = text_content,
            change_source = 'none',
            attrs = attrs || jsonb_build_object(
              'status', 'processing',
              'resumeStatus', 'unprocessed',
              'processingBaselineText', text_content,
              'changeSource', 'none'
            ),
            tiptap_node = jsonb_set(
              tiptap_node,
              '{attrs}',
              coalesce(tiptap_node->'attrs', '{}'::jsonb) || jsonb_build_object(
                'status', 'processing',
                'resumeStatus', 'unprocessed',
                'processingBaselineText', text_content,
                'changeSource', 'none'
              ),
              true
            )
        where document_id = $1
          and id = $2
      `,
      [documentId, next.id]
    );
  }

  await client.query(
    `
      update documents
      set current_processing_block_id = $2
      where id = $1
    `,
    [documentId, next?.id ?? null]
  );

  return next;
}

export async function updateBlockStatus(client, { documentId, blockId, status }) {
  const target = await client.query(
    `
      select id, status, text_content, resume_status, processing_baseline_text
      from document_blocks
      where document_id = $1
        and id = $2
      for update
    `,
    [documentId, blockId]
  );
  if (!target.rows[0]) {
    return { found: false, next: null };
  }

  if (status === 'processing') {
    await client.query(
      `
        update document_blocks
        set status = case
              when text_content = processing_baseline_text then coalesce(resume_status, 'unprocessed')
              else 'unprocessed'
            end,
            resume_status = null,
            processing_baseline_text = null,
            change_source = case
              when text_content = processing_baseline_text then 'none'
              else 'manual'
            end,
            attrs = attrs || jsonb_build_object(
              'status', case
                when text_content = processing_baseline_text then coalesce(resume_status, 'unprocessed')
                else 'unprocessed'
              end,
              'resumeStatus', null,
              'processingBaselineText', null,
              'changeSource', case
                when text_content = processing_baseline_text then 'none'
                else 'manual'
              end
            ),
            tiptap_node = jsonb_set(
              tiptap_node,
              '{attrs}',
              coalesce(tiptap_node->'attrs', '{}'::jsonb) || jsonb_build_object(
                'status', case
                  when text_content = processing_baseline_text then coalesce(resume_status, 'unprocessed')
                  else 'unprocessed'
                end,
                'resumeStatus', null,
                'processingBaselineText', null,
                'changeSource', case
                  when text_content = processing_baseline_text then 'none'
                  else 'manual'
                end
              ),
              true
            )
        where document_id = $1
          and status = 'processing'
          and id <> $2
      `,
      [documentId, blockId]
    );
  }

  if (status === 'processing') {
    await client.query(
      `
        update document_blocks
        set status = 'processing',
            resume_status = case when status = 'processing'
              then coalesce(resume_status, 'unprocessed')
              else status
            end,
            processing_baseline_text = case when status = 'processing'
              then coalesce(processing_baseline_text, text_content)
              else text_content
            end,
            change_source = 'none',
            attrs = attrs || jsonb_build_object(
              'status', 'processing',
              'resumeStatus', case when status = 'processing'
                then coalesce(resume_status, 'unprocessed')
                else status
              end,
              'processingBaselineText', case when status = 'processing'
                then coalesce(processing_baseline_text, text_content)
                else text_content
              end,
              'changeSource', 'none'
            ),
            tiptap_node = jsonb_set(
              tiptap_node,
              '{attrs}',
              coalesce(tiptap_node->'attrs', '{}'::jsonb) || jsonb_build_object(
                'status', 'processing',
                'resumeStatus', case when status = 'processing'
                  then coalesce(resume_status, 'unprocessed')
                  else status
                end,
                'processingBaselineText', case when status = 'processing'
                  then coalesce(processing_baseline_text, text_content)
                  else text_content
                end,
                'changeSource', 'none'
              ),
              true
            )
        where document_id = $1 and id = $2
      `,
      [documentId, blockId],
    );
  } else {
    await client.query(
      `
        update document_blocks
        set status = $3,
            resume_status = null,
            processing_baseline_text = null,
            attrs = attrs || jsonb_build_object(
              'status', $3::text,
              'resumeStatus', null,
              'processingBaselineText', null
            ),
            tiptap_node = jsonb_set(
              tiptap_node,
              '{attrs}',
              coalesce(tiptap_node->'attrs', '{}'::jsonb) || jsonb_build_object(
                'status', $3::text,
                'resumeStatus', null,
                'processingBaselineText', null
              ),
              true
            )
        where document_id = $1 and id = $2
      `,
      [documentId, blockId, status],
    );
  }

  if (status === 'skipped') {
    await clearBlockAiState(client, documentId, [blockId]);
  }

  let next = null;
  if (status === 'processed' || status === 'skipped') {
    next = await chooseNextProcessingBlock(client, documentId, blockId);
  } else if (status === 'processing') {
    await client.query(
      `
        update documents
        set current_processing_block_id = $2
        where id = $1
      `,
      [documentId, blockId]
    );
    next = { id: blockId, status: 'processing' };
  } else {
    await client.query(
      `update documents
       set current_processing_block_id = null
       where id = $1 and current_processing_block_id = $2`,
      [documentId, blockId],
    );
  }

  await recalculateDocumentProgress(client, documentId);
  return { found: true, next };
}

async function clearBlockAiState(client, documentId, blockIds) {
  const uniqueBlockIds = [...new Set((blockIds ?? []).filter(Boolean))];
  if (!uniqueBlockIds.length) return;

  await client.query(
    'delete from block_rewrite_options where document_id = $1 and block_id = any($2::uuid[])',
    [documentId, uniqueBlockIds],
  );
  await client.query(
    'delete from block_analyses where document_id = $1 and block_id = any($2::uuid[])',
    [documentId, uniqueBlockIds],
  );
  await client.query(
    'delete from block_practice_attempts where document_id = $1 and block_id = any($2::uuid[])',
    [documentId, uniqueBlockIds],
  );
  await client.query(
    `update block_rewrite_jobs
     set status = 'cancelled',
         safe_error_code = 'BLOCK_SKIPPED',
         lease_owner = null,
         lease_expires_at = null
     where document_id = $1
       and block_id = any($2::uuid[])
       and status in ('queued', 'running')`,
    [documentId, uniqueBlockIds],
  );
}

export async function replaceBlocksFromSnapshot(client, documentId, blocks) {
  await client.query('delete from document_blocks where document_id = $1', [documentId]);

  for (const block of blocks) {
    const restoredNlp = normalizePersistedBlockNlp(block);
    const restoredAttrs = {
      ...(block.attrs ?? {}),
      ...nlpAttrs(restoredNlp),
    };
    const restoredNode = {
      ...(block.tiptap_node ?? {}),
      attrs: {
        ...(block.tiptap_node?.attrs ?? block.attrs ?? {}),
        ...nlpAttrs(restoredNlp),
      },
    };
    await client.query(
      `
        insert into document_blocks (
          id, document_id, block_index, text_content, status, resume_status,
          processing_baseline_text, change_source, partition_generation,
          format_overrides, char_length, attrs, tiptap_node,
          nlp_status, nlp_reason_codes, nlp_analysis, nlp_text_hash,
          nlp_pipeline_version, nlp_snapshot_fingerprint, semantic_coherence,
          semantic_anchor, nlp_checked_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13::jsonb,
          $14, $15::jsonb, $16::jsonb, $17, $18, $19, $20, $21::jsonb, $22
        )
      `,
      [
        block.id,
        documentId,
        block.block_index,
        block.text_content,
        block.status,
        block.resume_status ?? block.attrs?.resumeStatus ?? null,
        block.processing_baseline_text ?? block.attrs?.processingBaselineText ?? null,
        block.change_source ?? block.attrs?.changeSource ?? 'none',
        block.partition_generation ?? block.attrs?.partitionGeneration ?? 0,
        JSON.stringify(block.format_overrides ?? block.attrs?.formatOverrides ?? []),
        block.char_length,
        JSON.stringify(restoredAttrs),
        JSON.stringify(restoredNode),
        restoredNlp.nlpStatus,
        JSON.stringify(restoredNlp.nlpReasonCodes),
        JSON.stringify(restoredNlp.nlpAnalysis),
        restoredNlp.nlpTextHash,
        restoredNlp.nlpPipelineVersion,
        restoredNlp.nlpSnapshotFingerprint,
        restoredNlp.semanticCoherence,
        JSON.stringify(restoredNlp.semanticAnchor),
        restoredNlp.nlpCheckedAt,
      ]
    );
  }
}

export function normalizeContentJsonBlocks(contentJson, styleSettings = {}) {
  const content = Array.isArray(contentJson?.content) ? contentJson.content : [];
  const styleAttrs = { ...DEFAULT_BLOCK_ATTRS, ...styleAttrsFromSettings(styleSettings) };
  const blockEntries = [];
  let structuralIndex = 0;

  function normalizeTrackedNode(node, paragraphIndex) {
    const textContent = textFromNode(node).trim();
    if (!textContent) return node;

    const existingAttrs = node.attrs ?? {};
    const blockId = validBlockId(existingAttrs.blockId) ? existingAttrs.blockId : randomUUID();
    const status = normalizeBlockStatus(existingAttrs.status);
    const resumeStatus = status === 'processing'
      ? normalizeResumeStatus(existingAttrs.resumeStatus)
      : null;
    const processingBaselineText = status === 'processing'
      ? String(existingAttrs.processingBaselineText ?? textContent)
      : null;
    const changeSource = normalizeChangeSource(existingAttrs.changeSource);
    const partitionGeneration = Math.max(0, Number(existingAttrs.partitionGeneration) || 0);
    const formatOverrides = Array.isArray(existingAttrs.formatOverrides)
      ? [...new Set(existingAttrs.formatOverrides.filter((value) => typeof value === 'string'))]
      : Object.keys(existingAttrs.formatOverrides ?? {});
    const charLength = countCharacters(textContent);
    const normalizedNlp = normalizePersistedBlockNlp({
      text_content: textContent,
      attrs: existingAttrs,
    });
    const attrs = {
      ...styleAttrs,
      ...existingAttrs,
      paragraphIndex: Number.isInteger(existingAttrs.paragraphIndex)
        ? existingAttrs.paragraphIndex
        : paragraphIndex,
      blockId,
      status,
      resumeStatus,
      processingBaselineText,
      changeSource,
      partitionGeneration,
      formatOverrides,
      length: charLength,
      ...nlpAttrs(normalizedNlp),
    };
    const tiptapNode = {
      ...node,
      type: 'blockSegment',
      attrs,
    };

    blockEntries.push({
      id: blockId,
      index: blockEntries.length,
      textContent,
      status,
      resumeStatus,
      processingBaselineText,
      changeSource,
      partitionGeneration,
      formatOverrides,
      charLength,
      ...normalizedNlp,
      attrs,
      tiptapNode,
    });
    return tiptapNode;
  }

  function legacyBlockSegment(node) {
    const attrs = node?.attrs ?? {};
    return {
      type: 'blockSegment',
      attrs: {
        ...(attrs.lineHeight ? { lineHeight: attrs.lineHeight } : {}),
        ...(attrs.textIndent ? { textIndent: attrs.textIndent } : {}),
        ...(attrs.textAlign ? { textAlign: attrs.textAlign } : {}),
        ...(attrs.fontFamily ? { fontFamily: attrs.fontFamily } : {}),
        ...(attrs.fontSize ? { fontSize: attrs.fontSize } : {}),
        ...(attrs.blockId ? { blockId: attrs.blockId } : {}),
        ...(attrs.status ? { status: attrs.status } : {}),
        ...(attrs.resumeStatus ? { resumeStatus: attrs.resumeStatus } : {}),
        ...(attrs.processingBaselineText ? {
          processingBaselineText: attrs.processingBaselineText,
        } : {}),
        ...(attrs.changeSource ? { changeSource: attrs.changeSource } : {}),
        ...(Number.isInteger(attrs.partitionGeneration) ? {
          partitionGeneration: attrs.partitionGeneration,
        } : {}),
        ...(attrs.formatOverrides ? { formatOverrides: attrs.formatOverrides } : {}),
        ...(Number.isInteger(attrs.paragraphIndex) ? { paragraphIndex: attrs.paragraphIndex } : {}),
        ...(attrs.nlpStatus ? { nlpStatus: attrs.nlpStatus } : {}),
        ...(attrs.nlpReasonCodes ? { nlpReasonCodes: attrs.nlpReasonCodes } : {}),
        ...(attrs.nlpAnalysis ? { nlpAnalysis: attrs.nlpAnalysis } : {}),
        ...(attrs.nlpTextHash ? { nlpTextHash: attrs.nlpTextHash } : {}),
        ...(attrs.nlpPipelineVersion ? { nlpPipelineVersion: attrs.nlpPipelineVersion } : {}),
        ...(attrs.nlpSnapshotFingerprint
          ? { nlpSnapshotFingerprint: attrs.nlpSnapshotFingerprint }
          : {}),
        ...(attrs.semanticCoherence != null
          ? { semanticCoherence: attrs.semanticCoherence }
          : {}),
        ...(attrs.semanticAnchor ? { semanticAnchor: attrs.semanticAnchor } : {}),
        ...(attrs.nlpCheckedAt ? { nlpCheckedAt: attrs.nlpCheckedAt } : {}),
      },
      content: Array.isArray(node?.content) ? node.content : [],
    };
  }

  function normalizeNode(node) {
    if (!node || typeof node !== 'object') return node;
    if (!STRUCTURAL_TEXT_BLOCK_TYPES.has(node.type)) {
      if (!Array.isArray(node.content)) return node;
      return { ...node, content: node.content.map(normalizeNode) };
    }

    const paragraphIndex = structuralIndex;
    structuralIndex += 1;

    const nodeContent = Array.isArray(node.content) ? node.content : [];
    const hasInlineBlocks = nodeContent.some((child) => child?.type === 'blockSegment');
    const {
      blockId: _blockId,
      status: _status,
      length: _length,
      paragraphIndex: _paragraphIndex,
      ...containerAttrs
    } = node.attrs ?? {};

    return {
      ...node,
      attrs: {
        ...styleAttrs,
        ...containerAttrs,
      },
      content: hasInlineBlocks
        ? nodeContent.map((child) => (
          child?.type === 'blockSegment'
            ? normalizeTrackedNode(child, paragraphIndex)
            : child
        ))
        : (textFromNode(node).trim()
          ? [normalizeTrackedNode(legacyBlockSegment(node), paragraphIndex)]
          : nodeContent),
    };
  }

  const normalizedNodes = content.map(normalizeNode);

  let processingSeen = false;
  for (const entry of blockEntries) {
    if (entry.status !== 'processing') continue;
    if (!processingSeen) {
      processingSeen = true;
      continue;
    }
    entry.status = 'unprocessed';
    entry.resumeStatus = null;
    entry.processingBaselineText = null;
    entry.attrs.status = 'unprocessed';
    entry.attrs.resumeStatus = null;
    entry.attrs.processingBaselineText = null;
    entry.tiptapNode.attrs.status = 'unprocessed';
    entry.tiptapNode.attrs.resumeStatus = null;
    entry.tiptapNode.attrs.processingBaselineText = null;
  }

  const normalizedContent = {
    ...contentJson,
    type: contentJson?.type ?? 'doc',
    content: normalizedNodes,
  };

  const currentProcessingBlock = blockEntries.find((entry) => entry.status === 'processing') ?? null;
  return {
    contentJson: normalizedContent,
    blockEntries,
    currentProcessingBlockId: currentProcessingBlock?.id ?? null,
  };
}

export async function replaceBlocksFromContentJson(client, documentId, contentJson, styleSettings = {}) {
  const normalized = normalizeContentJsonBlocks(contentJson, styleSettings);

  await client.query('delete from document_blocks where document_id = $1', [documentId]);

  for (const entry of normalized.blockEntries) {
    await client.query(
      `
        insert into document_blocks (
          id, document_id, block_index, text_content, status, resume_status,
          processing_baseline_text, change_source, partition_generation,
          format_overrides, char_length, attrs, tiptap_node,
          nlp_status, nlp_reason_codes, nlp_analysis, nlp_text_hash,
          nlp_pipeline_version, nlp_snapshot_fingerprint, semantic_coherence,
          semantic_anchor, nlp_checked_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13::jsonb,
          $14, $15::jsonb, $16::jsonb, $17, $18, $19, $20, $21::jsonb, $22
        )
      `,
      [
        entry.id,
        documentId,
        entry.index,
        entry.textContent,
        entry.status,
        entry.resumeStatus,
        entry.processingBaselineText,
        entry.changeSource,
        entry.partitionGeneration,
        JSON.stringify(entry.formatOverrides),
        entry.charLength,
        JSON.stringify(entry.attrs),
        JSON.stringify(entry.tiptapNode),
        entry.nlpStatus ?? 'unknown',
        JSON.stringify(entry.nlpReasonCodes ?? []),
        JSON.stringify(entry.nlpAnalysis ?? {}),
        entry.nlpTextHash ?? null,
        entry.nlpPipelineVersion ?? null,
        entry.nlpSnapshotFingerprint ?? null,
        entry.semanticCoherence ?? null,
        JSON.stringify(entry.semanticAnchor ?? null),
        entry.nlpCheckedAt ?? null,
      ]
    );
  }

  await clearBlockAiState(
    client,
    documentId,
    normalized.blockEntries
      .filter((entry) => entry.status === 'skipped')
      .map((entry) => entry.id),
  );

  await client.query(
    `update block_rewrite_jobs jobs
     set status = 'cancelled',
         safe_error_code = 'STALE_BLOCK_CONTEXT',
         lease_owner = null,
         lease_expires_at = null
     where jobs.document_id = $1
       and jobs.status in ('queued', 'running')
       and not exists (
         select 1
         from document_blocks blocks
         where blocks.document_id = jobs.document_id
           and blocks.id = jobs.block_id
           and blocks.partition_generation = jobs.partition_generation
           and encode(digest(blocks.text_content, 'sha256'), 'hex') = jobs.source_text_hash
       )`,
    [documentId],
  );

  const nlpSummary = await getDocumentNlpSummary(
    documentId,
    client.query.bind(client),
  );
  await client.query(
    'update documents set nlp_document_snapshot = $2::jsonb where id = $1',
    [documentId, JSON.stringify(nlpSummary)],
  );

  return {
    contentJson: normalized.contentJson,
    currentProcessingBlockId: normalized.currentProcessingBlockId,
    nlpSummary,
  };
}

export async function getOwnedBlockForNlp({ documentId, blockId, userId }) {
  const result = await query(
    `
      select db.*, d.revision, d.partition_revision, d.nlp_semantic_profile,
             d.nlp_status as document_nlp_status, d.nlp_document_snapshot
      from document_blocks db
      join documents d on d.id = db.document_id
      where db.document_id = $1
        and db.id = $2
        and d.user_id = $3
        and d.trashed = false
    `,
    [documentId, blockId, userId],
  );
  return result.rows[0] ?? null;
}

export async function getDocumentNlpSummary(documentId, runQuery = query) {
  const result = await runQuery(
    `
      select
        count(*)::int as block_count,
        count(*) filter (where nlp_status = 'pass')::int as pass_count,
        count(*) filter (where nlp_status = 'warning')::int as warning_count,
        count(*) filter (where nlp_status = 'blocked')::int as blocked_count,
        count(*) filter (where nlp_status = 'skipped')::int as skipped_count,
        count(*) filter (where nlp_status = 'unknown')::int as unknown_count,
        coalesce(sum((nlp_analysis->'issueCounts'->>'warning')::int), 0)::int
          as warning_issue_count,
        coalesce(sum((nlp_analysis->'issueCounts'->>'blocking')::int), 0)::int
          as blocking_issue_count,
        max(nlp_checked_at) as checked_at
      from document_blocks
      where document_id = $1
    `,
    [documentId],
  );
  const row = result.rows[0] ?? {};
  return {
    blockCount: Number(row.block_count) || 0,
    passCount: Number(row.pass_count) || 0,
    warningCount: Number(row.warning_count) || 0,
    blockedCount: Number(row.blocked_count) || 0,
    skippedCount: Number(row.skipped_count) || 0,
    unknownCount: Number(row.unknown_count) || 0,
    warningIssueCount: Number(row.warning_issue_count) || 0,
    blockingIssueCount: Number(row.blocking_issue_count) || 0,
    checkedAt: row.checked_at ?? null,
  };
}

export async function saveBlockNlpResult({
  documentId,
  blockId,
  userId,
  expectedTextHash,
  expectedPartitionGeneration,
  result,
}) {
  return withTransaction(async (client) => {
    const owned = await client.query(
      `
        select db.*, d.revision, d.partition_revision, d.nlp_semantic_profile
        from document_blocks db
        join documents d on d.id = db.document_id
        where db.document_id = $1
          and db.id = $2
          and d.user_id = $3
          and d.trashed = false
        for update of db, d
      `,
      [documentId, blockId, userId],
    );
    const block = owned.rows[0];
    if (!block) return { found: false };
    const sourceTextHash = hashNlpText(block.text_content);
    if (
      sourceTextHash !== expectedTextHash
      || result.textHash !== sourceTextHash
      || Number(block.partition_generation) !== Number(expectedPartitionGeneration)
      || result.pipelineVersion !== CURRENT_NLP_PIPELINE_VERSION
    ) {
      return {
        found: true,
        stale: true,
        identity: {
          documentId,
          blockId,
          sourceTextHash,
          partitionGeneration: Number(block.partition_generation),
          pipelineVersion: CURRENT_NLP_PIPELINE_VERSION,
        },
      };
    }

    const reviewedResult = applyLanguageIssueRejections(
      result,
      block.nlp_analysis?.rejectedIssues ?? [],
    );
    const snapshot = persistedNlpSnapshot(reviewedResult, block.nlp_semantic_profile);
    const attrs = {
      ...(block.attrs ?? {}),
      ...nlpAttrs(snapshot),
    };
    const tiptapNode = {
      ...(block.tiptap_node ?? {}),
      attrs: {
        ...(block.tiptap_node?.attrs ?? block.attrs ?? {}),
        ...nlpAttrs(snapshot),
      },
    };
    const updated = await client.query(
      `
        update document_blocks
        set nlp_status = $3,
            nlp_reason_codes = $4::jsonb,
            nlp_analysis = $5::jsonb,
            nlp_text_hash = $6,
            nlp_pipeline_version = $7,
            nlp_snapshot_fingerprint = $8,
            semantic_coherence = $9,
            semantic_anchor = $10::jsonb,
            nlp_checked_at = $11,
            attrs = $12::jsonb,
            tiptap_node = $13::jsonb
        where document_id = $1 and id = $2
        returning *
      `,
      [
        documentId,
        blockId,
        snapshot.nlpStatus,
        JSON.stringify(snapshot.nlpReasonCodes),
        JSON.stringify(snapshot.nlpAnalysis),
        snapshot.nlpTextHash,
        snapshot.nlpPipelineVersion,
        snapshot.nlpSnapshotFingerprint,
        snapshot.semanticCoherence,
        JSON.stringify(snapshot.semanticAnchor),
        snapshot.nlpCheckedAt,
        JSON.stringify(attrs),
        JSON.stringify(tiptapNode),
      ],
    );
    const summary = await getDocumentNlpSummary(
      documentId,
      client.query.bind(client),
    );
    await client.query(
      `
        update documents
        set nlp_status = $2,
            nlp_pipeline_version = $3,
            nlp_document_snapshot = $4::jsonb
        where id = $1
      `,
      [
        documentId,
        result.degraded ? 'degraded' : 'ready',
        CURRENT_NLP_PIPELINE_VERSION,
        JSON.stringify(summary),
      ],
    );
    return {
      found: true,
      stale: false,
      block: updated.rows[0],
      summary,
      identity: {
        documentId,
        blockId,
        sourceTextHash,
        partitionGeneration: Number(block.partition_generation),
        pipelineVersion: CURRENT_NLP_PIPELINE_VERSION,
        nlpSnapshotFingerprint: snapshot.nlpSnapshotFingerprint,
        documentRevision: Number(block.revision),
        partitionRevision: Number(block.partition_revision),
      },
    };
  });
}
