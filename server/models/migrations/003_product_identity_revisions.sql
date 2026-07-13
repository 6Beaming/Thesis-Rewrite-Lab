delete from users where lower(email) = 'test@example.com';

alter table users add column if not exists auth_user_id uuid;

update users as product_user
set auth_user_id = auth_user.id
from auth_users as auth_user
where product_user.auth_user_id is null
  and lower(product_user.email) = lower(auth_user.email);

do $$
begin
  if exists (select 1 from users where auth_user_id is null) then
    raise exception 'Cannot link every product user to an Auth.js user';
  end if;
end;
$$;

alter table users drop constraint if exists users_auth_user_id_fkey;
alter table users
  add constraint users_auth_user_id_fkey
  foreign key (auth_user_id) references auth_users(id) on delete cascade;

create unique index if not exists users_auth_user_id_unique
  on users (auth_user_id);

alter table users alter column auth_user_id set not null;

alter table documents
  add column if not exists revision bigint not null default 1;

create index if not exists documents_user_trash_updated_idx
  on documents (user_id, trashed, updated_at desc);

alter table user_stats drop constraint if exists user_stats_counts_nonnegative;
alter table user_stats add constraint user_stats_counts_nonnegative
  check (
    completed_chars >= 0
    and total_chars >= 0
    and completed_chars <= total_chars
    and completed_rate between 0 and 1
    and streak_day_count >= 0
  ) not valid;
alter table user_stats validate constraint user_stats_counts_nonnegative;

alter table documents drop constraint if exists documents_progress_valid;
alter table documents add constraint documents_progress_valid
  check (
    completed_chars >= 0
    and total_chars >= 0
    and completed_chars <= total_chars
    and completed_rate between 0 and 1
    and revision >= 1
  ) not valid;
alter table documents validate constraint documents_progress_valid;

alter table document_blocks drop constraint if exists document_blocks_length_nonnegative;
alter table document_blocks add constraint document_blocks_length_nonnegative
  check (char_length >= 0) not valid;
alter table document_blocks validate constraint document_blocks_length_nonnegative;

alter table document_blocks
  drop constraint if exists document_blocks_document_id_id_key;
alter table document_blocks
  add constraint document_blocks_document_id_id_key unique (document_id, id);

alter table documents
  drop constraint if exists documents_current_processing_block_fkey;
alter table documents
  add constraint documents_current_processing_block_fkey
  foreign key (id, current_processing_block_id)
  references document_blocks (document_id, id)
  on delete set null (current_processing_block_id)
  deferrable initially deferred;
