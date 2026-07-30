alter table document_versions
  add column if not exists content_hash char(32);

update document_versions
set content_hash = md5(trim(regexp_replace(
  coalesce(
    (
      select string_agg(trim(block.value ->> 'text_content'), ' ' order by block.ordinality)
      from jsonb_array_elements(
        coalesce(document_versions.snapshot_json -> 'blocks', '[]'::jsonb)
      ) with ordinality as block(value, ordinality)
    ),
    ''
  ),
  '[[:space:]]+',
  ' ',
  'g'
)))
where content_hash is null;

alter table document_versions
  alter column content_hash set not null;
