-- Planify — Partage de planning entre deux comptes
-- ============================================================================
-- Modèle : invitation SORTANTE. Le propriétaire du planning génère un code,
-- le transmet par son propre canal (SMS, de vive voix), l'autre le saisit.
-- Personne ne peut demander l'accès à un inconnu : pas d'annuaire, donc aucune
-- surface d'énumération de comptes.
--
-- Le partage est en LECTURE SEULE et la règle vit ici, pas dans le front :
-- une politique RLS sur `events` décide qui lit quoi. Le JS n'a aucun moyen de
-- la contourner et une révocation prend effet à la requête suivante.
--
-- Hypothèse de cadrage : relation un à un (couple, cercle proche). Un usage
-- « service de dix collègues » demanderait une notion d'équipe, pas ce modèle.
--
-- À exécuter dans le SQL editor Supabase.
-- ============================================================================


-- ─── 1. profiles ────────────────────────────────────────────────────────────
-- On ne veut jamais montrer l'email de quelqu'un d'autre. Chacun choisit un nom
-- d'affichage, lisible uniquement par les comptes avec qui il est en relation.
create table if not exists public.profiles (
  user_id      uuid        primary key references auth.users(id) on delete cascade,
  display_name text        not null check (length(trim(display_name)) between 1 and 40),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);


