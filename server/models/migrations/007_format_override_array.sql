alter table document_blocks
  alter column format_overrides set default '[]'::jsonb;

update document_blocks
set format_overrides = '[]'::jsonb
where jsonb_typeof(format_overrides) <> 'array';
