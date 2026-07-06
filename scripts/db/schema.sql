create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text,
  profile_picture bytea,
  profile_picture_mime text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_stats (
  user_id uuid primary key references users(id) on delete cascade,
  completed_chars integer not null default 0,
  total_chars integer not null default 0,
  completed_rate numeric not null default 0,
  streak_day_count integer not null default 0,
  streak_start_date date,
  streak_end_date date,
  streak_days jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  academic_style text not null default 'APA'
    check (academic_style in ('APA', 'MLA', 'Chicago', 'Customized')),
  style_settings jsonb not null default '{}'::jsonb,
  content_json jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  original_filename text,
  original_mime text,
  original_file bytea,
  completed_chars integer not null default 0,
  total_chars integer not null default 0,
  completed_rate numeric not null default 0,
  current_processing_block_id uuid,
  trashed boolean not null default false,
  trashed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists document_blocks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  block_index integer not null,
  text_content text not null,
  status text not null default 'unprocessed'
    check (status in ('unprocessed', 'processing', 'processed', 'skipped')),
  char_length integer not null default 0,
  attrs jsonb not null default '{}'::jsonb,
  tiptap_node jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, block_index)
);

create unique index if not exists document_blocks_one_processing
  on document_blocks (document_id)
  where status = 'processing';

create index if not exists document_blocks_document_order
  on document_blocks (document_id, block_index);

create table if not exists document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  version_number integer not null,
  label text not null,
  academic_style_snapshot text not null,
  text_preview text,
  snapshot_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (document_id, version_number)
);

create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_touch_updated_at on users;
create trigger users_touch_updated_at
before update on users
for each row execute function touch_updated_at();

drop trigger if exists documents_touch_updated_at on documents;
create trigger documents_touch_updated_at
before update on documents
for each row execute function touch_updated_at();

drop trigger if exists document_blocks_touch_updated_at on document_blocks;
create trigger document_blocks_touch_updated_at
before update on document_blocks
for each row execute function touch_updated_at();
