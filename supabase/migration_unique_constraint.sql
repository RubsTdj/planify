-- Fix unique constraint on events to include user_id
-- Run in: https://supabase.com/dashboard/project/svzqrozmelmztknnhjky/sql/new

-- Drop old constraint (date, type_id only)
alter table public.events drop constraint if exists events_date_type_id_key;

-- Add new constraint including user_id
alter table public.events
  add constraint events_date_type_id_user_id_key unique (date, type_id, user_id);
