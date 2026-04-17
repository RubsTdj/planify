// ─── Supabase persistence ─────────────────────────────────────────────────────
// All reads/writes go to Supabase. No localStorage used.

async function loadData() {
  try {
    // Load events: [{date, type_id}]
    const { data: evtRows, error: e1 } = await sb
      .from('events')
      .select('date, type_id');
    if (e1) throw e1;

    events = {};
    (evtRows || []).forEach(row => {
      if (!events[row.date]) events[row.date] = [];
      events[row.date].push(row.type_id);
    });

    // Load custom types (not deleted)
    const { data: ctRows, error: e2 } = await sb
      .from('custom_types')
      .select('*')
      .eq('is_deleted', false);
    if (e2) throw e2;

    // Separate user-created custom types from removed presets
    customTypes = [];
    const removedPresetIds = [];

    (ctRows || []).forEach(row => {
      // Preset IDs start with 'preset_'
      if (row.id.startsWith('preset_')) {
        removedPresetIds.push(row.id);
      } else {
        customTypes.push(dbRowToCustomType(row));
      }
    });

    // Remove presets that were deleted
    removedPresetIds.forEach(id => {
      const idx = DEFAULT_PRESETS.findIndex(t => t.id === id);
      if (idx !== -1) DEFAULT_PRESETS.splice(idx, 1);
    });

  } catch (err) {
    console.error('Supabase loadData error:', err);
    showToast('⚠️ Erreur de connexion à la base de données');
  }
}

// Save a single day's event addition
async function saveEventAdd(dateStr, typeId) {
  const { error } = await sb
    .from('events')
    .upsert({ date: dateStr, type_id: typeId }, { onConflict: 'date,type_id' });
  if (error) { console.error('saveEventAdd:', error); showToast('⚠️ Erreur de sauvegarde'); }
}

// Remove a single event from a day
async function saveEventRemove(dateStr, typeId) {
  const { error } = await sb
    .from('events')
    .delete()
    .eq('date', dateStr)
    .eq('type_id', typeId);
  if (error) { console.error('saveEventRemove:', error); showToast('⚠️ Erreur de sauvegarde'); }
}

// Batch insert: apply one typeId to many dates
async function saveEventBatch(dates, typeId) {
  const rows = dates.map(d => ({ date: d, type_id: typeId }));
  const { error } = await sb
    .from('events')
    .upsert(rows, { onConflict: 'date,type_id' });
  if (error) { console.error('saveEventBatch:', error); showToast('⚠️ Erreur de sauvegarde'); }
}

// Save a new custom event type
async function saveCustomType(newType) {
  const { error } = await sb
    .from('custom_types')
    .upsert(customTypeToDbRow(newType));
  if (error) { console.error('saveCustomType:', error); showToast('⚠️ Erreur de sauvegarde'); }
}

// Delete a custom/preset type (mark preset as deleted, hard-delete custom)
async function deleteCustomType(typeId) {
  if (typeId.startsWith('preset_')) {
    // Upsert a row with is_deleted=true to remember it was removed
    const { error } = await sb
      .from('custom_types')
      .upsert({ id: typeId, label: typeId, emoji: '🗑️', is_deleted: true });
    if (error) console.error('deleteCustomType preset:', error);
  } else {
    const { error } = await sb
      .from('custom_types')
      .delete()
      .eq('id', typeId);
    if (error) console.error('deleteCustomType custom:', error);
  }

  // Also remove all events that used this type
  const { error: e2 } = await sb
    .from('events')
    .delete()
    .eq('type_id', typeId);
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
