// ─── Calendar rendering ───────────────────────────────────────────────────────
// Renders the month grid, handles navigation and day-click delegation.
// All DOM construction goes through the safe `el()` helper (see utils.js) so
// user-provided strings (custom-type labels, emojis) cannot inject HTML.

let currentMonth, currentYear;
let events        = {};
let animatedTags  = {};

// Intitulés secondaires affichés par jour à l'écran (au-delà : « +N »).
// À l'impression on les rend tous.
const MAX_TAGS_SCREEN = 2;

// Types comptés dans le résumé du mois, dans cet ordre. Vacances n'apparaît
// que si le mois affiché en contient : sinon la ligne resterait à cinq
// colonnes pour rien sur un écran de 375px.
const SUMMARY_TYPES = ['matin', 'soir', 'nuit', 'repos', 'vacances'];
const WORK_TYPES    = ['matin', 'soir', 'nuit'];

// Le type qui colore le numéro du jour : le premier trouvé dans cet ordre.
// Tout le reste (autre shift, événement perso) descend en intitulé sous le
// numéro, en toutes lettres — un emoji seul obligerait à deviner ou à cliquer.
const PRIMARY_ORDER = ['matin', 'soir', 'nuit', 'vacances', 'repos'];

// Build a `YYYY-MM-DD` key — used everywhere as the canonical date format.
function formatDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ── Public render entry point ────────────────────────────────────────────────
function render() {
  const monthEl = document.getElementById('monthLabel');
  const yearEl  = document.getElementById('yearLabel');
  if (monthEl) monthEl.textContent = MONTHS_FR[currentMonth];
  if (yearEl)  yearEl.textContent  = currentYear;

  renderMonthSummary();
  renderCalendarLegend();
  renderCalendar();
  updateBatchUI();
}