-- ─── 2. shares ──────────────────────────────────────────────────────────────
-- La relation active. `scope` décide de ce qui traverse :
--   'shifts' → uniquement matin / soir / nuit / repos / vacances
--   'all'    → les événements perso aussi (physio, coiffeur, fêtes…)
-- C'est LA décision de confidentialité : un conjoint aura 'all', une collègue
-- 'shifts'. Elle est appliquée dans la politique RLS, pas dans l'interface.
create table if not exists public.shares (
  id         uuid        primary key default gen_random_uuid(),
  owner_id   uuid        not null references auth.users(id) on delete cascade,
  viewer_id  uuid        not null references auth.users(id) on delete cascade,
  scope      text        not null default 'shifts' check (scope in ('shifts', 'all')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint shares_no_self check (owner_id <> viewer_id)
);

-- Un seul partage actif par paire. Les partages révoqués restent en trace.
create unique index if not exists shares_active_pair_idx
  on public.shares(owner_id, viewer_id) where revoked_at is null;
create index if not exists shares_viewer_idx on public.shares(viewer_id) where revoked_at is null;


-- ─── 3. share_invites ───────────────────────────────────────────────────────
-- Le code n'est JAMAIS stocké en clair, seulement son SHA-256, comme un mot de
-- passe. Une fuite de la table ne donne aucun code utilisable.
create table if not exists public.share_invites (
  id         uuid        primary key default gen_random_uuid(),
  owner_id   uuid        not null references auth.users(id) on delete cascade,
  code_hash  text        not null unique,
  scope      text        not null default 'shifts' check (scope in ('shifts', 'all')),
  expires_at timestamptz not null,
  used_at    timestamptz,
  used_by    uuid        references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists share_invites_owner_idx on public.share_invites(owner_id);


-- ─── 4. Anti-force brute ────────────────────────────────────────────────────
-- Le compteur est porté par celui qui SAISIT, pas par l'invitation : sinon on
-- pourrait deviner à l'aveugle en changeant de cible à chaque essai.
create table if not exists public.share_redeem_throttle (
  user_id      uuid        primary key references auth.users(id) on delete cascade,
  attempts     int         not null default 0,
  window_start timestamptz not null default now()
);


-- ─── 5. Helpers ─────────────────────────────────────────────────────────────
-- `security definer` : ces fonctions lisent `shares` en contournant sa propre
-- RLS, ce qui évite toute récursion entre politiques. Elles ne renvoient qu'un
-- booléen ou un scope, jamais de donnée.

create or replace function public.share_scope(p_owner uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.scope
  from public.shares s
  where s.owner_id  = p_owner
    and s.viewer_id = auth.uid()
    and s.revoked_at is null
  limit 1;
$$;

comment on function public.share_scope is
  'Scope du partage actif de p_owner vers l''appelant, ou NULL. Utilisé par les politiques RLS de events et custom_types.';

create or replace function public.is_connected(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.shares s
    where s.revoked_at is null
      and (   (s.owner_id = p_other     and s.viewer_id = auth.uid())
           or (s.viewer_id = p_other    and s.owner_id  = auth.uid()))
  );
$$;


-- ─── 6. RLS : la lecture s'élargit, l'écriture reste strictement perso ──────
-- C'est le cœur du chantier. Avant, `events` avait UNE politique `for all` qui
-- couvrait lecture et écriture d'un bloc. On la scinde : sans politique
-- d'écriture pour le lecteur, aucune écriture n'est possible, même en forgeant
-- la requête à la main.

alter table public.profiles             enable row level security;
alter table public.shares               enable row level security;
alter table public.share_invites        enable row level security;
alter table public.share_redeem_throttle enable row level security;

-- profiles : le mien, plus ceux des comptes avec qui je suis en relation.
drop policy if exists "read own and connected profiles" on public.profiles;
create policy "read own and connected profiles"
  on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.is_connected(user_id));

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile"
  on public.profiles for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile"
  on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- shares : lecture seule côté client. Créer ou révoquer passe par les RPC —
-- une politique UPDATE ouverte laisserait un lecteur passer son propre scope
-- de 'shifts' à 'all', RLS ne sait pas restreindre colonne par colonne.
drop policy if exists "read my shares" on public.shares;
create policy "read my shares"
  on public.shares for select to authenticated
  using (owner_id = auth.uid() or viewer_id = auth.uid());

-- share_invites : le propriétaire voit ses invitations en attente. Rien d'autre.
drop policy if exists "read own invites" on public.share_invites;
create policy "read own invites"
  on public.share_invites for select to authenticated
  using (owner_id = auth.uid());

-- events : lecture élargie au partage, écriture inchangée.
drop policy if exists "users manage own events" on public.events;
drop policy if exists "read own or shared events" on public.events;
create policy "read own or shared events"
  on public.events for select to authenticated
  using (
    user_id = auth.uid()
    or case public.share_scope(user_id)
         when 'all'    then true
         when 'shifts' then type_id in ('matin', 'soir', 'nuit', 'repos', 'vacances')
         else false
       end
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

-- custom_types : visibles seulement si le partage est 'all'. Avec 'shifts', le
-- lecteur ne voit ni les événements perso ni même leur existence.
drop policy if exists "users manage own custom_types" on public.custom_types;
drop policy if exists "read own or shared custom_types" on public.custom_types;
create policy "read own or shared custom_types"
  on public.custom_types for select to authenticated
  using (user_id = auth.uid() or public.share_scope(user_id) = 'all');

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


-- ─── 7. RPC ─────────────────────────────────────────────────────────────────

-- Génère une invitation et renvoie le code EN CLAIR, une seule fois. Il n'est
-- récupérable nulle part ensuite : seul son hash est stocké.
create or replace function public.create_share_invite(p_scope text default 'shifts')
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_code    text;
  v_pending int;
  v_today   int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_scope not in ('shifts', 'all') then
    raise exception 'invalid scope' using errcode = '22023';
  end if;

  -- Quotas : borne le nombre de codes valides en circulation et la création en
  -- rafale. Sans ça, un compte compromis pourrait semer des invitations.
  select count(*) into v_pending
    from public.share_invites
   where owner_id = v_uid and used_at is null and expires_at > now();
  if v_pending >= 5 then
    raise exception 'too many pending invites' using errcode = 'P0001';
  end if;

  select count(*) into v_today
    from public.share_invites
   where owner_id = v_uid and created_at > now() - interval '24 hours';
  if v_today >= 20 then
    raise exception 'daily invite limit reached' using errcode = 'P0001';
  end if;

  -- 10 caractères hexadécimaux = 40 bits. Avec 72 h de validité, l'usage unique
  -- et 10 essais par heure côté lecteur, la recherche exhaustive est hors sujet.
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.share_invites (owner_id, code_hash, scope, expires_at)
  values (v_uid, encode(sha256(convert_to(v_code, 'UTF8')), 'hex'),
          p_scope, now() + interval '72 hours');

  return v_code;
end;
$$;

-- Consomme un code : crée le partage et marque l'invitation comme utilisée.
create or replace function public.redeem_share_invite(p_code text)
returns table (o_owner_id uuid, o_display_name text, o_scope text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_norm   text;
  v_hash   text;
  v_invite public.share_invites%rowtype;
  v_thr    public.share_redeem_throttle%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Le compteur d'essais est porté par celui qui saisit : 10 échecs par heure.
  select * into v_thr from public.share_redeem_throttle where user_id = v_uid for update;
  if v_thr.user_id is null then
    insert into public.share_redeem_throttle (user_id) values (v_uid) returning * into v_thr;
  elsif v_thr.window_start < now() - interval '1 hour' then
    update public.share_redeem_throttle
       set attempts = 0, window_start = now()
     where user_id = v_uid returning * into v_thr;
  elsif v_thr.attempts >= 10 then
    raise exception 'too many attempts' using errcode = 'P0001';
  end if;

  -- Tolérant à la saisie : espaces, tirets et minuscules.
  v_norm := upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
  v_hash := encode(sha256(convert_to(v_norm, 'UTF8')), 'hex');

  select * into v_invite
    from public.share_invites i
   where i.code_hash = v_hash
     and i.used_at is null
     and i.expires_at > now()
   for update;

  if v_invite.id is null then
    update public.share_redeem_throttle
       set attempts = attempts + 1 where user_id = v_uid;
    raise exception 'invalid or expired code' using errcode = 'P0001';
  end if;

  if v_invite.owner_id = v_uid then
    raise exception 'cannot share with yourself' using errcode = 'P0001';
  end if;

  update public.share_invites
     set used_at = now(), used_by = v_uid
   where id = v_invite.id;

  -- Réutiliser la ligne existante si le partage avait été révoqué autrefois.
  insert into public.shares (owner_id, viewer_id, scope)
  values (v_invite.owner_id, v_uid, v_invite.scope)
  on conflict (owner_id, viewer_id) where revoked_at is null
  do update set scope = excluded.scope;

  update public.share_redeem_throttle set attempts = 0, window_start = now()
   where user_id = v_uid;

  return query
    select v_invite.owner_id,
           coalesce((select p.display_name from public.profiles p
                      where p.user_id = v_invite.owner_id), 'Planify'),
           v_invite.scope;
end;
$$;

-- Révocation, des deux côtés : le propriétaire coupe, le lecteur se désabonne.
create or replace function public.revoke_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  update public.shares
     set revoked_at = now()
   where id = p_share_id
     and revoked_at is null
     and (owner_id = v_uid or viewer_id = v_uid);
end;
$$;

-- Annule une invitation encore en attente.
create or replace function public.cancel_share_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.share_invites
   where id = p_invite_id and owner_id = auth.uid() and used_at is null;
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


-- ─── 8. Permissions ─────────────────────────────────────────────────────────
-- Les RPC sont réservées aux comptes connectés. `anon` n'y touche jamais.
revoke execute on function public.create_share_invite(text)  from anon, public;
revoke execute on function public.redeem_share_invite(text)  from anon, public;
revoke execute on function public.revoke_share(uuid)         from anon, public;
revoke execute on function public.cancel_share_invite(uuid)  from anon, public;
revoke execute on function public.set_display_name(text)     from anon, public;
revoke execute on function public.share_scope(uuid)          from anon, public;
revoke execute on function public.is_connected(uuid)         from anon, public;

grant execute on function public.create_share_invite(text)  to authenticated;
grant execute on function public.redeem_share_invite(text)  to authenticated;
grant execute on function public.revoke_share(uuid)         to authenticated;
grant execute on function public.cancel_share_invite(uuid)  to authenticated;
grant execute on function public.set_display_name(text)     to authenticated;
grant execute on function public.share_scope(uuid)          to authenticated;
grant execute on function public.is_connected(uuid)         to authenticated;
