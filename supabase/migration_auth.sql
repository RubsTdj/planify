-- Planify – Auth migration
-- Run in: https://supabase.com/dashboard/project/svzqrozmelmztknnhjky/sql/new

-- ── 1. Add user_id columns ────────────────────────────────────────────────────
alter table public.events
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.custom_types
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- ── 2. Migrate existing anonymous rows to NULL user_id (kept as-is) ──────────
-- (nothing to do – existing rows will simply have user_id = NULL)

-- ── 3. Drop old open policies ─────────────────────────────────────────────────
drop policy if exists "anon full access on events"       on public.events;
drop policy if exists "anon full access on custom_types" on public.custom_types;

-- ── 4. New RLS: each user sees only their own rows ────────────────────────────
create policy "users manage own events"
  on public.events for all
  to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users manage own custom_types"
  on public.custom_types for all
  to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── 5. Index for fast per-user queries ───────────────────────────────────────
create index if not exists events_user_id_idx       on public.events(user_id);
create index if not exists custom_types_user_id_idx on public.custom_types(user_id);
