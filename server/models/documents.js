import { query, withTransaction } from './db.js';
import {
  createBlockRecords,
  createContentJson,
  insertBlocks,
  recalculateDocumentProgress,
  recalculateUserProgress,
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

function replaceTrackedNodes(node, byId) {
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'blockSegment' && byId.has(node.attrs?.blockId)) {
    return byId.get(node.attrs.blockId);
  }
  if (!Array.isArray(node.content)) return node;
  return { ...node, content: node.content.map((child) => replaceTrackedNodes(child, byId)) };
}

async function synchronizeDocumentContentJson(client, documentId) {
  const [documentResult, blockResult] = await Promise.all([
    client.query('select content_json from documents where id = $1', [documentId]),
    client.query(
      'select id, tiptap_node from document_blocks where document_id = $1 order by block_index',
      [documentId],
    ),
  ]);
  const byId = new Map(blockResult.rows.map((block) => [block.id, block.tiptap_node]));
  const contentJson = replaceTrackedNodes(documentResult.rows[0]?.content_json, byId);
  await client.query(
    'update documents set content_json = $2::jsonb where id = $1',
    [documentId, JSON.stringify(contentJson)],
  );
}

async function loadDocument(runQuery, documentId, userId) {
  const documentResult = await runQuery(
    `
      select id, user_id, title, academic_style, style_settings, content_json,
             original_filename, original_mime, completed_chars, total_chars,
             completed_rate, current_processing_block_id, revision, trashed,
             trashed_at, created_at, updated_at
      from documents
      where id = $1
        and user_id = $2
    `,
    [documentId, userId]
  );
  const document = documentResult.rows[0];
  if (!document) return null;

  const blocks = await runQuery(
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
  return { ...document, blocks: blocks.rows };
}

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
        d.revision,
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
  return loadDocument(query, documentId, userId);
}

export async function getDocumentRate(documentId, userId) {
  const result = await query(
    `
      select completed_chars, total_chars, completed_rate, revision
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
  returnMutation = false,
}) {
  const safeBlocks = textBlocks.length ? textBlocks : ['Start writing your document.'];
  const blocks = createBlockRecords(safeBlocks, styleSettings);
  const contentJson = createContentJson(blocks);
  const processingBlock = blocks.find((block) => block.status === 'processing') ?? null;

  const mutation = await withTransaction(async (client) => {
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
    const version = await appendDocumentVersion(client, document.id, 'Initial import');
    const committedDocument = await loadDocument(client.query.bind(client), document.id, userId);
    return { document: committedDocument, version };
  });

  return returnMutation ? mutation : mutation.document;
}

export async function createBlankDocument(userId, options = {}) {
  return createDocumentWithBlocks({
    userId,
    title: 'Untitled document',
    textBlocks: ['Start writing your document.'],
    returnMutation: Boolean(options.returnMutation),
  });
}

export async function saveDocument(documentId, userId, payload, options = {}) {
  const mutation = await withTransaction(async (client) => {
    const existing = await client.query(
      `
        select id, revision
        from documents
        where id = $1
          and user_id = $2
          and trashed = false
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
            end,
            revision = revision + 1
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

    const version = payload.createVersion
      ? await appendDocumentVersion(client, documentId, payload.versionLabel || 'Editor auto-save')
      : null;
    return {
      document: await loadDocument(client.query.bind(client), documentId, userId),
      version,
    };
  });
  if (!mutation) return null;
  return options.returnMutation ? mutation : mutation.document;
}

export async function userOwnsActiveDocument(documentId, userId) {
  const result = await query(
    `
      select 1
      from documents
      where id = $1
        and user_id = $2
        and trashed = false
    `,
    [documentId, userId]
  );
  return Boolean(result.rows[0]);
}

export async function moveDocumentToTrash(documentId, userId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `
        update documents
        set trashed = true,
            trashed_at = now(),
            revision = revision + 1
        where id = $1
          and user_id = $2
          and trashed = false
        returning id, title, trashed, trashed_at, revision, updated_at
      `,
      [documentId, userId]
    );
    if (!result.rows[0]) return null;
    await recalculateUserProgress(client, userId);
    return result.rows[0];
  });
}

export async function restoreDocument(documentId, userId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `
        update documents
        set trashed = false,
            trashed_at = null,
            revision = revision + 1
        where id = $1
          and user_id = $2
          and trashed = true
        returning id, title, trashed, trashed_at, revision, updated_at
      `,
      [documentId, userId]
    );
    if (!result.rows[0]) return null;
    await recalculateUserProgress(client, userId);
    return result.rows[0];
  });
}

export async function deleteDocumentForever(documentId, userId) {
  return withTransaction(async (client) => {
    const existing = await client.query(
      `
        select id, title, revision
        from documents
        where id = $1
          and user_id = $2
          and trashed = true
        for update
      `,
      [documentId, userId]
    );
    if (!existing.rows[0]) return null;

    await client.query('delete from documents where id = $1', [documentId]);
    await recalculateUserProgress(client, userId);
    return {
      id: existing.rows[0].id,
      title: existing.rows[0].title,
      revision: Number(existing.rows[0].revision) + 1,
      deleted: true,
    };
  });
}

export async function checkExpiredTrash(userId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `
        delete from documents
        where user_id = $1
          and trashed = true
          and trashed_at < now() - interval '30 days'
        returning id, title, revision + 1 as revision
      `,
      [userId]
    );
    if (result.rowCount) {
      await recalculateUserProgress(client, userId);
    }
    return result.rows.map((document) => ({ ...document, deleted: true }));
  });
}

export async function updateDocumentBlockStatus({ documentId, userId, blockId, status }) {
  return withTransaction(async (client) => {
    const ownedDocument = await client.query(
      `
        select id, revision
        from documents
        where id = $1
          and user_id = $2
          and trashed = false
        for update
      `,
      [documentId, userId]
    );

    if (!ownedDocument.rows[0]) {
      return null;
    }

    const blockUpdate = await updateBlockStatus(client, { documentId, blockId, status });
    if (!blockUpdate.found) {
      return null;
    }
    await synchronizeDocumentContentJson(client, documentId);
    const revision = await client.query(
      `update documents
       set revision = revision + 1
       where id = $1
       returning revision`,
      [documentId]
    );
    const version = await appendDocumentVersion(client, documentId, `Block ${status}`);
    return {
      nextProcessingBlock: blockUpdate.next,
      revision: Number(revision.rows[0].revision),
      document: await loadDocument(client.query.bind(client), documentId, userId),
      version,
    };
  });
}
