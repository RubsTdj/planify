// ─── Calendar rendering ───────────────────────────────────────────────────────
// Renders the month grid, handles navigation and day-click delegation.
// All DOM construction goes through the safe `el()` helper (see utils.js) so
// user-provided strings (custom-type labels, emojis) cannot inject HTML.

let currentMonth, currentYear;
let events        = {};
let animatedTags  = {};

// Maximum number of full tags rendered per day cell in screen view.
// On print we render ALL events as compact tags (see renderCalendar `forPrint`).
const MAX_TAGS_SCREEN = 2;

// Dot indicator colours used when a day overflows past MAX_TAGS_SCREEN.
const DOT_COLORS = {
  matin:    '#fbbf24',
  soir:     '#a78bfa',
  nuit:     '#818cf8',
  repos:    '#34d399',
  vacances: '#22d3ee',
  custom:   '#9ca3af',
};

function getDotColor(typeId) {
  return DOT_COLORS[typeId] || DOT_COLORS.custom;
}

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

  renderCalendar();
  updateBatchUI();
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

// Build a single event tag node. Safe against XSS — label/emoji go through
// textContent via el(), never innerHTML.
function buildEventTag(type, dateStr, index) {
  const animKey  = dateStr + '|' + type.id;
  const animate  = !animatedTags[animKey];
  if (animate) animatedTags[animKey] = true;

  const classes = `event-tag ${type.tagClass || 'tag-custom'}${animate ? ' animate-in' : ''}`;
  return el('div', {
    class: classes,
    style: animate ? `animation-delay:${index * 0.08}s` : '',
  },
    el('span', { class: 'tag-emoji', text: type.emoji }),
    el('span', { class: 'tag-label', text: type.label }),
  );
}

function buildOverflowDots(dayEvents, sliceFrom) {
  const dots = dayEvents.slice(sliceFrom).map(evtId =>
    el('span', { class: 'day-dot', style: `background:${getDotColor(evtId)}` })
  );
  return el('div', { class: 'day-dots' }, ...dots);
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

  const eventsContainer = el('div', { class: 'day-events' });

  // On print: render every event as a compact tag (no 2-tag cap, no dots).
  const tagLimit = forPrint ? dayEvents.length : MAX_TAGS_SCREEN;
  dayEvents.slice(0, tagLimit).forEach((evtId, i) => {
    const type = getEventType(evtId);
    if (type) eventsContainer.append(buildEventTag(type, dateStr, i));
  });
  if (!forPrint && dayEvents.length > MAX_TAGS_SCREEN) {
    eventsContainer.append(buildOverflowDots(dayEvents, MAX_TAGS_SCREEN));
  }

  const cell = el('div', {
    class: cls,
    dataset: { date: dateStr },
    onClick: () => handleDayClick(dateStr),
  },
    el('span', { class: 'day-number', text: d }),
    eventsContainer,
  );
  return cell;
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
  showToast('📍 Retour à aujourd\'hui');
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
    return el('div', { class: 'print-legend-item' },
      el('div', { class: 'print-legend-color ' + (type.tagClass || 'tag-custom'), text: type.emoji }),
      el('span', { text: type.label }),
    );
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
  showToast('🖨️ Préparation...');

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
