// ─── Supabase persistence ─────────────────────────────────────────────────────
// All reads/writes go to Supabase. No localStorage used.

async function loadData() {
  try {
    const uid = currentUser?.id;

    // Load events for this user
    const { data: evtRows, error: e1 } = await sb
      .from('events')
      .select('date, type_id')
      .eq('user_id', uid);
    if (e1) throw e1;

    events = {};
    (evtRows || []).forEach(row => {
      if (!events[row.date]) events[row.date] = [];
      events[row.date].push(row.type_id);
    });

    // Load custom types for this user (not deleted)
    const { data: ctRows, error: e2 } = await sb
      .from('custom_types')
      .select('*')
      .eq('user_id', uid)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });
    if (e2) throw e2;

    DEFAULT_PRESETS.length = 0;
    customTypes = [];

    (ctRows || []).forEach(row => {
      const t = dbRowToCustomType(row);
      if (row.id.startsWith('preset_')) {
        DEFAULT_PRESETS.push(t);
      } else {
        customTypes.push(t);
      }
    });

  } catch (err) {
    console.error('Supabase loadData error:', err);
    showToast('⚠️ Erreur de connexion à la base de données');
  }
}


// Save a single day's event addition
async function saveEventAdd(dateStr, typeId) {
  const uid = currentUser?.id;
  const { error } = await sb
    .from('events')
    .insert({ date: dateStr, type_id: typeId, user_id: uid });
  if (error && error.code !== '23505') { // ignore duplicate
    console.error('saveEventAdd:', error);
    showToast('⚠️ Erreur de sauvegarde');
  }
}

// Remove a single event from a day
async function saveEventRemove(dateStr, typeId) {
  const uid = currentUser?.id;
  const { error } = await sb
    .from('events')
    .delete()
    .eq('date', dateStr)
    .eq('type_id', typeId)
    .eq('user_id', uid);
  if (error) { console.error('saveEventRemove:', error); showToast('⚠️ Erreur de sauvegarde'); }
}

// Batch insert: apply one typeId to many dates
async function saveEventBatch(dates, typeId) {
  const uid  = currentUser?.id;
  const rows = dates.map(d => ({ date: d, type_id: typeId, user_id: uid }));
  const { error } = await sb
    .from('events')
    .insert(rows);
  if (error && error.code !== '23505') {
    console.error('saveEventBatch:', error);
    showToast('⚠️ Erreur de sauvegarde');
  }
}

// Save a new custom event type
async function saveCustomType(newType) {
  const uid = currentUser?.id;
  const row = { ...customTypeToDbRow(newType), user_id: uid };
  const { error } = await sb
    .from('custom_types')
    .insert(row);
  if (error && error.code !== '23505') {
    console.error('saveCustomType:', error);
    showToast('⚠️ Erreur de sauvegarde');
  }
}

// Delete a custom/preset type: hard delete from DB + clean up all events using it
async function deleteCustomType(typeId) {
  const uid = currentUser?.id;
  const { error } = await sb
    .from('custom_types')
    .delete()
    .eq('id', typeId)
    .eq('user_id', uid);
  if (error) console.error('deleteCustomType:', error);

  const { error: e2 } = await sb
    .from('events')
    .delete()
    .eq('type_id', typeId)
    .eq('user_id', uid);
  if (e2) console.error('deleteCustomType events cleanup:', e2);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
