const STORAGE_KEYS = {
  EVENTS: 'planify_events',
  CUSTOM: 'planify_custom',
  REMOVED_PRESETS: 'planify_removed_presets',
};

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.EVENTS);
    if (saved) events = JSON.parse(saved);
    const savedCustom = localStorage.getItem(STORAGE_KEYS.CUSTOM);
    if (savedCustom) customTypes = JSON.parse(savedCustom);
  } catch (e) {}
}

function saveData() {
  localStorage.setItem(STORAGE_KEYS.EVENTS, JSON.stringify(events));
  localStorage.setItem(STORAGE_KEYS.CUSTOM, JSON.stringify(customTypes));
}

function applyRemovedPresets() {
  try {
    const removed = JSON.parse(localStorage.getItem(STORAGE_KEYS.REMOVED_PRESETS) || '[]');
    removed.forEach(id => {
      const idx = DEFAULT_PRESETS.findIndex(t => t.id === id);
      if (idx !== -1) DEFAULT_PRESETS.splice(idx, 1);
    });
  } catch (e) {}
}

function persistRemovedPreset(id) {
  let removed = [];
  try { removed = JSON.parse(localStorage.getItem(STORAGE_KEYS.REMOVED_PRESETS) || '[]'); } catch (e) {}
  removed.push(id);
  localStorage.setItem(STORAGE_KEYS.REMOVED_PRESETS, JSON.stringify(removed));
}
