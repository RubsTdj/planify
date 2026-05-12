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
  showToast('⚠️ Erreur de sauvegarde');
}

// ── Load: fetch all events + custom types for the current user ───────────────
async function loadData() {
  const uid = currentUserId();
  if (!uid) return;

  try {
    const [{ data: evtRows, error: e1 }, { data: ctRows, error: e2 }] = await Promise.all([
      sb.from('events')
        .select('date, type_id')
        .eq('user_id', uid),
      sb.from('custom_types')
        .select('*')
        .eq('user_id', uid)
        .eq('is_deleted', false)
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
    customTypes = [];
    for (const row of (ctRows || [])) {
      const t = dbRowToCustomType(row);
      if (row.id.startsWith('preset_')) DEFAULT_PRESETS.push(t);
      else                              customTypes.push(t);
    }
  } catch (err) {
    console.error('Supabase loadData error:', err);
    showToast('⚠️ Erreur de connexion à la base de données');
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

async function saveCustomType(newType) {
  const row = { ...customTypeToDbRow(newType), user_id: currentUserId() };
  const { error } = await sb.from('custom_types').insert(row);
  reportError('saveCustomType', error, true);
}

// Hard-delete a custom or preset type AND every event that referenced it.
async function deleteCustomType(typeId) {
  const uid = currentUserId();
  const { error: e1 } = await sb.from('custom_types')
    .delete()
    .eq('id', typeId)
    .eq('user_id', uid);
  if (e1) console.error('deleteCustomType:', e1);

  const { error: e2 } = await sb.from('events')
    .delete()
    .eq('type_id', typeId)
    .eq('user_id', uid);
  if (e2) console.error('deleteCustomType events cleanup:', e2);
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
