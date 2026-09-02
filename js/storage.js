// ─── Supabase persistence ─────────────────────────────────────────────────────
// RLS on the tables restricts every query to the authenticated user
// (see supabase/migration_auth.sql). We still attach `user_id = currentUser.id`
// on writes — it's a belt-and-suspenders defence and required by the unique
// constraint that includes user_id.

function currentUserId() {
  return currentUser?.id;
}

// Generic error reporter for storage writes. Postgres unique-violation (23505)
// is intentionally swallowed for inserts since we treat duplicates as no-ops.
function reportError(where, error, ignoreDuplicate = false) {
  if (!error) return;
  if (ignoreDuplicate && error.code === '23505') return;
  console.error(where + ':', error);
  showToast('Erreur de sauvegarde');
}

// ── Load: fetch all events + custom types for one owner ─────────────────────
// `ownerId` par défaut = moi. En consultant un planning partagé, c'est l'id de
// l'autre : ce sont les politiques RLS qui autorisent (ou non) la lecture et
// qui filtrent selon le périmètre du partage. Le client ne décide de rien.
async function loadData(ownerId) {
  const uid = ownerId || currentUserId();
  if (!uid) return;

  try {
    const [{ data: evtRows, error: e1 }, { data: ctRows, error: e2 }] = await Promise.all([
      sb.from('events')
        .select('date, type_id')
        .eq('user_id', uid),
      // Les types archivés (is_deleted) sont chargés eux aussi : ils ne sont pas
      // proposés dans la palette mais restent nécessaires pour afficher les
      // jours du planning qui les référencent encore.
      sb.from('custom_types')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: true }),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;

    // Re-index events as { 'YYYY-MM-DD': [typeId, ...] }.
    events = {};
    for (const row of (evtRows || [])) {
      (events[row.date] ||= []).push(row.type_id);
    }

    DEFAULT_PRESETS.length = 0;
    customTypes   = [];
    archivedTypes = [];
    for (const row of (ctRows || [])) {
      const t = dbRowToCustomType(row);
      if (row.is_deleted)                    archivedTypes.push(t);
      else if (row.id.startsWith('preset_')) DEFAULT_PRESETS.push(t);
      else                                   customTypes.push(t);
    }
  } catch (err) {
    console.error('Supabase loadData error:', err);
    showToast('Connexion à la base impossible');
  }
}

// ── Mutations ────────────────────────────────────────────────────────────────
async function saveEventAdd(dateStr, typeId) {
  const { error } = await sb.from('events')
    .insert({ date: dateStr, type_id: typeId, user_id: currentUserId() });
  reportError('saveEventAdd', error, true);
}

async function saveEventRemove(dateStr, typeId) {
  const { error } = await sb.from('events')
    .delete()
    .eq('date',    dateStr)
    .eq('type_id', typeId)
    .eq('user_id', currentUserId());
  reportError('saveEventRemove', error);
}

async function saveEventBatch(dates, typeId) {
  const uid  = currentUserId();
  const rows = dates.map(d => ({ date: d, type_id: typeId, user_id: uid }));
  const { error } = await sb.from('events').insert(rows);
  reportError('saveEventBatch', error, true);
}

// `archived: true` → le type est enregistré hors palette (événement ponctuel).
async function saveCustomType(newType, archived = false) {
  const row = { ...customTypeToDbRow(newType), is_deleted: archived, user_id: currentUserId() };
  const { error } = await sb.from('custom_types').insert(row);
  reportError('saveCustomType', error, true);
}

// Retire un type de la palette SANS toucher aux jours qui l'utilisent.
// Le soft-delete garde la ligne en base pour que le calendrier et le flux ICS
// puissent continuer à résoudre le label / l'emoji / les horaires.
async function archiveCustomType(typeId) {
  const { error } = await sb.from('custom_types')
    .update({ is_deleted: true })
    .eq('id', typeId)
    .eq('user_id', currentUserId());
  reportError('archiveCustomType', error);
}

// Suppression définitive de la ligne custom_types. Réservée aux types qui
// ne sont plus référencés par aucun jour (sinon on perdrait l'affichage).
async function purgeCustomType(typeId) {
  const { error } = await sb.from('custom_types')
    .delete()
    .eq('id', typeId)
    .eq('user_id', currentUserId());
  if (error) console.error('purgeCustomType:', error);
}

// ── DB row ↔ in-memory type translation ──────────────────────────────────────
function customTypeToDbRow(t) {
  return {
    id:         t.id,
    label:      t.label,
    emoji:      t.emoji,
    duration:   t.duration   || 'allday',
    all_day:    t.allDay     !== undefined ? t.allDay : true,
    half_day:   t.halfDay    || null,
    start_time: t.startTime  || null,
    end_time:   t.endTime    || null,
    is_deleted: false,
  };
}

function dbRowToCustomType(row) {
  return {
    id:        row.id,
    label:     row.label,
    emoji:     row.emoji,
    duration:  row.duration,
    allDay:    row.all_day,
    halfDay:   row.half_day,
    startTime: row.start_time,
    endTime:   row.end_time,
  };
}