// ── Carte de charge du mois ──────────────────────────────────────────────────
// Combien de matins, soirs, nuits et repos sur le mois affiché. Rien de
// nouveau en base : c'est un décompte de `events` sur le préfixe du mois.
function countByTypeForMonth() {
  const prefix = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-`;
  const counts = {};
  for (const dateStr in events) {
    if (!dateStr.startsWith(prefix)) continue;
    for (const typeId of events[dateStr]) counts[typeId] = (counts[typeId] || 0) + 1;
  }
  return counts;
}

// Une barre segmentée vaut mieux que quatre nombres alignés : on voit du même
// coup le volume travaillé ET sa répartition.
function buildLoadCard(counts) {
  const worked = WORK_TYPES.reduce((n, id) => n + (counts[id] || 0), 0);

  const top = el('div', { class: 'ms-top' },
    el('div', { class: 'ms-total' },
      el('b', { text: worked }),
      el('span', { text: worked > 1 ? 'jours travaillés' : 'jour travaillé' }),
    ),
    el('div', { class: 'ms-rest' },
      el('b', { text: counts.repos || 0 }),
      el('span', { text: 'repos' }),
    ),
  );

  const bar = el('div', { class: 'ms-bar' },
    ...WORK_TYPES.filter(id => counts[id]).map(id =>
      el('i', { class: id, style: `flex:${counts[id]}` })),
  );

  const legend = el('div', { class: 'ms-legend' },
    ...WORK_TYPES.map(id => {
      const type = getEventType(id);
      const n    = counts[id] || 0;
      return el('div', { class: 'ms-leg' },
        el('i', { class: id }),
        el('b', { text: n }),
        el('span', { text: (type ? type.label : id).toLowerCase() + (n > 1 ? 's' : '') }),
      );
    }),
    counts.vacances ? el('div', { class: 'ms-leg' },
      el('i', { class: 'vacances' }),
      el('b', { text: counts.vacances }),
      el('span', { text: 'vacances' }),
    ) : null,
  );

  return [top, bar, legend];
}

// Mois vide : proposer l'action plutôt qu'aligner des zéros.
function buildEmptyLoadCard() {
  return [el('div', { class: 'ms-empty' },
    el('div', { class: 'ms-empty-ic' }, icon('cal')),
    el('div', { class: 'ms-empty-tx' },
      el('b', { text: 'Rien de planifié' }),
      el('span', { text: 'Sélectionne plusieurs jours pour poser un shift d\'un coup.' }),
    ),
  )];
}

function renderMonthSummary() {
  const box = document.getElementById('monthSummary');
  if (!box) return;
  const counts = countByTypeForMonth();
  const any    = SUMMARY_TYPES.some(id => counts[id]);
  replaceChildren(box, ...(any ? buildLoadCard(counts) : buildEmptyLoadCard()));
}

// Légende des couleurs, sous la grille.
function renderCalendarLegend() {
  const box = document.getElementById('calLegend');
  if (!box) return;
  replaceChildren(box, ...SUMMARY_TYPES
    .filter(id => id !== 'vacances' || countByTypeForMonth().vacances)
    .map(id => {
      const type = getEventType(id);
      return el('div', { class: 'cal-leg' },
        el('i', { class: id }),
        el('span', { text: type ? type.label : id }),
      );
    }));
}

// ── Helpers used by the cell renderer ────────────────────────────────────────

// JS Date.getDay() returns 0=Sun..6=Sat; we want 0=Mon..6=Sun for a Mon-first
// grid. Returns how many empty cells to insert before day 1.
function leadingEmptyCells(year, month) {
  let offset = new Date(year, month, 1).getDay() - 1;
  return offset < 0 ? 6 : offset;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}

// Un intitulé par événement secondaire. Safe against XSS — label/emoji go
// through textContent via el(), never innerHTML.
function buildEventTag(type, dateStr) {
  const animKey = dateStr + '|' + type.id;
  const animate = !animatedTags[animKey];
  if (animate) animatedTags[animKey] = true;

  return el('div', {
    class: `event-tag ${type.tagClass || 'tag-custom'}${animate ? ' animate-in' : ''}`,
    text: type.label,
    attrs: { title: type.label },
  });
}

// Le shift qui colore le numéro, et le reste dans l'ordre d'ajout.
function splitDayEvents(dayEvents) {
  const primary = PRIMARY_ORDER.find(id => dayEvents.includes(id)) || null;
  return { primary, rest: dayEvents.filter(id => id !== primary) };
}

// Build one day cell. `forPrint=true` skips the overflow-dots cap so every
// event is visible on the printed page.
function buildDayCell(year, month, d, today, forPrint) {
  const dateStr   = formatDate(year, month, d);
  const dayDate   = new Date(year, month, d);
  const dow       = dayDate.getDay();
  const isWeekend = dow === 0 || dow === 6;
  const isToday   = isSameDay(dayDate, today);
  const isPast    = dayDate < new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const isSelected = batchSelected.has(dateStr);
  const dayEvents  = events[dateStr] || [];

  let cls = 'day-cell';
  if (isWeekend)  cls += ' weekend';
  if (isToday)    cls += ' today';
  if (isPast)     cls += ' past';
  if (isSelected) cls += ' selected';

  const { primary, rest } = splitDayEvents(dayEvents);

  const numberCls = 'day-number'
    + (primary ? ' ' + primary : '')
    + (isToday && !primary ? ' plain' : '');

  const eventsContainer = el('div', { class: 'day-events' });
  const shown = forPrint ? rest : rest.slice(0, MAX_TAGS_SCREEN);
  shown.forEach(evtId => {
    const type = getEventType(evtId);
    if (type) eventsContainer.append(buildEventTag(type, dateStr));
  });
  if (!forPrint && rest.length > MAX_TAGS_SCREEN) {
    eventsContainer.append(el('div', { class: 'day-more', text: `+${rest.length - MAX_TAGS_SCREEN}` }));
  }

  return el('div', {
    class: cls,
    dataset: { date: dateStr },
    onClick: () => handleDayClick(dateStr),
  },
    el('span', { class: numberCls, text: d }),
    eventsContainer,
  );
}

// ── Grid builder ──────────────────────────────────────────────────────────────
function renderCalendar(forPrint = false) {
  const grid = document.getElementById('calendarGrid');
  const today = new Date();
  const offset = leadingEmptyCells(currentYear, currentMonth);
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  const nodes = [];
  for (let i = 0; i < offset; i++) nodes.push(el('div', { class: 'day-cell empty' }));
  for (let d = 1; d <= daysInMonth; d++) {
    nodes.push(buildDayCell(currentYear, currentMonth, d, today, forPrint));
  }
  replaceChildren(grid, ...nodes);
}

// ── Navigation ───────────────────────────────────────────────────────────────
function changeMonth(dir) {
  currentMonth += dir;
  if (currentMonth > 11) { currentMonth = 0;  currentYear++; }
  if (currentMonth < 0)  { currentMonth = 11; currentYear--; }
  batchSelected.clear();
  render();
}

function goToday() {
  const now    = new Date();
  currentMonth = now.getMonth();
  currentYear  = now.getFullYear();
  batchSelected.clear();
  batchMode = false;
  render();
  showToast('Retour à aujourd\'hui');
}

function handleDayClick(dateStr) {
  if (batchMode) {
    if (batchSelected.has(dateStr)) batchSelected.delete(dateStr);
    else                            batchSelected.add(dateStr);
    render();
  } else {
    selectedDate = dateStr;
    openSheet(dateStr, false);
  }
}

// ── Print legend ─────────────────────────────────────────────────────────────
function buildPrintLegend() {
  // Les types archivés (ponctuels ou retirés de la palette) ne sont pas dans
  // getAllPersoTypes() : on les ajoute s'ils sont utilisés dans le mois affiché.
  const usedThisMonth = new Set();
  const prefix = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-`;
  for (const dateStr in events) {
    if (dateStr.startsWith(prefix)) events[dateStr].forEach(id => usedThisMonth.add(id));
  }
  const allTypes = [
    ...EVENT_TYPES,
    ...getAllPersoTypes(),
    ...archivedTypes.filter(t => usedThisMonth.has(t.id)),
  ];
  const items = allTypes.map(t => {
    const type = getEventType(t.id);
    if (!type) return null;
    const badge = el('div', { class: 'print-legend-color ' + (type.tagClass || 'tag-custom') });
    badge.append(type.icon ? icon(type.icon) : document.createTextNode(type.emoji));
    return el('div', { class: 'print-legend-item' }, badge, el('span', { text: type.label }));
  }).filter(Boolean);
  replaceChildren(document.getElementById('printLegend'), ...items);
}

