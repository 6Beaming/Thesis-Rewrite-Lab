alter table users
  add column if not exists support_onboarding_pending boolean;

update users
set support_onboarding_pending = false
where support_onboarding_pending is null;

alter table users
  alter column support_onboarding_pending set default true,
  alter column support_onboarding_pending set not null;
