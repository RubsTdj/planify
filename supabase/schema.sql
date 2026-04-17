-- Planify – Supabase schema
-- Run this in: https://supabase.com/dashboard/project/svzqrozmelmztknnhjky/sql/new

-- ─── events ──────────────────────────────────────────────────────────────────
-- One row per (date, event_type_id) pair.
create table if not exists public.events (
  id         bigint generated always as identity primary key,
  date       date        not null,
  type_id    text        not null,
  created_at timestamptz not null default now(),
  unique (date, type_id)
);

-- ─── custom_types ─────────────────────────────────────────────────────────────
-- User-created event types (also stores "removed presets" as is_deleted=true).
create table if not exists public.custom_types (
  id          text        primary key,   -- 'custom_<timestamp>' or 'preset_xxx'
  label       text        not null,
  emoji       text        not null,
  duration    text        not null default 'allday',  -- 'allday' | 'half' | 'custom'
  all_day     boolean     not null default true,
  half_day    text,                                    -- 'morning' | 'afternoon'
  start_time  text,
  end_time    text,
  is_deleted  boolean     not null default false,      -- true = removed preset
  created_at  timestamptz not null default now()
);

-- ─── Row Level Security (open – no auth for now) ───────────────────────────
alter table public.events      enable row level security;
alter table public.custom_types enable row level security;

-- Allow all operations for anonymous users (no login required)
create policy "anon full access on events"
  on public.events for all
  to anon
  using (true)
  with check (true);

create policy "anon full access on custom_types"
  on public.custom_types for all
  to anon
  using (true)
  with check (true);
