alter table document_blocks
  add column if not exists resume_status text,
  add column if not exists processing_baseline_text text,
  add column if not exists change_source text not null default 'none',
  add column if not exists partition_generation integer not null default 0,
  add column if not exists format_overrides jsonb not null default '{}'::jsonb;

alter table document_blocks drop constraint if exists document_blocks_resume_status_valid;
alter table document_blocks add constraint document_blocks_resume_status_valid
  check (resume_status is null or resume_status in ('unprocessed', 'processed', 'skipped'));

alter table document_blocks drop constraint if exists document_blocks_change_source_valid;
alter table document_blocks add constraint document_blocks_change_source_valid
  check (change_source in ('none', 'manual', 'ai-replacement', 'practice-replacement'));

alter table document_blocks drop constraint if exists document_blocks_partition_generation_valid;
alter table document_blocks add constraint document_blocks_partition_generation_valid
  check (partition_generation >= 0);

update document_blocks
set resume_status = coalesce(resume_status, 'unprocessed'),
    processing_baseline_text = coalesce(processing_baseline_text, text_content)
where status = 'processing';

-- Some pre-release databases applied the original 002 baseline before the AI
-- cache tables were moved into that file. Keep this additive migration able to
-- upgrade both histories without rewriting the applied baseline.
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

create unique index if not exists block_analyses_cache_key
  on block_analyses (
    document_id, block_id, source_text_hash, filter_signature, model, prompt_version
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
    document_id, block_id, source_text_hash, tone, model, prompt_version
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

create unique index if not exists block_practice_attempts_context_cache_key
  on block_practice_attempts (
    document_id, block_id, source_text_hash, attempt_text_hash,
    analysis_context_key, model, prompt_version
  );
create index if not exists block_practice_attempts_block_created
  on block_practice_attempts (document_id, block_id, created_at desc);

create table if not exists block_rewrite_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  block_id uuid not null,
  source_text_hash text not null,
  partition_generation integer not null default 0,
  requested_tones jsonb not null,
  model text not null,
  prompt_version text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  attempt_count integer not null default 0,
  safe_error_code text,
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists block_rewrite_jobs_active_key
  on block_rewrite_jobs (
    document_id,
    block_id,
    source_text_hash,
    partition_generation,
    model,
    prompt_version
  )
  where status in ('queued', 'running');

create index if not exists block_rewrite_jobs_claim
  on block_rewrite_jobs (status, available_at, created_at)
  where status = 'queued';

drop trigger if exists block_rewrite_jobs_touch_updated_at on block_rewrite_jobs;
create trigger block_rewrite_jobs_touch_updated_at
before update on block_rewrite_jobs
for each row execute function touch_updated_at();

alter table user_stats
  add column if not exists last_active_on date,
  add column if not exists time_zone text;
