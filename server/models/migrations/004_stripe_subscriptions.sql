alter table users
  add column if not exists stripe_customer_id text;

alter table users
  add column if not exists stripe_subscription_id text;

alter table users
  add column if not exists stripe_price_id text;

alter table users
  add column if not exists stripe_subscription_status text;

alter table users
  add column if not exists latest_invoice_status text;

alter table users
  add column if not exists access_state text not null default 'basic';

alter table users
  add column if not exists cancel_at_period_end boolean not null default false;

alter table users
  add column if not exists current_period_end timestamptz;

alter table users
  add column if not exists subscription_updated_at timestamptz not null default now();

create unique index if not exists users_stripe_customer_id_unique
  on users (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists users_stripe_subscription_id_unique
  on users (stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table users drop constraint if exists users_access_state_valid;
alter table users add constraint users_access_state_valid
  check (access_state in ('basic', 'processing', 'pro', 'payment_failed'))
  not valid;
alter table users validate constraint users_access_state_valid;

create table if not exists stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  event_created_at timestamptz not null,
  processed_at timestamptz not null default now()
);

create index if not exists stripe_webhook_events_processed_at_idx
  on stripe_webhook_events (processed_at desc);
