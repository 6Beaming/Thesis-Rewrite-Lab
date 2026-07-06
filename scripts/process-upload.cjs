const fs = require('fs/promises');
const path = require('path');
const pg = require('pg');
const mammoth = require('mammoth');
const { randomUUID } = require('crypto');
const { initialClustering } = require('./lib/initialClustering.cjs');

// Temporary CLI importer for local testing until the upload API covers every fixture workflow.
const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/project_thesis_rewriter';
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
});

function usage() {
  console.log('Usage: node scripts/process-upload.cjs <file-path> [title]');
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

function markForTag(tagName) {
  if (tagName === 'strong' || tagName === 'b') return 'bold';
  if (tagName === 'em' || tagName === 'i') return 'italic';
  if (tagName === 'u') return 'underline';
  if (tagName === 'code') return 'code';
  return null;
}

function attrsForBlockTag(tagName) {
  if (tagName === 'h1') return { fontSize: '20pt', textIndent: '0in' };
  if (tagName === 'h2') return { fontSize: '16pt', textIndent: '0in' };
  if (tagName === 'h3') return { fontSize: '14pt', textIndent: '0in' };
  if (tagName === 'li') return { textIndent: '0.25in' };
  return {};
}

function cloneMarks(activeMarks) {
  return activeMarks.map((type) => ({ type }));
}

function appendText(content, text, activeMarks) {
  if (!text) return;
  const node = { type: 'text', text };
  if (activeMarks.length) node.marks = cloneMarks(activeMarks);
  content.push(node);
}

function trimContent(content) {
  const next = content
    .map((node) => ({ ...node, marks: node.marks ? [...node.marks] : undefined }))
    .filter((node) => node.text);

  while (next.length && !next[0].text.trim()) next.shift();
  while (next.length && !next[next.length - 1].text.trim()) next.pop();
  if (next.length) {
    next[0].text = next[0].text.replace(/^\s+/, '');
    next[next.length - 1].text = next[next.length - 1].text.replace(/\s+$/, '');
  }
  return next.filter((node) => node.text);
}

function textFromContent(content) {
  return content.map((node) => node.text ?? '').join('');
}

function formattedBlocksFromHtml(html) {
  const blocks = [];
  let activeMarks = [];
  let currentContent = [];
  let currentAttrs = {};

  function finishBlock({ resetAttrs = false } = {}) {
    const content = trimContent(currentContent);
    const text = textFromContent(content);
    if (text) blocks.push({ text, content, attrs: currentAttrs });
    currentContent = [];
    if (resetAttrs) currentAttrs = {};
  }

  function appendFormattedText(rawText) {
    const decoded = decodeHtmlEntities(rawText).replace(/\s+/g, ' ');
    const pieces = decoded.split(/(\.)/);
    for (const piece of pieces) {
      if (!piece) continue;
      appendText(currentContent, piece, activeMarks);
      if (piece === '.') finishBlock();
    }
  }

  const tokenPattern = /<[^>]+>|[^<]+/g;
  for (const match of html.matchAll(tokenPattern)) {
    const token = match[0];
    if (!token.startsWith('<')) {
      appendFormattedText(token);
      continue;
    }

    const tag = token.match(/^<\s*(\/)?\s*([a-z0-9]+)/i);
    if (!tag) continue;

    const isClosing = Boolean(tag[1]);
    const tagName = tag[2].toLowerCase();
    const mark = markForTag(tagName);
    const isBlockTag = ['p', 'div', 'li', 'h1', 'h2', 'h3'].includes(tagName);

    if (tagName === 'br' && !isClosing) {
      appendText(currentContent, '\n', activeMarks);
      continue;
    }

    if (mark) {
      if (isClosing) {
        const index = activeMarks.lastIndexOf(mark);
        if (index >= 0) activeMarks.splice(index, 1);
      } else {
        activeMarks.push(mark);
      }
      continue;
    }

    if (isBlockTag) {
      if (!isClosing) {
        finishBlock({ resetAttrs: true });
        currentAttrs = attrsForBlockTag(tagName);
      } else {
        finishBlock({ resetAttrs: true });
      }
    }
  }

  finishBlock({ resetAttrs: true });
  return blocks;
}

async function extractBlocks(filePath, buffer) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.doc') {
    throw new Error('.doc uploads are not supported. Use .docx, .md, or .txt.');
  }
  if (extension === '.docx') {
    const htmlResult = await mammoth.convertToHtml({ buffer });
    const formattedBlocks = formattedBlocksFromHtml(htmlResult.value);
    if (formattedBlocks.length) return formattedBlocks;

    const textResult = await mammoth.extractRawText({ buffer });
    return initialClustering(textResult.value);
  }
  if (extension === '.txt' || extension === '.md') {
    return initialClustering(buffer.toString('utf8'));
  }
  throw new Error('Only .txt, .md, and .docx uploads are supported.');
}

