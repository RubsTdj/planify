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
-- All perso event types: presets (id starts with 'preset_') + user-created (id starts with 'custom_').
-- is_deleted is kept for soft-delete safety but hard deletes are used in practice.
create table if not exists public.custom_types (
  id          text        primary key,   -- 'preset_xxx' or 'custom_<timestamp>'
  label       text        not null,
  emoji       text        not null,
  duration    text        not null default 'allday',  -- 'allday' | 'half' | 'custom'
  all_day     boolean     not null default true,
  half_day    text,                                    -- 'morning' | 'afternoon'
  start_time  text,
  end_time    text,
  is_deleted  boolean     not null default false,
  created_at  timestamptz not null default now()
);

-- ─── Seed default presets ──────────────────────────────────────────────────────
insert into public.custom_types (id, label, emoji, duration, all_day, half_day, start_time, end_time) values
  ('preset_paris',         'Paris',         '🗼', 'allday', true,  null,      null,    null),
  ('preset_physio',        'Physio',        '💪', 'allday', true,  null,      null,    null),
  ('preset_coiffeur',      'Coiffeur',      '💇', 'half',   false, 'morning', '08:00', '12:00'),
  ('preset_estheticienne', 'Esthéticienne', '✨', 'half',   false, 'morning', '08:00', '12:00'),
  ('preset_manucure',      'Manucure',      '💅', 'half',   false, 'morning', '08:00', '12:00'),
  ('preset_formation',     'Formation',     '📋', 'allday', true,  null,      null,    null)
on conflict (id) do nothing;

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
