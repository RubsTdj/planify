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

    // Seed default presets for new users
    if (DEFAULT_PRESETS.length === 0) {
      await seedDefaultPresets(uid);
    }

  } catch (err) {
    console.error('Supabase loadData error:', err);
    showToast('⚠️ Erreur de connexion à la base de données');
  }
}

async function seedDefaultPresets(uid) {
  const presets = [
    { id: `preset_paris_${uid}`,         label: 'Paris',         emoji: '🗼', duration: 'allday', all_day: true,  half_day: null,      start_time: null,    end_time: null,    is_deleted: false, user_id: uid },
    { id: `preset_physio_${uid}`,        label: 'Physio',        emoji: '💪', duration: 'allday', all_day: true,  half_day: null,      start_time: null,    end_time: null,    is_deleted: false, user_id: uid },
    { id: `preset_coiffeur_${uid}`,      label: 'Coiffeur',      emoji: '💇', duration: 'half',   all_day: false, half_day: 'morning', start_time: '08:00', end_time: '12:00', is_deleted: false, user_id: uid },
    { id: `preset_estheticienne_${uid}`, label: 'Esthéticienne', emoji: '✨', duration: 'half',   all_day: false, half_day: 'morning', start_time: '08:00', end_time: '12:00', is_deleted: false, user_id: uid },
    { id: `preset_manucure_${uid}`,      label: 'Manucure',      emoji: '💅', duration: 'half',   all_day: false, half_day: 'morning', start_time: '08:00', end_time: '12:00', is_deleted: false, user_id: uid },
    { id: `preset_formation_${uid}`,     label: 'Formation',     emoji: '📋', duration: 'allday', all_day: true,  half_day: null,      start_time: null,    end_time: null,    is_deleted: false, user_id: uid },
  ];
  const { error } = await sb.from('custom_types').upsert(presets, { onConflict: 'id' });
  if (error) { console.error('seedDefaultPresets:', error); return; }
  presets.forEach(p => DEFAULT_PRESETS.push(dbRowToCustomType(p)));
}

// Save a single day's event addition
async function saveEventAdd(dateStr, typeId) {
  const uid = currentUser?.id;
  const { error } = await sb
    .from('events')
    .upsert({ date: dateStr, type_id: typeId, user_id: uid }, { onConflict: 'date,type_id,user_id' });
  if (error) { console.error('saveEventAdd:', error); showToast('⚠️ Erreur de sauvegarde'); }
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
    .upsert(rows, { onConflict: 'date,type_id,user_id' });
  if (error) { console.error('saveEventBatch:', error); showToast('⚠️ Erreur de sauvegarde'); }
}

// Save a new custom event type
async function saveCustomType(newType) {
  const uid = currentUser?.id;
  const row = { ...customTypeToDbRow(newType), user_id: uid };
  const { error } = await sb
    .from('custom_types')
    .upsert(row, { onConflict: 'id' });
  if (error) { console.error('saveCustomType:', error); showToast('⚠️ Erreur de sauvegarde'); }
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
