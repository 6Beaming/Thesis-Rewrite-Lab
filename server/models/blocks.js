import { randomUUID } from 'crypto';
import { query } from './db.js';

const DEFAULT_BLOCK_ATTRS = {
  lineHeight: '2.0',
  textIndent: '0.5in',
  textAlign: 'left',
  fontFamily: 'Times New Roman',
  fontSize: '12pt',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_BLOCK_NODE_TYPES = new Set(['paragraph', 'heading']);
const BLOCK_STATUSES = new Set(['unprocessed', 'processing', 'processed', 'skipped']);

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
    const attrs = {
      ...mergedAttrs,
      ...normalized.attrs,
      paragraphIndex: Number.isInteger(normalized.attrs.paragraphIndex)
        ? normalized.attrs.paragraphIndex
        : index,
      blockId: id,
      status,
      length: normalized.text.length,
    };

    return {
      id,
      blockIndex: index,
      textContent: normalized.text,
      status,
      charLength: normalized.text.length,
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
      };
      paragraphs.push(paragraph);
    }

    if (paragraph.content.length) {
      paragraph.content.push({ type: 'text', text: ' ' });
    }
    paragraph.content.push(block.tiptapNode);
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
          id, document_id, block_index, text_content, status, char_length, attrs, tiptap_node
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
      `,
      [
        block.id,
        documentId,
        block.blockIndex,
        block.textContent,
        block.status,
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
      select id, document_id, block_index, text_content, status, char_length, attrs, tiptap_node, created_at, updated_at
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

  await client.query(
    `
      update user_stats
      set total_chars = stats.total_chars,
          completed_chars = stats.completed_chars,
          completed_rate = case
            when stats.total_chars > 0 then stats.completed_chars::numeric / stats.total_chars
            else 0
          end,
          updated_at = now()
      from (
        select
          user_id,
          coalesce(sum(total_chars), 0)::int as total_chars,
          coalesce(sum(completed_chars), 0)::int as completed_chars
        from documents
        where trashed = false
        group by user_id
      ) stats
      where user_stats.user_id = stats.user_id
        and stats.user_id = (select user_id from documents where id = $1)
    `,
    [documentId]
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
  const above = rows
    .filter((row) => row.status === 'unprocessed' && row.block_index < currentIndex)
    .sort((a, b) => b.block_index - a.block_index)[0];
  const below = rows.find((row) => row.status === 'unprocessed' && row.block_index > currentIndex);
  const fallback = rows.find((row) => row.status === 'unprocessed');
  const next = above ?? below ?? fallback ?? null;

  await client.query(
    `
      update document_blocks
      set status = 'unprocessed',
          attrs = jsonb_set(attrs, '{status}', '"unprocessed"', true),
          tiptap_node = jsonb_set(tiptap_node, '{attrs,status}', '"unprocessed"', true)
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
            attrs = jsonb_set(attrs, '{status}', '"processing"', true),
            tiptap_node = jsonb_set(tiptap_node, '{attrs,status}', '"processing"', true)
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
  if (status === 'processing') {
    await client.query(
      `
        update document_blocks
        set status = 'unprocessed',
            attrs = jsonb_set(attrs, '{status}', '"unprocessed"', true),
            tiptap_node = jsonb_set(tiptap_node, '{attrs,status}', '"unprocessed"', true)
        where document_id = $1
          and status = 'processing'
      `,
      [documentId]
    );
  }

  await client.query(
    `
      update document_blocks
      set status = $3,
          attrs = jsonb_set(attrs, '{status}', to_jsonb($3::text), true),
          tiptap_node = jsonb_set(tiptap_node, '{attrs,status}', to_jsonb($3::text), true)
      where document_id = $1
        and id = $2
    `,
    [documentId, blockId, status]
  );

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
  }

  await recalculateDocumentProgress(client, documentId);
  return next;
}

