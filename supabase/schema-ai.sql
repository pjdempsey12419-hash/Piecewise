-- Piecewise  -  rate limiting for the worksheet reader
--
-- Run this in the Supabase SQL editor after schema.sql.
--
-- The read-worksheet edge function calls a paid API, so every call costs you
-- money. This caps each account per day. The counter is claimed BEFORE the model
-- runs, in one atomic statement, so two requests arriving at once cannot both
-- see the same remaining allowance and both go through.

create table if not exists public.ai_reads (
  user_id  uuid not null references auth.users on delete cascade,
  day      date not null,
  count    integer not null default 0,
  primary key (user_id, day)
);

alter table public.ai_reads enable row level security;

drop policy if exists "read own ai usage" on public.ai_reads;
create policy "read own ai usage" on public.ai_reads
  for select using (auth.uid() = user_id or public.is_admin());

-- No insert or update policy on purpose. The counter is only ever written by
-- claim_ai_read below, which is SECURITY DEFINER  -  so a user cannot reset
-- their own count by writing to this table directly from the client.


-- Returns true if the caller had allowance left (and spends one), false if not.
--
-- The insert..on conflict..do update with the limit in its WHERE clause is what
-- makes this safe under concurrency: the row is locked for the update, so the
-- check and the increment cannot interleave. RETURNING tells us whether the
-- update actually happened.
create or replace function public.claim_ai_read(p_day date, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ok   boolean;
begin
  if v_user is null then
    return false;
  end if;

  insert into public.ai_reads (user_id, day, count)
  values (v_user, p_day, 1)
  on conflict (user_id, day) do update
    set count = public.ai_reads.count + 1
    where public.ai_reads.count < p_limit
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

revoke all on function public.claim_ai_read(date, integer) from public;
grant execute on function public.claim_ai_read(date, integer) to authenticated;
