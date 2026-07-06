import { query, withTransaction } from './db.js';
import {
  createBlockRecords,
  createContentJson,
  insertBlocks,
  recalculateDocumentProgress,
  replaceBlocksFromContentJson,
  updateBlockStatus,
} from './blocks.js';
import { appendDocumentVersion } from './versions.js';

const SORT_MAP = {
  most_recent: 'updated_at desc',
  least_recent: 'updated_at asc',
  most_completed: 'completed_rate desc, updated_at desc',
  least_completed: 'completed_rate asc, updated_at desc',
};

export async function listDocuments({ userId, q = '', sort = 'most_recent', trashed = false }) {
  const sortSql = SORT_MAP[sort] ?? SORT_MAP.most_recent;
  const result = await query(
    `
      select
        d.id,
        d.title,
        d.academic_style,
        d.completed_chars,
        d.total_chars,
        d.completed_rate,
        d.current_processing_block_id,
        d.original_filename,
        d.trashed,
        d.trashed_at,
        d.created_at,
        d.updated_at,
        coalesce(
          (
            select left(db.text_content, 180)
            from document_blocks db
            where db.document_id = d.id
            order by db.block_index asc
            limit 1
          ),
          ''
        ) as snippet
      from documents d
      where d.user_id = $1
        and d.trashed = $2
        and ($3 = '' or d.title ilike '%' || $3 || '%')
      order by ${sortSql}
    `,
    [userId, trashed, q]
  );
  return result.rows;
}

export async function getDocument(documentId, userId) {
  const documentResult = await query(
    `
      select *
      from documents
      where id = $1
        and user_id = $2
    `,
    [documentId, userId]
  );
  const document = documentResult.rows[0];
  if (!document) {
    return null;
  }

  const blocks = await query(
    `
      select id, document_id, block_index, text_content, status, char_length, attrs, tiptap_node, created_at, updated_at
      from document_blocks
      where document_id = $1
      order by block_index asc
    `,
    [documentId]
  );

  return { ...document, blocks: blocks.rows };
}

export async function getDocumentRate(documentId, userId) {
  const result = await query(
    `
      select completed_chars, total_chars, completed_rate
      from documents
      where id = $1
        and user_id = $2
    `,
    [documentId, userId]
  );
  return result.rows[0] ?? null;
}

export async function createDocumentWithBlocks({
  userId,
  title,
  academicStyle = 'APA',
  styleSettings = {},
  textBlocks,
  originalFile = null,
  originalFilename = null,
  originalMime = null,
}) {
  const safeBlocks = textBlocks.length ? textBlocks : ['Start writing your document.'];
  const blocks = createBlockRecords(safeBlocks, styleSettings);
  const contentJson = createContentJson(blocks);
  const processingBlock = blocks.find((block) => block.status === 'processing') ?? null;

  const documentId = await withTransaction(async (client) => {
    const inserted = await client.query(
      `
        insert into documents (
          user_id, title, academic_style, style_settings, content_json,
          original_filename, original_mime, original_file, current_processing_block_id
        )
        values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9)
        returning *
      `,
      [
        userId,
        title,
        academicStyle,
        JSON.stringify(styleSettings),
        JSON.stringify(contentJson),
        originalFilename,
        originalMime,
        originalFile,
        processingBlock?.id ?? null,
      ]
    );

    const document = inserted.rows[0];
    await insertBlocks(client, document.id, blocks);
    await recalculateDocumentProgress(client, document.id);
    await appendDocumentVersion(client, document.id, 'Initial import');

    return document.id;
  });

  return getDocument(documentId, userId);
}

export async function createBlankDocument(userId) {
  return createDocumentWithBlocks({
    userId,
    title: 'Untitled document',
    textBlocks: ['Start writing your document.'],
  });
}

export async function saveDocument(documentId, userId, payload) {
  return withTransaction(async (client) => {
    const existing = await client.query(
      `
        select id
        from documents
        where id = $1
          and user_id = $2
        for update
      `,
      [documentId, userId]
    );

    if (!existing.rows[0]) return null;

    let contentJson = payload.contentJson ?? null;
    let currentProcessingBlockId = null;

    if (payload.contentJson) {
      const synced = await replaceBlocksFromContentJson(
        client,
        documentId,
        payload.contentJson,
        payload.styleSettings ?? {}
      );
      contentJson = synced.contentJson;
      currentProcessingBlockId = synced.currentProcessingBlockId;
    }

    const result = await client.query(
      `
        update documents
        set title = coalesce($3, title),
            academic_style = coalesce($4, academic_style),
            style_settings = coalesce($5::jsonb, style_settings),
            content_json = coalesce($6::jsonb, content_json),
            current_processing_block_id = case
              when $7::boolean then $8::uuid
              else current_processing_block_id
            end
        where id = $1
          and user_id = $2
        returning *
      `,
      [
        documentId,
        userId,
        payload.title ?? null,
        payload.academicStyle ?? null,
        payload.styleSettings ? JSON.stringify(payload.styleSettings) : null,
        contentJson ? JSON.stringify(contentJson) : null,
        Boolean(payload.contentJson),
        currentProcessingBlockId,
      ]
    );

    const document = result.rows[0] ?? null;
    if (!document) return null;

    if (payload.contentJson) {
      await recalculateDocumentProgress(client, documentId);
    }

    if (payload.createVersion) {
      await appendDocumentVersion(client, documentId, payload.versionLabel || 'Editor auto-save');
    }

    return document;
  });
}

export async function moveDocumentToTrash(documentId, userId) {
  const result = await query(
    `
      update documents
      set trashed = true,
          trashed_at = now()
      where id = $1
        and user_id = $2
      returning id, title, trashed, trashed_at
    `,
    [documentId, userId]
  );
  return result.rows[0] ?? null;
}

export async function restoreDocument(documentId, userId) {
  const result = await query(
    `
      update documents
      set trashed = false,
          trashed_at = null
      where id = $1
        and user_id = $2
      returning id, title, trashed, updated_at
    `,
    [documentId, userId]
  );
  return result.rows[0] ?? null;
}

export async function deleteDocumentForever(documentId, userId) {
  const result = await query(
    `
      delete from documents
      where id = $1
        and user_id = $2
      returning id, title
    `,
    [documentId, userId]
  );
  return result.rows[0] ?? null;
}

export async function checkExpiredTrash(userId) {
  const result = await query(
    `
      delete from documents
      where user_id = $1
        and trashed = true
        and trashed_at < now() - interval '30 days'
      returning id, title
    `,
    [userId]
  );
  return result.rows;
}

export async function updateDocumentBlockStatus({ documentId, userId, blockId, status }) {
  return withTransaction(async (client) => {
    const ownedDocument = await client.query(
      `
        select id
        from documents
        where id = $1
          and user_id = $2
        for update
      `,
      [documentId, userId]
    );

    if (!ownedDocument.rows[0]) {
      return null;
    }

    const next = await updateBlockStatus(client, { documentId, blockId, status });
    await appendDocumentVersion(client, documentId, `Block ${status}`);
    return next;
  });
}
