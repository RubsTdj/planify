// ─── Event types, locale strings, emoji catalog ──────────────────────────────
// EVENT_TYPES is the fixed built-in palette (work shifts + rest + vacation).
// DEFAULT_PRESETS + customTypes are user-editable "perso" types loaded from
// Supabase at startup (see storage.js → loadData).

const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin',
                   'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const DAYS_FR   = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];

// NOTE: `nuit` is an OVERNIGHT shift — its end time wraps to the next day.
// utils.isOvernightShift(type) returns true for it, and export.js rolls the
// ICS DTEND forward by one day so calendar apps accept the event.
const EVENT_TYPES = [
  { id: 'matin',    label: 'Matin',    emoji: '☀️',  startTime: '08:00', endTime: '15:30', cssClass: 'matin',    tagClass: 'tag-matin',    category: 'work',     allDay: false },
  { id: 'soir',     label: 'Soir',     emoji: '🌇',  startTime: '14:00', endTime: '22:30', cssClass: 'soir',     tagClass: 'tag-soir',     category: 'work',     allDay: false },
  { id: 'nuit',     label: 'Nuit',     emoji: '🌙',  startTime: '22:00', endTime: '07:30', cssClass: 'nuit',     tagClass: 'tag-nuit',     category: 'work',     allDay: false },
  { id: 'repos',    label: 'Repos',    emoji: '😴',                                        cssClass: 'repos',    tagClass: 'tag-repos',    category: 'off',      allDay: true  },
  { id: 'vacances', label: 'Vacances', emoji: '🏖️',                                        cssClass: 'vacances', tagClass: 'tag-vacances', category: 'vacation', allDay: true  },
];

// Populated at runtime from Supabase custom_types where id starts with 'preset_'.
const DEFAULT_PRESETS = [];

const EMOJI_OPTIONS = ['📋','🏃','💊','🧘','🎓','🚗','🛒','🎂','❤️','🔔','💈','📞','🏠','🎉','☕','🍴','🗼','💪','✨','💅','🐶','🎵','📚','✈️'];

// Resolve an event id to its full type definition. Order matters: built-ins
// win over presets, which win over user-defined customs. Perso types are
// returned with the generic custom cssClass/tagClass so they always inherit
// the neutral grey styling.
function getEventType(id) {
  const found = EVENT_TYPES.find(t => t.id === id);
  if (found) return found;
  const preset = DEFAULT_PRESETS.find(t => t.id === id);
  if (preset) return { ...preset, cssClass: 'custom', tagClass: 'tag-custom', category: 'custom' };
  const custom = customTypes.find(t => t.id === id);
  if (custom) return { ...custom, cssClass: 'custom', tagClass: 'tag-custom', category: 'custom' };
  return null;
}

function getAllPersoTypes() {
  return [...DEFAULT_PRESETS, ...customTypes];
}

function isDeletableType(typeId) {
  return DEFAULT_PRESETS.some(t => t.id === typeId)
      || customTypes.some(t => t.id === typeId);
}
