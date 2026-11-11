-- Piecewise  -  Supabase schema
--
-- Paste this whole file into the Supabase SQL editor and run it once.
-- It is safe to run again: every statement is guarded.
--
-- What this sets up:
--   profiles      one row per account, with the username and an admin flag
--   usage_daily   one row per user per day, holding time and feature counts
--
-- Row Level Security is ON for both tables, so a signed-in user can only ever
-- read and write their own rows. The single exception is an admin, who can read
-- everyone's usage  -  that is what makes the in-app admin panel possible without
-- handing anybody the service_role key.


-- ============================================================ profiles

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  username    text unique not null,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;


-- A policy on profiles that itself reads profiles would recurse forever, so the
-- admin check goes through a SECURITY DEFINER function, which runs as the owner
-- and is therefore not subject to the policy it is being used by.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;


drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id)
  -- Without this check a user could simply set their own is_admin to true.
  with check (auth.uid() = id and is_admin = (select is_admin from public.profiles where id = auth.uid()));


-- Give every new auth user a profile row automatically, so the app never has to
-- cope with a signed-in user who has no profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================ usage

create table if not exists public.usage_daily (
  user_id     uuid not null references auth.users on delete cascade,
  day         date not null,
  seconds     integer not null default 0,
  opens       integer not null default 0,
  cards       integer not null default 0,
  features    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.usage_daily enable row level security;

create index if not exists usage_daily_day_idx on public.usage_daily (day);

drop policy if exists "read own usage" on public.usage_daily;
create policy "read own usage" on public.usage_daily
  for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "write own usage" on public.usage_daily;
create policy "write own usage" on public.usage_daily
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own usage" on public.usage_daily;
create policy "update own usage" on public.usage_daily
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ============================================================ admin reporting
--
-- A view rather than a query the app has to carry. It respects RLS, so it
-- returns one person's own rows to them and everybody's to an admin.

create or replace view public.usage_summary
with (security_invoker = true)
as
select
  p.username,
  p.created_at::date                       as joined,
  count(distinct u.day)                    as days_used,
  coalesce(sum(u.seconds), 0) / 60         as minutes,
  coalesce(sum(u.cards), 0)                as cards,
  max(u.day)                               as last_active
from public.profiles p
left join public.usage_daily u on u.user_id = p.id
group by p.id, p.username, p.created_at;


-- ============================================================ make yourself admin
--
-- Run this ONCE, after you have signed up in the app, replacing the username.
-- It cannot be done from inside the app on purpose: the update policy above
-- deliberately refuses to let anyone change their own is_admin flag.
--
--   update public.profiles set is_admin = true where username = 'your_username';
