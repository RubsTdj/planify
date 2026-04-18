let currentMonth, currentYear;
let events = {};
let animatedTags = {};

// Colour used for dot indicators per event type
const DOT_COLORS = {
  matin:    '#fbbf24',
  soir:     '#a78bfa',
  nuit:     '#818cf8',
  repos:    '#34d399',
  vacances: '#22d3ee',
  custom:   '#9ca3af',
};

function getDotColor(typeId) {
  if (DOT_COLORS[typeId]) return DOT_COLORS[typeId];
  return DOT_COLORS.custom;
}

function formatDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function render() {
  // Split month / year for styled title
  const monthEl = document.getElementById('monthLabel');
  const yearEl  = document.getElementById('yearLabel');
  if (monthEl) monthEl.textContent = MONTHS_FR[currentMonth];
  if (yearEl)  yearEl.textContent  = currentYear;

  renderCalendar();
  renderEmptyState();
  updateBatchUI();
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';
  const firstDay   = new Date(currentYear, currentMonth, 1);
  let startDay     = firstDay.getDay() - 1;
  if (startDay < 0) startDay = 6;
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const today = new Date();

  for (let i = 0; i < startDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'day-cell empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr   = formatDate(currentYear, currentMonth, d);
    const dow       = new Date(currentYear, currentMonth, d).getDay(); // 0=Sun,6=Sat
    const isWeekend = dow === 0 || dow === 6;
    const isToday   = today.getFullYear() === currentYear && today.getMonth() === currentMonth && today.getDate() === d;
    const isPast    = new Date(currentYear, currentMonth, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const isSelected = batchSelected.has(dateStr);
    const dayEvents  = events[dateStr] || [];

    let classes = 'day-cell';
    if (isWeekend)  classes += ' weekend';
    if (isToday)    classes += ' today';
    if (isPast)     classes += ' past';
    if (isSelected) classes += ' selected';

    // Show up to 2 tags, then dots for the rest
    const maxTags = 2;
    let eventsHTML = '';

    dayEvents.slice(0, maxTags).forEach((evtId, i) => {
      const type = getEventType(evtId);
      if (!type) return;
      const tagClass = type.tagClass || 'tag-custom';
      const animKey  = dateStr + '|' + evtId;
      let animClass  = '';
      if (!animatedTags[animKey]) {
        animClass = 'animate-in';
        animatedTags[animKey] = true;
      }
      const delayStyle = animClass ? `animation-delay:${i * 0.08}s` : '';
      eventsHTML += `<div class="event-tag ${tagClass} ${animClass}" style="${delayStyle}">
        <span class="tag-emoji">${type.emoji}</span>
        <span class="tag-label">${type.label}</span>
      </div>`;
    });

    // Dots for overflow events
    if (dayEvents.length > maxTags) {
      const overflowDots = dayEvents.slice(maxTags).map(evtId => {
        const color = getDotColor(evtId);
        return `<span class="day-dot" style="background:${color}"></span>`;
      }).join('');
      eventsHTML += `<div class="day-dots">${overflowDots}</div>`;
    }

    const cell = document.createElement('div');
    cell.className    = classes;
    cell.dataset.date = dateStr;
    cell.innerHTML    = `<span class="day-number">${d}</span><div class="day-events">${eventsHTML}</div>`;
    cell.addEventListener('click', () => handleDayClick(dateStr));
    grid.appendChild(cell);
  }
}

function renderEmptyState() {
  const existing = document.getElementById('emptyState');
  if (existing) existing.remove();
}

function changeMonth(dir) {
  currentMonth += dir;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
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
    else batchSelected.add(dateStr);
    render();
  } else {
    selectedDate = dateStr;
    openSheet(dateStr, false);
  }
}

function buildPrintLegend() {
  const allTypes = [...EVENT_TYPES, ...getAllPersoTypes()];
  document.getElementById('printLegend').innerHTML = allTypes.map(t => {
    const type = getEventType(t.id);
    if (!type) return '';
    const tagClass = type.tagClass || 'tag-custom';
    return `<div class="print-legend-item"><div class="print-legend-color ${tagClass}">${type.emoji}</div><span>${type.label}</span></div>`;
  }).join('');
}

function printCalendar() {
  const now = new Date();
  document.getElementById('printDate').textContent =
    `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()} à ${now.getHours()}h${String(now.getMinutes()).padStart(2, '0')}`;
  buildPrintLegend();
  showToast('🖨️ Préparation...');
  setTimeout(() => window.print(), 300);
}
