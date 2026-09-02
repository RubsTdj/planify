-- Planify — Planning d'équipe (service)
-- ============================================================================
-- Cadrage : un service de collègues qui se voient travailler. Pas un partage
-- un à un entre proches — à dix, il faudrait 45 relations croisées.
--
-- Deux décisions structurantes :
--
--   1. Le partage est LIMITÉ AUX SHIFTS, sans option. Dans un service,
--      personne ne montre ses rendez-vous perso à neuf collègues. Les
--      événements perso ne franchissent jamais la frontière de l'équipe, et
--      c'est la politique RLS qui le garantit, pas l'interface.
--
--   2. Le partage est en LECTURE SEULE, dans les deux sens. Rejoindre une
--      équipe ne donne à personne le droit d'écrire dans le planning d'un
--      autre. `events` garde des politiques d'écriture strictement
--      personnelles.
--
-- Un seul code par équipe, régénérable, valable 7 jours : à dix, distribuer
-- dix codes nominatifs serait une corvée. Le prix de ce choix est qu'un code
-- qui traîne dans un groupe WhatsApp laisse entrer un tiers — d'où le
-- garde-fou : la liste des membres est visible de tous, un admin peut retirer
-- quelqu'un, et l'équipe est plafonnée.
--
-- À exécuter dans le SQL editor Supabase.
-- ============================================================================


-- ─── 1. profiles ────────────────────────────────────────────────────────────
-- On ne montre jamais l'email de quelqu'un d'autre. Chacun choisit un nom
-- d'affichage, lisible uniquement par ses coéquipiers.
create table if not exists public.profiles (
  user_id      uuid        primary key references auth.users(id) on delete cascade,
  display_name text        not null check (length(trim(display_name)) between 1 and 40),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);


