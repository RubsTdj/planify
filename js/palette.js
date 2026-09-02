// ─── Event types, locale strings, emoji catalog ──────────────────────────────
// EVENT_TYPES is the fixed built-in palette (work shifts + rest + vacation).
// DEFAULT_PRESETS + customTypes are user-editable "perso" types loaded from
// Supabase at startup (see storage.js → loadData).

const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin',
                   'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const DAYS_FR   = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];

// NOTE: les horaires des shifts Matin/Soir/Nuit sont **informatifs** —
// `informationalTime: true` indique à l'Edge Function `calendar-feed` de les
// exporter en all-day dans le flux ICS, pour éviter tout chevauchement
// (notamment Nuit qui passe minuit). Seuls les events custom non all-day
// utilisent un vrai créneau horaire dans l'ICS.
const EVENT_TYPES = [
  { id: 'matin',    label: 'Matin',    emoji: '☀️',  startTime: '08:00', endTime: '15:30', cssClass: 'matin',    tagClass: 'tag-matin',    category: 'work',     allDay: false, informationalTime: true },
  { id: 'soir',     label: 'Soir',     emoji: '🌇',  startTime: '14:00', endTime: '22:30', cssClass: 'soir',     tagClass: 'tag-soir',     category: 'work',     allDay: false, informationalTime: true },
  { id: 'nuit',     label: 'Nuit',     emoji: '🌙',  startTime: '22:00', endTime: '07:30', cssClass: 'nuit',     tagClass: 'tag-nuit',     category: 'work',     allDay: false, informationalTime: true },
  { id: 'repos',    label: 'Repos',    emoji: '😴',                                        cssClass: 'repos',    tagClass: 'tag-repos',    category: 'off',      allDay: true  },
  { id: 'vacances', label: 'Vacances', emoji: '🏖️',                                        cssClass: 'vacances', tagClass: 'tag-vacances', category: 'vacation', allDay: true  },
];

// Populated at runtime from Supabase custom_types where id starts with 'preset_'.
const DEFAULT_PRESETS = [];

// Types perso "archivés" (is_deleted = true en base) : ils n'apparaissent plus
// dans la palette de chips mais restent résolvables, donc les jours déjà
// planifiés gardent leur événement (calendrier, impression et flux ICS).
// Deux façons d'y atterrir :
//   1) l'utilisateur retire le type de sa liste alors que des jours l'utilisent
//   2) l'événement a été créé en mode "ponctuel" (jamais mis dans la palette)
let archivedTypes = [];

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
  const archived = archivedTypes.find(t => t.id === id);
  if (archived) return { ...archived, cssClass: 'custom', tagClass: 'tag-custom', category: 'custom', archived: true };
  return null;
}

function getAllPersoTypes() {
  return [...DEFAULT_PRESETS, ...customTypes];
}

function isDeletableType(typeId) {
  return DEFAULT_PRESETS.some(t => t.id === typeId)
      || customTypes.some(t => t.id === typeId);
}
