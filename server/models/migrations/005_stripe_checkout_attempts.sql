alter table users
  add column if not exists stripe_checkout_session_id text;

alter table users
  add column if not exists stripe_checkout_session_expires_at timestamptz;

alter table users
  add column if not exists stripe_checkout_attempt_token text;

alter table users
  add column if not exists stripe_checkout_attempt_started_at timestamptz;

create unique index if not exists users_stripe_checkout_session_id_unique
  on users (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
