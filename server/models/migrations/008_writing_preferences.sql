alter table users
  add column if not exists autosave_docs boolean not null default false,
  add column if not exists use_writing_preferences boolean not null default true,
  add column if not exists writing_preferences jsonb not null default '{}'::jsonb,
  add column if not exists preference_schema_version integer not null default 1;

alter table users drop constraint if exists users_preference_schema_version_valid;
alter table users add constraint users_preference_schema_version_valid
  check (preference_schema_version >= 1);

alter table block_rewrite_options
  add column if not exists effective_preferences jsonb not null default '{}'::jsonb,
  add column if not exists compiled_preference_supplement text not null default '',
  add column if not exists preference_warnings jsonb not null default '[]'::jsonb,
  add column if not exists preference_schema_version integer not null default 1,
  add column if not exists preference_compiler_version text not null default 'writing-preferences-v1';

alter table block_rewrite_jobs
  add column if not exists effective_preferences jsonb not null default '{}'::jsonb,
  add column if not exists preference_warnings jsonb not null default '[]'::jsonb,
  add column if not exists preference_schema_version integer not null default 1,
  add column if not exists preference_compiler_version text not null default 'writing-preferences-v1';