function createBlock(blockInput, index) {
  const text = typeof blockInput === 'string' ? blockInput : String(blockInput?.text ?? '');
  const content = typeof blockInput === 'string'
    ? (text ? [{ type: 'text', text }] : [])
    : (blockInput.content ?? (text ? [{ type: 'text', text }] : []));
  const id = randomUUID();
  const status = index === 0 ? 'processing' : 'unprocessed';
  const attrs = {
    lineHeight: '2.0',
    textIndent: '0.5in',
    textAlign: 'left',
    fontFamily: 'Times New Roman',
    fontSize: '12pt',
    ...(typeof blockInput === 'string' ? {} : blockInput.attrs ?? {}),
    blockId: id,
    status,
    length: text.length,
  };
  return {
    id,
    index,
    text,
    status,
    attrs,
    node: {
      type: 'paragraph',
      attrs,
      content,
    },
  };
}

function extensionMime(extension) {
  if (extension === '.docx') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (extension === '.md') {
    return 'text/markdown';
  }
  return 'text/plain';
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    usage();
    process.exit(1);
  }

  const buffer = await fs.readFile(filePath);
  const extractedBlocks = await extractBlocks(filePath, buffer);
  const extension = path.extname(filePath).toLowerCase();
  const title = process.argv[3] || path.basename(filePath, extension).replace(/[_-]+/g, ' ');
  const blocks = extractedBlocks.map(createBlock);
  const contentJson = { type: 'doc', content: blocks.map((block) => block.node) };
  const totalChars = blocks.reduce((sum, block) => sum + block.text.length, 0);
  const client = await pool.connect();

  try {
    await client.query('begin');
    const user = await client.query(
      `
        insert into users (email, display_name)
        values ($1, $2)
        on conflict (email)
        do update set updated_at = users.updated_at
        returning id
      `,
      ['test@example.com', 'test@example']
    );
    await client.query(
      `
        insert into user_stats (user_id)
        values ($1)
        on conflict (user_id) do nothing
      `,
      [user.rows[0].id]
    );

    const document = await client.query(
      `
        insert into documents (
          user_id, title, academic_style, content_json, original_filename,
          original_mime, original_file, total_chars, current_processing_block_id
        )
        values ($1, $2, 'APA', $3::jsonb, $4, $5, $6, $7, $8)
        returning id
      `,
      [
        user.rows[0].id,
        title,
        JSON.stringify(contentJson),
        path.basename(filePath),
        extensionMime(extension),
        buffer,
        totalChars,
        blocks[0]?.id ?? null,
      ]
    );

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
          document.rows[0].id,
          block.index,
          block.text,
          block.status,
          block.text.length,
          JSON.stringify(block.attrs),
          JSON.stringify(block.node),
        ]
      );
    }

    await client.query(
      `
        insert into document_versions (
          document_id, version_number, label, academic_style_snapshot, text_preview, snapshot_json
        )
        values ($1, 1, 'Initial import', 'APA', $2, $3::jsonb)
      `,
      [
        document.rows[0].id,
        blocks.map((block) => block.text).join(' ').slice(0, 180),
        JSON.stringify({
          document: { title, academic_style: 'APA', content_json: contentJson },
          blocks: blocks.map((block) => ({
            id: block.id,
            document_id: document.rows[0].id,
            block_index: block.index,
            text_content: block.text,
            status: block.status,
            char_length: block.text.length,
            attrs: block.attrs,
            tiptap_node: block.node,
          })),
        }),
      ]
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
            and user_id = $1
          group by user_id
        ) stats
        where user_stats.user_id = stats.user_id
      `,
      [user.rows[0].id]
    );

    await client.query('commit');
    console.log(`Imported ${title} as ${document.rows[0].id}`);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
