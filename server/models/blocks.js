import { randomUUID } from 'crypto';
import { query } from './db.js';
import { countCharacters } from '../../src/lib/blockSegmentation/index.js';
import {
  normalizeBlockStatus,
  normalizeChangeSource,
  normalizeResumeStatus,
} from '../../src/lib/blockState.js';

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
  };
}

export function createBlockRecords(textBlocks, styleSettings = {}) {
  const mergedAttrs = { ...DEFAULT_BLOCK_ATTRS, ...styleSettings };
  return textBlocks.map((blockInput, index) => {
    const normalized = normalizeBlockInput(blockInput);
    const id = randomUUID();
    const status = index === 0 ? 'processing' : 'unprocessed';
    const resumeStatus = index === 0 ? 'unprocessed' : null;
    const processingBaselineText = index === 0 ? normalized.text : null;
    const charLength = countCharacters(normalized.text);
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
      formatOverrides: [],
      length: charLength,
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
      formatOverrides: [],
      charLength,
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
    content: paragraphs.map((paragraph) => ({
      type: 'paragraph',
      attrs: paragraph.attrs,
      content: paragraph.content,
    })),
  };
}

export async function insertBlocks(client, documentId, blocks) {
  for (const block of blocks) {
    await client.query(
      `
        insert into document_blocks (
          id, document_id, block_index, text_content, status, resume_status,
          processing_baseline_text, change_source, partition_generation,
          format_overrides, char_length, attrs, tiptap_node
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13::jsonb
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
      ]
    );
  }
}

export async function getBlocksByDocument(documentId) {
  const result = await query(
    `
      select id, document_id, block_index, text_content, status, resume_status,
             processing_baseline_text, change_source, partition_generation,
             format_overrides, char_length, attrs, tiptap_node, created_at, updated_at
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
      select id, block_index, status
      from document_blocks
      where document_id = $1
      order by block_index asc
    `,
    [documentId]
  );

  const rows = blocks.rows;
  const currentIndex = rows.find((row) => row.id === fromBlockId)?.block_index ?? -1;
  const below = rows.find((row) => row.status === 'unprocessed' && row.block_index > currentIndex);
  const fallback = rows.find((row) => row.status === 'unprocessed');
  const next = below ?? fallback ?? null;

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
    await client.query(
      'delete from block_rewrite_options where document_id = $1 and block_id = $2',
      [documentId, blockId],
    );
    await client.query(
      'delete from block_analyses where document_id = $1 and block_id = $2',
      [documentId, blockId],
    );
    await client.query(
      'delete from block_practice_attempts where document_id = $1 and block_id = $2',
      [documentId, blockId],
    );
    await client.query(
      `update block_rewrite_jobs
       set status = 'cancelled', safe_error_code = 'BLOCK_SKIPPED'
       where document_id = $1 and block_id = $2 and status in ('queued', 'running')`,
      [documentId, blockId],
    );
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

export async function replaceBlocksFromSnapshot(client, documentId, blocks) {
  await client.query('delete from document_blocks where document_id = $1', [documentId]);

  for (const block of blocks) {
    await client.query(
      `
        insert into document_blocks (
          id, document_id, block_index, text_content, status, resume_status,
          processing_baseline_text, change_source, partition_generation,
          format_overrides, char_length, attrs, tiptap_node
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13::jsonb
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
        JSON.stringify(block.attrs),
        JSON.stringify(block.tiptap_node),
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
          format_overrides, char_length, attrs, tiptap_node
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13::jsonb
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
      ]
    );
  }

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

  return {
    contentJson: normalized.contentJson,
    currentProcessingBlockId: normalized.currentProcessingBlockId,
  };
}