-- ─── 2. teams ───────────────────────────────────────────────────────────────
-- Le code de l'équipe n'est JAMAIS stocké en clair, seulement son SHA-256.
-- Une fuite de la table ne donne aucun code utilisable.
create table if not exists public.teams (
  id              uuid        primary key default gen_random_uuid(),
  name            text        not null check (length(trim(name)) between 1 and 60),
  created_by      uuid        references auth.users(id) on delete set null,
  code_hash       text        unique,
  code_expires_at timestamptz,
  max_members     int         not null default 30,
  created_at      timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id   uuid        not null references public.teams(id) on delete cascade,
  user_id   uuid        not null references auth.users(id)   on delete cascade,
  role      text        not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists team_members_user_idx on public.team_members(user_id);


-- ─── 3. Anti-force brute ────────────────────────────────────────────────────
-- Le compteur est porté par celui qui SAISIT le code, pas par l'équipe : sinon
-- on devinerait à l'aveugle en changeant de cible à chaque essai.
create table if not exists public.share_redeem_throttle (
  user_id      uuid        primary key references auth.users(id) on delete cascade,
  attempts     int         not null default 0,
  window_start timestamptz not null default now()
);


-- ─── 4. Helpers ─────────────────────────────────────────────────────────────
-- `security definer` : ces fonctions lisent team_members en contournant sa RLS,
-- ce qui évite toute récursion entre politiques. Elles ne renvoient qu'un
-- booléen, jamais de donnée.

create or replace function public.is_teammate(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.team_members mine
      join public.team_members theirs on theirs.team_id = mine.team_id
     where mine.user_id   = auth.uid()
       and theirs.user_id = p_other
       and p_other <> auth.uid()
  );
$$;

comment on function public.is_teammate is
  'Vrai si p_other partage au moins une équipe avec l''appelant. Utilisé par la politique de lecture de events.';

create or replace function public.is_team_admin(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.team_members
     where team_id = p_team and user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_team_member(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.team_members
     where team_id = p_team and user_id = auth.uid()
  );
$$;


-- ─── 5. RLS : la lecture s'élargit, l'écriture reste strictement perso ──────
-- C'est le cœur du chantier. `events` avait UNE politique `for all` qui
-- couvrait lecture et écriture d'un bloc. On la scinde : sans politique
-- d'écriture pour le coéquipier, aucune écriture n'est possible, même en
-- forgeant la requête à la main.

alter table public.profiles              enable row level security;
alter table public.teams                 enable row level security;
alter table public.team_members          enable row level security;
alter table public.share_redeem_throttle enable row level security;

-- profiles : le mien, plus ceux de mes coéquipiers.
drop policy if exists "read own and teammate profiles" on public.profiles;
create policy "read own and teammate profiles"
  on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.is_teammate(user_id));

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile"
  on public.profiles for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile"
  on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- teams : lisible par ses membres. Le code_hash n'est jamais exposé au client,
-- la vue applicative passe par la RPC `team_overview`.
drop policy if exists "read my teams" on public.teams;
create policy "read my teams"
  on public.teams for select to authenticated
  using (public.is_team_member(id));

-- team_members : chacun voit la composition de ses équipes. C'est le garde-fou
-- du code unique — personne ne peut entrer sans être vu de tous.
drop policy if exists "read my team members" on public.team_members;
create policy "read my team members"
  on public.team_members for select to authenticated
  using (public.is_team_member(team_id));

-- Créer, rejoindre, quitter, exclure : uniquement par RPC. Une politique
-- INSERT ouverte laisserait n'importe qui s'ajouter à n'importe quelle équipe.

-- events : lecture élargie aux coéquipiers, LIMITÉE AUX SHIFTS. Les événements
-- perso ne franchissent jamais la frontière de l'équipe.
drop policy if exists "users manage own events"    on public.events;
drop policy if exists "read own or shared events"  on public.events;
drop policy if exists "read own or team events"    on public.events;
create policy "read own or team events"
  on public.events for select to authenticated
  using (
    user_id = auth.uid()
    or (
      type_id in ('matin', 'soir', 'nuit', 'repos', 'vacances')
      and public.is_teammate(user_id)
    )
  );

drop policy if exists "insert own events" on public.events;
create policy "insert own events"
  on public.events for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "update own events" on public.events;
create policy "update own events"
  on public.events for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "delete own events" on public.events;
create policy "delete own events"
  on public.events for delete to authenticated
  using (user_id = auth.uid());

-- custom_types : strictement personnels. Aucun partage, dans aucun cas — c'est
-- la contrepartie du code d'équipe unique.
drop policy if exists "users manage own custom_types"     on public.custom_types;
drop policy if exists "read own or shared custom_types"   on public.custom_types;
drop policy if exists "read own custom_types"             on public.custom_types;
create policy "read own custom_types"
  on public.custom_types for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "insert own custom_types" on public.custom_types;
create policy "insert own custom_types"
  on public.custom_types for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "update own custom_types" on public.custom_types;
create policy "update own custom_types"
  on public.custom_types for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "delete own custom_types" on public.custom_types;
create policy "delete own custom_types"
  on public.custom_types for delete to authenticated
  using (user_id = auth.uid());


-- ─── 6. RPC ─────────────────────────────────────────────────────────────────

-- Génère un code d'équipe et renvoie le clair, une seule fois. Il n'est
-- récupérable nulle part ensuite : seul son hash est stocké.
create or replace function public.rotate_team_code(p_team uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  if not public.is_team_admin(p_team) then
    raise exception 'not a team admin' using errcode = '42501';
  end if;

  -- 10 caractères hexadécimaux = 40 bits. Avec 7 jours de validité et 10 essais
  -- par heure côté saisie, la recherche exhaustive est hors sujet.
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  update public.teams
     set code_hash       = encode(sha256(convert_to(v_code, 'UTF8')), 'hex'),
         code_expires_at = now() + interval '7 days'
   where id = p_team;

  return v_code;
end;
$$;

create or replace function public.create_team(p_name text)
returns table (o_team_id uuid, o_code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_team uuid;
  v_code text;
  v_n    int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'empty team name' using errcode = '22023';
  end if;

  -- Une personne n'a aucune raison d'ouvrir dix services.
  select count(*) into v_n from public.team_members
   where user_id = v_uid and role = 'admin';
  if v_n >= 3 then
    raise exception 'too many teams' using errcode = 'P0001';
  end if;

  insert into public.teams (name, created_by)
  values (substr(trim(p_name), 1, 60), v_uid)
  returning id into v_team;

  insert into public.team_members (team_id, user_id, role)
  values (v_team, v_uid, 'admin');

  v_code := public.rotate_team_code(v_team);
  return query select v_team, v_code;
end;
$$;

-- Rejoint une équipe à partir de son code.
create or replace function public.join_team(p_code text)
returns table (o_team_id uuid, o_team_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_norm text;
  v_hash text;
  v_team public.teams%rowtype;
  v_thr  public.share_redeem_throttle%rowtype;
  v_n    int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- 10 échecs par heure, comptés sur celui qui saisit.
  select * into v_thr from public.share_redeem_throttle where user_id = v_uid for update;
  if v_thr.user_id is null then
    insert into public.share_redeem_throttle (user_id) values (v_uid) returning * into v_thr;
  elsif v_thr.window_start < now() - interval '1 hour' then
    update public.share_redeem_throttle set attempts = 0, window_start = now()
     where user_id = v_uid returning * into v_thr;
  elsif v_thr.attempts >= 10 then
    raise exception 'too many attempts' using errcode = 'P0001';
  end if;

  -- Tolérant à la saisie : espaces, tirets et minuscules.
  v_norm := upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
  v_hash := encode(sha256(convert_to(v_norm, 'UTF8')), 'hex');

  select * into v_team from public.teams t
   where t.code_hash = v_hash and t.code_expires_at > now();

  if v_team.id is null then
    update public.share_redeem_throttle set attempts = attempts + 1 where user_id = v_uid;
    raise exception 'invalid or expired code' using errcode = 'P0001';
  end if;

  -- Plafond : borne les dégâts si un code circule plus loin que prévu.
  select count(*) into v_n from public.team_members where team_id = v_team.id;
  if v_n >= v_team.max_members then
    raise exception 'team is full' using errcode = 'P0001';
  end if;

  insert into public.team_members (team_id, user_id)
  values (v_team.id, v_uid)
  on conflict (team_id, user_id) do nothing;

  update public.share_redeem_throttle set attempts = 0, window_start = now()
   where user_id = v_uid;

  return query select v_team.id, v_team.name;
end;
$$;

create or replace function public.leave_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_admins int;
begin
  select count(*) into v_admins from public.team_members
   where team_id = p_team and role = 'admin' and user_id <> v_uid;

  -- Le dernier admin ne peut pas partir sans laisser l'équipe orpheline : il
  -- promeut quelqu'un, ou il supprime l'équipe.
  if public.is_team_admin(p_team) and v_admins = 0 then
    raise exception 'promote another admin first' using errcode = 'P0001';
  end if;

  delete from public.team_members where team_id = p_team and user_id = v_uid;
end;
$$;

-- Exclusion par un admin. C'est le contrepoids du code unique : si quelqu'un
-- est entré sans y avoir droit, on le sort en un geste.
create or replace function public.remove_team_member(p_team uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_team_admin(p_team) then
    raise exception 'not a team admin' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'use leave_team' using errcode = 'P0001';
  end if;
  delete from public.team_members where team_id = p_team and user_id = p_user;
end;
$$;

create or replace function public.promote_team_member(p_team uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_team_admin(p_team) then
    raise exception 'not a team admin' using errcode = '42501';
  end if;
  update public.team_members set role = 'admin'
   where team_id = p_team and user_id = p_user;
end;
$$;

create or replace function public.delete_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_team_admin(p_team) then
    raise exception 'not a team admin' using errcode = '42501';
  end if;
  delete from public.teams where id = p_team;
end;
$$;

-- Nom d'affichage, créé au premier lancement puis modifiable.
create or replace function public.set_display_name(p_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := nullif(trim(p_name), '');
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'empty name' using errcode = '22023';
  end if;

  v_name := substr(v_name, 1, 40);
  insert into public.profiles (user_id, display_name)
  values (v_uid, v_name)
  on conflict (user_id) do update
    set display_name = excluded.display_name, updated_at = now();

  return v_name;
end;
$$;


-- ─── 7. Permissions ─────────────────────────────────────────────────────────
-- Les RPC sont réservées aux comptes connectés. `anon` n'y touche jamais.
do $$
declare f text;
begin
  foreach f in array array[
    'create_team(text)', 'join_team(text)', 'leave_team(uuid)',
    'remove_team_member(uuid,uuid)', 'promote_team_member(uuid,uuid)',
    'rotate_team_code(uuid)', 'delete_team(uuid)', 'set_display_name(text)',
    'is_teammate(uuid)', 'is_team_admin(uuid)', 'is_team_member(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant  execute on function public.%s to authenticated', f);
  end loop;
end $$;