export async function replaceBlocksFromSnapshot(client, documentId, blocks) {
  await client.query('delete from document_blocks where document_id = $1', [documentId]);

  for (const block of blocks) {
    await client.query(
      `
        insert into document_blocks (
          id, document_id, block_index, text_content, status, char_length, attrs, tiptap_node
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
      `,
      [
        block.id,
        documentId,
        block.block_index,
        block.text_content,
        block.status,
        block.char_length,
        JSON.stringify(block.attrs),
        JSON.stringify(block.tiptap_node),
      ]
    );
  }
}

export async function replaceBlocksFromContentJson(client, documentId, contentJson, styleSettings = {}) {
  const content = Array.isArray(contentJson?.content) ? contentJson.content : [];
  const styleAttrs = { ...DEFAULT_BLOCK_ATTRS, ...styleAttrsFromSettings(styleSettings) };
  const blockEntries = [];

  function normalizeTrackedNode(node, paragraphIndex) {
    const textContent = textFromNode(node).trim();
    if (!textContent) return node;

    const existingAttrs = node.attrs ?? {};
    const blockId = validBlockId(existingAttrs.blockId) ? existingAttrs.blockId : randomUUID();
    const rawStatus = existingAttrs.status;
    const status = BLOCK_STATUSES.has(rawStatus) ? rawStatus : 'unprocessed';
    const attrs = {
      ...styleAttrs,
      ...existingAttrs,
      paragraphIndex: Number.isInteger(existingAttrs.paragraphIndex)
        ? existingAttrs.paragraphIndex
        : paragraphIndex,
      blockId,
      status,
      length: textContent.length,
    };
    const tiptapNode = {
      ...node,
      type: node.type === 'blockSegment' ? 'blockSegment' : node.type,
      attrs,
    };

    blockEntries.push({
      id: blockId,
      index: blockEntries.length,
      textContent,
      status,
      charLength: textContent.length,
      attrs,
      tiptapNode,
    });
    return tiptapNode;
  }

  const normalizedNodes = content.map((node, paragraphIndex) => {
    if (!LEGACY_BLOCK_NODE_TYPES.has(node?.type)) return node;

    const nodeContent = Array.isArray(node.content) ? node.content : [];
    const hasInlineBlocks = nodeContent.some((child) => child?.type === 'blockSegment');
    if (!hasInlineBlocks) {
      return normalizeTrackedNode(node, paragraphIndex);
    }

    return {
      ...node,
      attrs: {
        ...styleAttrs,
        ...(node.attrs ?? {}),
      },
      content: nodeContent.map((child) => (
        child?.type === 'blockSegment'
          ? normalizeTrackedNode(child, paragraphIndex)
          : child
      )),
    };
  });

  let processingSeen = false;
  for (const entry of blockEntries) {
    if (entry.status !== 'processing') continue;
    if (!processingSeen) {
      processingSeen = true;
      continue;
    }
    entry.status = 'unprocessed';
    entry.attrs.status = 'unprocessed';
    entry.tiptapNode.attrs.status = 'unprocessed';
  }

  if (!processingSeen) {
    const nextProcessing = blockEntries.find((entry) => entry.status === 'unprocessed');
    if (nextProcessing) {
      nextProcessing.status = 'processing';
      nextProcessing.attrs.status = 'processing';
      nextProcessing.tiptapNode.attrs.status = 'processing';
    }
  }

  const normalizedContent = {
    ...contentJson,
    type: contentJson?.type ?? 'doc',
    content: normalizedNodes,
  };

  await client.query('delete from document_blocks where document_id = $1', [documentId]);

  for (const entry of blockEntries) {
    await client.query(
      `
        insert into document_blocks (
          id, document_id, block_index, text_content, status, char_length, attrs, tiptap_node
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
      `,
      [
        entry.id,
        documentId,
        entry.index,
        entry.textContent,
        entry.status,
        entry.charLength,
        JSON.stringify(entry.attrs),
        JSON.stringify(entry.tiptapNode),
      ]
    );
  }

  const currentProcessingBlock = blockEntries.find((entry) => entry.status === 'processing') ?? null;
  return {
    contentJson: normalizedContent,
    currentProcessingBlockId: currentProcessingBlock?.id ?? null,
  };
}
