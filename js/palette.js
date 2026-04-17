const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const DAYS_FR   = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];

const EVENT_TYPES = [
  { id: 'matin',    label: 'Matin',    emoji: '☀️',  startTime: '08:00', endTime: '15:30', cssClass: 'matin',    tagClass: 'tag-matin',    category: 'work',     allDay: false },
  { id: 'soir',     label: 'Soir',     emoji: '🌇',  startTime: '14:00', endTime: '22:30', cssClass: 'soir',     tagClass: 'tag-soir',     category: 'work',     allDay: false },
  { id: 'nuit',     label: 'Nuit',     emoji: '🌙',  startTime: '22:00', endTime: '07:30', cssClass: 'nuit',     tagClass: 'tag-nuit',     category: 'work',     allDay: false },
  { id: 'repos',    label: 'Repos',    emoji: '😴',                                        cssClass: 'repos',    tagClass: 'tag-repos',    category: 'off',      allDay: true  },
  { id: 'vacances', label: 'Vacances', emoji: '🏖️',                                        cssClass: 'vacances', tagClass: 'tag-vacances', category: 'vacation', allDay: true  },
];

// Populated at runtime from Supabase custom_types (preset_ rows)
const DEFAULT_PRESETS = [];

const EMOJI_OPTIONS = ['📋','🏃','💊','🧘','🎓','🚗','🛒','🎂','❤️','🔔','💈','📞','🏠','🎉','☕','🍴','🗼','💪','✨','💅','🐶','🎵','📚','✈️'];

function getEventType(id) {
  let found = EVENT_TYPES.find(t => t.id === id);
  if (found) return found;
  found = DEFAULT_PRESETS.find(t => t.id === id);
  if (found) return { ...found, cssClass: 'custom', tagClass: 'tag-custom', category: 'custom' };
  found = customTypes.find(t => t.id === id);
  if (found) return { ...found, cssClass: 'custom', tagClass: 'tag-custom', category: 'custom' };
  return null;
}

function getAllPersoTypes() {
  return [...DEFAULT_PRESETS, ...customTypes];
}

function isDeletableType(typeId) {
  return DEFAULT_PRESETS.some(t => t.id === typeId) || customTypes.some(t => t.id === typeId);
}
