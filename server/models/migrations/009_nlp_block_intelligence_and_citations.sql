alter table document_blocks
  add column if not exists nlp_status text not null default 'unknown',
  add column if not exists nlp_reason_codes jsonb not null default '[]'::jsonb,
  add column if not exists nlp_analysis jsonb not null default '{}'::jsonb,
  add column if not exists nlp_text_hash text,
  add column if not exists nlp_pipeline_version text,
  add column if not exists nlp_snapshot_fingerprint text,
  add column if not exists semantic_coherence double precision,
  add column if not exists semantic_anchor jsonb,
  add column if not exists nlp_checked_at timestamptz;

alter table document_blocks drop constraint if exists document_blocks_nlp_status_check;
alter table document_blocks add constraint document_blocks_nlp_status_check
  check (nlp_status in ('unknown', 'pass', 'warning', 'blocked', 'skipped'));

alter table document_blocks drop constraint if exists document_blocks_semantic_coherence_check;
alter table document_blocks add constraint document_blocks_semantic_coherence_check
  check (semantic_coherence is null or semantic_coherence between 0 and 1);

alter table documents
  add column if not exists nlp_semantic_profile text not null default 'medium',
  add column if not exists nlp_status text not null default 'pending',
  add column if not exists nlp_pipeline_version text,
  add column if not exists nlp_document_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists partition_revision integer not null default 0;

alter table documents drop constraint if exists documents_nlp_semantic_profile_check;
alter table documents add constraint documents_nlp_semantic_profile_check
  check (nlp_semantic_profile in ('low', 'medium', 'high'));

alter table documents drop constraint if exists documents_nlp_status_check;
alter table documents add constraint documents_nlp_status_check
  check (nlp_status in ('pending', 'processing', 'ready', 'degraded', 'failed'));

alter table documents drop constraint if exists documents_partition_revision_check;
alter table documents add constraint documents_partition_revision_check
  check (partition_revision >= 0);

create table if not exists document_nlp_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  requested_revision bigint not null,
  requested_partition_revision integer not null default 0,
  requested_profile text not null
    check (requested_profile in ('low', 'medium', 'high')),
  pipeline_version text not null,
  operation text not null default 'repartition'
    check (operation in ('import', 'repartition', 'backfill')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  attempt_count integer not null default 0,
  safe_error_code text,
  correlation_id text not null,
  summary_json jsonb not null default '{}'::jsonb,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists document_nlp_jobs_one_active
  on document_nlp_jobs (document_id)
  where status in ('queued', 'running');

create index if not exists document_nlp_jobs_claim
  on document_nlp_jobs (status, available_at, created_at)
  where status = 'queued';

drop trigger if exists document_nlp_jobs_touch_updated_at on document_nlp_jobs;
create trigger document_nlp_jobs_touch_updated_at
before update on document_nlp_jobs
for each row execute function touch_updated_at();

alter table block_analyses
  add column if not exists partition_generation integer not null default 0,
  add column if not exists nlp_snapshot_fingerprint text not null default 'none';

drop index if exists block_analyses_cache_key;
create unique index block_analyses_cache_key
  on block_analyses (
    document_id,
    block_id,
    source_text_hash,
    partition_generation,
    filter_signature,
    nlp_snapshot_fingerprint,
    model,
    prompt_version
  );

alter table block_rewrite_options
  add column if not exists nlp_supplement_fingerprint text not null default 'none',
  add column if not exists compiled_nlp_supplement text not null default '',
  add column if not exists nlp_snapshot jsonb not null default '{}'::jsonb;

drop index if exists block_rewrite_options_cache_key;
create unique index block_rewrite_options_cache_key
  on block_rewrite_options (
    document_id,
    block_id,
    source_text_hash,
    tone,
    model,
    prompt_version,
    nlp_supplement_fingerprint
  );

alter table block_rewrite_jobs
  add column if not exists nlp_supplement_fingerprint text not null default 'none',
  add column if not exists compiled_nlp_supplement text not null default '',
  add column if not exists nlp_snapshot jsonb not null default '{}'::jsonb;

drop index if exists block_rewrite_jobs_active_key;
create unique index block_rewrite_jobs_active_key
  on block_rewrite_jobs (
    document_id,
    block_id,
    source_text_hash,
    partition_generation,
    model,
    prompt_version,
    nlp_supplement_fingerprint
  )
  where status in ('queued', 'running');

create table if not exists document_citation_results (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  document_revision bigint not null,
  partition_revision integer not null,
  workflow text not null
    check (workflow in ('alignment', 'bibliography-completion', 'orphan-recommendation')),
  request_fingerprint text not null,
  result_json jsonb not null,
  renderer_version text,
  created_at timestamptz not null default now()
);

create unique index if not exists document_citation_results_cache_key
  on document_citation_results (
    document_id,
    document_revision,
    partition_revision,
    workflow,
    request_fingerprint
  );
