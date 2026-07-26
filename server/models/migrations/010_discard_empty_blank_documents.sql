alter table documents
  add column if not exists discard_if_empty boolean not null default false;