// ── Print orchestration ───────────────────────────────────────────────────────
// We re-render the grid with `forPrint=true` (all events as tags) JUST before
// printing, then restore the screen view afterwards.
//
// `window.print()` is synchronous on desktop Chrome/Firefox but on iOS Safari
// it can return immediately. To stay robust on both, we subscribe ONCE to the
// `beforeprint` / `afterprint` events: the browser fires `beforeprint` right
// before painting the print preview (so we can swap the DOM) and `afterprint`
// when the dialog closes (so we can restore). Then we still call
// `window.print()` for browsers that don't trigger the events on their own.

let printListenersAttached = false;

function attachPrintListeners() {
  if (printListenersAttached) return;
  printListenersAttached = true;
  window.addEventListener('beforeprint', () => {
    document.documentElement.classList.add('printing');
    renderCalendar(true);
  });
  window.addEventListener('afterprint', () => {
    document.documentElement.classList.remove('printing');
    renderCalendar(false);
  });
}

function printCalendar() {
  attachPrintListeners();

  const now = new Date();
  document.getElementById('printDate').textContent =
    `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()} à ${now.getHours()}h${String(now.getMinutes()).padStart(2, '0')}`;
  buildPrintLegend();
  showToast('Préparation de l\'impression…');

  // Pre-emptively swap to the print render — safety net for browsers that
  // don't fire `beforeprint` (the listener will still no-op the class add).
  setTimeout(() => {
    document.documentElement.classList.add('printing');
    renderCalendar(true);
    window.print();
    // If `afterprint` doesn't fire (some mobile browsers), restore manually
    // shortly after — long enough for the dialog to have appeared.
    setTimeout(() => {
      document.documentElement.classList.remove('printing');
      renderCalendar(false);
    }, 1000);
  }, 300);
}
