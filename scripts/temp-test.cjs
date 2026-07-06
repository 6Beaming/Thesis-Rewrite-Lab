const pg = require('pg');

// Temporary status generator for testing editor highlights and next-block selection.
const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/project_thesis_rewriter';
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
});

function chooseProcessingIndex(blockCount) {
  if (blockCount <= 0) return -1;
  return Math.min(2, blockCount - 1);
}

function statusForIndex(index, processingIndex) {
  if (index === processingIndex) return 'processing';
  if (index === 0) return 'processed';
  if (index === 1) return 'skipped';
  if (index === 3) return 'unprocessed';
  return index % 2 === 0 ? 'processed' : 'unprocessed';
}

async function main() {
  const documentId = process.argv[2];
  if (!documentId) {
    console.log('Usage: node scripts/temp-test.cjs <document-id>');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const blocks = await client.query(
      `
        select id, block_index
        from document_blocks
        where document_id = $1
        order by block_index asc
      `,
      [documentId]
    );

    if (!blocks.rows.length) {
      throw new Error('No blocks found for selected document.');
    }

    const processingIndex = chooseProcessingIndex(blocks.rows.length);
    const processing = blocks.rows[processingIndex];

    for (let index = 0; index < blocks.rows.length; index += 1) {
      const block = blocks.rows[index];
      const status = statusForIndex(index, processingIndex);
      await client.query(
        `
          update document_blocks
          set status = $3,
              attrs = jsonb_set(attrs, '{status}', to_jsonb($3::text), true),
              tiptap_node = jsonb_set(tiptap_node, '{attrs,status}', to_jsonb($3::text), true)
          where document_id = $1
            and id = $2
        `,
        [documentId, block.id, status]
      );
    }

    await client.query(
      `
        update documents
        set current_processing_block_id = $2,
            total_chars = stats.total_chars,
            completed_chars = stats.completed_chars,
            completed_rate = case
              when stats.total_chars > 0 then stats.completed_chars::numeric / stats.total_chars
              else 0
            end
        from (
          select
            coalesce(sum(char_length), 0)::int as total_chars,
            coalesce(sum(case when status in ('processed', 'skipped') then char_length else 0 end), 0)::int as completed_chars
          from document_blocks
          where document_id = $1
        ) stats
        where documents.id = $1
      `,
      [documentId, processing.id]
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
            and user_id = (select user_id from documents where id = $1)
          group by user_id
        ) stats
        where user_stats.user_id = stats.user_id
      `,
      [documentId]
    );

    await client.query('commit');
    console.log(`Temporary statuses applied to ${documentId}; processing block is ${processing.id}`);
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
