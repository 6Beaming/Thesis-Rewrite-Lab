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

create table if not exists block_analyses (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  block_id uuid not null,
  source_text_hash text not null,
  filter_signature text not null,
  filters jsonb not null,
  deterministic_metrics jsonb not null,
  result_json jsonb not null,
  usage_json jsonb,
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);

-- Older local schemas briefly attached analyses directly to replaceable block
-- rows. Keep analyses at the document level so ordinary saves do not erase them.
alter table block_analyses add column if not exists document_id uuid;

update block_analyses ba
set document_id = db.document_id
from document_blocks db
where ba.document_id is null
  and db.id = ba.block_id;

delete from block_analyses where document_id is null;

alter table block_analyses alter column document_id set not null;
alter table block_analyses drop constraint if exists block_analyses_block_id_fkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'block_analyses_document_id_fkey'
  ) then
    alter table block_analyses
      add constraint block_analyses_document_id_fkey
      foreign key (document_id) references documents(id) on delete cascade;
  end if;
end
$$;

create unique index if not exists block_analyses_cache_key
  on block_analyses (
    document_id,
    block_id,
    source_text_hash,
    filter_signature,
    model,
    prompt_version
  );

create index if not exists block_analyses_block_created
  on block_analyses (document_id, block_id, created_at desc);

create table if not exists block_rewrite_options (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  block_id uuid not null,
  source_text_hash text not null,
  tone text not null
    check (tone in ('formal-academic', 'persuasive-argumentative', 'accessible-concise')),
  rewritten_text text not null,
  explanation text not null,
  changes_json jsonb not null default '[]'::jsonb,
  meaning_preserved boolean not null,
  warnings_json jsonb not null default '[]'::jsonb,
  usage_json jsonb,
  model text not null,
  prompt_version text not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists block_rewrite_options_cache_key
  on block_rewrite_options (
    document_id,
    block_id,
    source_text_hash,
    tone,
    model,
    prompt_version
  );

create index if not exists block_rewrite_options_block_created
  on block_rewrite_options (document_id, block_id, created_at desc);

create table if not exists block_practice_attempts (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  block_id uuid not null,
  source_text_hash text not null,
  attempt_text text not null,
  attempt_text_hash text not null,
  analysis_context_key text not null default 'none',
  feedback_json jsonb not null,
  usage_json jsonb,
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);

alter table block_practice_attempts
  add column if not exists analysis_context_key text not null default 'none';

drop index if exists block_practice_attempts_cache_key;

create unique index if not exists block_practice_attempts_context_cache_key
  on block_practice_attempts (
    document_id,
    block_id,
    source_text_hash,
    attempt_text_hash,
    analysis_context_key,
    model,
    prompt_version
  );

create index if not exists block_practice_attempts_block_created
  on block_practice_attempts (document_id, block_id, created_at desc);

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
