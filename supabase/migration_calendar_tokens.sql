-- Planify – Calendar subscription tokens
-- One opaque UUID per user, used in the public ICS feed URL served by the
-- `calendar-feed` Edge Function. Rotating the row invalidates any previous
-- subscription URL the user shared.
-- Run in Supabase SQL editor or via `supabase db push`.

create table if not exists public.user_calendar_tokens (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  token      uuid        not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

-- Fast lookup by token (used by the Edge Function on every feed request).
create index if not exists user_calendar_tokens_token_idx
  on public.user_calendar_tokens(token);

-- RLS: a user can read AND rotate their OWN token. They cannot read others'
-- tokens, ever. The Edge Function reads via the service-role key, which
-- bypasses RLS — that's intentional and the ONLY way the public feed works.
alter table public.user_calendar_tokens enable row level security;

drop policy if exists "users read own calendar token"     on public.user_calendar_tokens;
drop policy if exists "users upsert own calendar token"   on public.user_calendar_tokens;
drop policy if exists "users update own calendar token"   on public.user_calendar_tokens;

create policy "users read own calendar token"
  on public.user_calendar_tokens for select
  to authenticated
  using (user_id = auth.uid());

create policy "users upsert own calendar token"
  on public.user_calendar_tokens for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users update own calendar token"
  on public.user_calendar_tokens for update
  to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Rotate (revoke + reissue) the current user's token ───────────────────────
-- SECURITY INVOKER: the RLS policies above already authorize the
-- authenticated user to insert/update their own row, so we don't need to
-- escalate. anon is explicitly revoked so a logged-out client cannot poke
-- the RPC at all.
create or replace function public.rotate_calendar_token()
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  uid     uuid := auth.uid();
  new_tok uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.user_calendar_tokens (user_id, token)
  values (uid, gen_random_uuid())
  on conflict (user_id)
  do update set token = gen_random_uuid(), rotated_at = now()
  returning token into new_tok;

  return new_tok;
end;
$$;

revoke all on function public.rotate_calendar_token() from public;
revoke all on function public.rotate_calendar_token() from anon;
grant execute on function public.rotate_calendar_token() to authenticated;
