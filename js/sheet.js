// ─── Bottom sheets, chips, batch mode ─────────────────────────────────────────
// All UI for picking/adding/removing events on a day (or on a batch of days).
// User-controlled strings (label / emoji of custom types) are ALWAYS injected
// via textContent (through the `el()` helper) so a malicious type name cannot
// break out into HTML.

let selectedDate     = null;
let batchMode        = false;
let batchSelected    = new Set();
let manageCustomMode = false;

// ── Drag-to-close gesture ────────────────────────────────────────────────────
// Pulling down on the handle (or on the sheet when scrolled to top) closes it.
function initSwipeToClose(sheetEl, closeFn) {
  let startY = 0, currentY = 0, isDragging = false;
  const handle = sheetEl.querySelector('.sheet-handle');

  const isHandleTarget = target => handle && (handle === target || handle.contains(target));

  function onStart(e) {
    if (!isHandleTarget(e.target) && sheetEl.scrollTop > 0) return;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    isDragging = true;
    sheetEl.classList.add('dragging');
  }
  function onMove(e) {
    if (!isDragging) return;
    currentY = (e.touches ? e.touches[0].clientY : e.clientY) - startY;
    if (currentY < 0) currentY = 0;
    sheetEl.style.transform = `translateX(-50%) translateY(${currentY}px)`;
  }
  function onEnd() {
    if (!isDragging) return;
    isDragging = false;
    sheetEl.classList.remove('dragging');
    sheetEl.style.transform = '';
    if (currentY > 100) closeFn();
    currentY = 0;
  }

  sheetEl.addEventListener('touchstart', onStart, { passive: true });
  sheetEl.addEventListener('touchmove',  onMove,  { passive: true });
  sheetEl.addEventListener('touchend',   onEnd);
  sheetEl.addEventListener('mousedown',  onStart);
  window.addEventListener('mousemove',   onMove);
  window.addEventListener('mouseup',     onEnd);
}

// ── Open / close ─────────────────────────────────────────────────────────────
function openSheet(dateStr, isBatch) {
  manageCustomMode = false;
  // Sur le planning de quelqu'un d'autre : consultation, jamais d'édition.
  if (isReadOnly()) { openReadOnlySheet(dateStr); return; }

  const overlay        = document.getElementById('overlay');
  const sheet          = document.getElementById('eventSheet');
  const currentSection = document.getElementById('sheetCurrent');
  const divider        = document.getElementById('sheetDivider');

  if (!isBatch && dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    document.getElementById('sheetTitle').textContent = 'Gérer les événements';
    document.getElementById('sheetDate').textContent  =
      `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]}`;

    const dayEvents = events[dateStr] || [];
    const hasAny    = dayEvents.length > 0;
    currentSection.style.display = hasAny ? 'block' : 'none';
    divider.style.display        = hasAny ? 'block' : 'none';
    if (hasAny) renderCurrentEvents(dateStr, dayEvents);
  } else {
    document.getElementById('sheetTitle').textContent = `Appliquer à ${batchSelected.size} jour(s)`;
    document.getElementById('sheetDate').textContent  = 'Sélection multiple';
    currentSection.style.display = 'none';
    divider.style.display        = 'none';
  }

  showChipSections();
  buildChips(dateStr, isBatch);
  overlay.classList.add('visible');
  sheet.classList.add('visible');
}

function openBatchSheet() { openSheet(null, true); }

// Feuille de consultation : la liste du jour, sans retrait ni palette.
function openReadOnlySheet(dateStr) {
  if (!dateStr) return;
  const d         = new Date(dateStr + 'T00:00:00');
  const dayEvents = events[dateStr] || [];

  document.getElementById('sheetTitle').textContent = `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]}`;
  document.getElementById('sheetDate').textContent  = viewingShare ? `Planning de ${viewingShare.name}` : '';

  const section = document.getElementById('sheetCurrent');
  const divider = document.getElementById('sheetDivider');
  section.style.display = 'block';
  divider.style.display = 'none';

  const list = document.getElementById('currentEventsList');
  replaceChildren(list, ...(dayEvents.length
    ? dayEvents.map(id => {
        const type = getEventType(id);
        if (!type) return null;
        const badge = el('div', { class: `cev-icon ${type.cssClass || 'custom'}` });
        badge.append(typeBadgeContent(type));
        return el('div', { class: 'current-event-item' },
          el('div', { class: 'current-event-left' }, badge,
            el('div', {},
              el('div', { class: 'cev-label', text: type.label }),
              el('div', { class: 'cev-time',  text: timeLabelFor(type) }),
            ),
          ),
        );
      }).filter(Boolean)
    : [el('div', { class: 'share-empty', text: 'Rien de prévu ce jour-là.' })]));

  // Les sections d'ajout n'ont pas lieu d'être en lecture seule.
  ['workChips', 'offChips', 'vacationChips', 'customChips'].forEach(id => {
    const c = document.getElementById(id);
    if (c) c.closest('.sheet-section').style.display = 'none';
  });

  document.getElementById('overlay').classList.add('visible');
  document.getElementById('eventSheet').classList.add('visible');
}

// Les sections masquées par la lecture seule reviennent sur mon planning.
function showChipSections() {
  ['workChips', 'offChips', 'vacationChips', 'customChips'].forEach(id => {
    const c = document.getElementById(id);
    if (c) c.closest('.sheet-section').style.display = '';
  });
}

function closeAllSheets() {
  document.getElementById('overlay').classList.remove('visible');
  document.getElementById('eventSheet').classList.remove('visible');
  document.getElementById('customSheet').classList.remove('visible');
  ['subscribeSheet', 'shareSheet', 'planningSheet'].forEach(id => {
    const s = document.getElementById(id);
    if (s) s.classList.remove('visible');
  });
  manageCustomMode = false;
}

function closeSheet() {
  document.getElementById('overlay').classList.remove('visible');
  document.getElementById('eventSheet').classList.remove('visible');
  manageCustomMode = false;
}

// ── Current-events list (top of the sheet) ───────────────────────────────────
function timeLabelFor(type) {
  if (type.duration === 'half') {
    return type.halfDay === 'afternoon' ? 'Après-midi (13h→18h)' : 'Matin (8h→12h)';
  }
  if (!type.allDay && type.startTime) {
    return `${type.startTime} → ${type.endTime || ''}`;
  }
  return 'Toute la journée';
}

function buildCurrentEventItem(dateStr, evtId) {
  const type = getEventType(evtId);
  if (!type) return null;

  const removeBtn = el('button', { class: 'current-event-remove', attrs: { 'aria-label': 'Retirer' } },
    icon('close'));

  // Les shifts intégrés ont une icône dessinée ; les types perso gardent leur
  // emoji, c'est l'utilisatrice qui l'a choisi.
  const badge = el('div', { class: `cev-icon ${type.cssClass || 'custom'}` });
  badge.append(typeBadgeContent(type));

  const item = el('div', { class: 'current-event-item' },
    el('div', { class: 'current-event-left' },
      badge,
      el('div', {},
        el('div', { class: 'cev-label', text: type.label }),
        el('div', { class: 'cev-time',  text: timeLabelFor(type) }),
      ),
    ),
    removeBtn,
  );

  removeBtn.addEventListener('click', e => {
    e.stopPropagation();
    e.preventDefault();
    item.classList.add('removing');
    setTimeout(() => removeEventFromDay(dateStr, evtId), 300);
  });

  return item;
}

function renderCurrentEvents(dateStr, dayEvents) {
  const list = document.getElementById('currentEventsList');
  replaceChildren(list, ...dayEvents.map(id => buildCurrentEventItem(dateStr, id)).filter(Boolean));
}

// ── Chip grids (workplace / off / vacation / perso) ──────────────────────────
function chipForBuiltin(type, isAlreadyAdded, isBatch) {
  const chip = el('div', {
    class: `event-chip ${type.cssClass}${(!isBatch && isAlreadyAdded) ? ' already-added' : ''}`,
  },
    type.icon ? icon(type.icon) : null,
    type.label, // safe: passed as text node via el()
  );
  if (!isAlreadyAdded || isBatch) {
    chip.addEventListener('click', () => addEvent(type.id, isBatch));
  }
  return chip;
}

function chipForCustom(type, isAlreadyAdded, isBatch, dateStr) {
  const cls =
    'event-chip custom'
    + ((!isBatch && isAlreadyAdded) ? ' already-added' : '')
    + (manageCustomMode ? ' manage-mode' : '');

  const deleteBtn = el('span', { class: 'chip-delete' }, icon('close'));
  const chip = el('div', { class: cls },
    type.emoji ? el('span', { class: 'chip-emoji', text: type.emoji }) : null,
    type.label,
    deleteBtn,
  );

  if (manageCustomMode) {
    deleteBtn.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      showDeleteConfirm(chip, type.id, type.label, dateStr, isBatch);
    });
  } else if (!isAlreadyAdded || isBatch) {
    chip.addEventListener('click', () => addEvent(type.id, isBatch));
  }
  return chip;
}

function fillChipContainer(container, types, dayEvents, isBatch) {
  replaceChildren(
    container,
    ...types.map(t => chipForBuiltin(t, dayEvents.includes(t.id), isBatch)),
  );
}

function buildChips(dateStr, isBatch) {
  const dayEvents = !isBatch && dateStr ? (events[dateStr] || []) : [];

  fillChipContainer(document.getElementById('workChips'),
    EVENT_TYPES.filter(t => t.category === 'work'),     dayEvents, isBatch);
  fillChipContainer(document.getElementById('offChips'),
    EVENT_TYPES.filter(t => t.category === 'off'),      dayEvents, isBatch);
  fillChipContainer(document.getElementById('vacationChips'),
    EVENT_TYPES.filter(t => t.category === 'vacation'), dayEvents, isBatch);

  // Perso chips + the "Nouveau..." chip.
  const customContainer = document.getElementById('customChips');
  const customChips = getAllPersoTypes()
    .map(t => {
      const full = getEventType(t.id);
      if (!full) return null;
      return chipForCustom(full, dayEvents.includes(t.id), isBatch, dateStr);
    })
    .filter(Boolean);

  const addNewChip = el('div', { class: 'event-chip custom add-new', onClick: openCustomSheet },
    icon('plus'), 'Nouveau',
  );
  replaceChildren(customContainer, ...customChips, addNewChip);

  // Toggle the "Gérer mes types" button visibility / label.
  const manageBtn = document.getElementById('manageCustomBtn');
  const hasPerso  = getAllPersoTypes().length > 0;
  manageBtn.style.display = hasPerso ? 'inline-flex' : 'none';
  manageBtn.classList.toggle('active', manageCustomMode);
  replaceChildren(manageBtn,
    icon(manageCustomMode ? 'check' : 'trash'),
    document.createTextNode(manageCustomMode ? 'Terminé' : 'Gérer mes types'));
}

function createChip(type, isAlreadyAdded, isBatch) {
  // Retained for backward compatibility with any external callers.
  return chipForBuiltin(type, isAlreadyAdded, isBatch);
}

function toggleManageCustom() {
  manageCustomMode = !manageCustomMode;
  const isBatch = batchMode && batchSelected.size > 0;
  buildChips(selectedDate, isBatch);
}

// ── Delete-confirmation inline UI (replaces the chip content) ────────────────
function showDeleteConfirm(chip, typeId, typeName, dateStr, isBatch) {
  // Snapshot the original children so we can restore on cancel.
  const originalChildren = [...chip.childNodes];
  chip.style.animation = 'none';

  const yes = el('button', {
    class: 'confirm-yes',
    style: 'padding:5px 12px;border-radius:9px;border:none;background:#C0392F;color:white;font-weight:600;font-size:13px;cursor:pointer;margin-left:6px;font-family:inherit;',
    text: 'Oui',
  });
  const no = el('button', {
    class: 'confirm-no',
    style: 'padding:5px 12px;border-radius:9px;border:none;background:#E4E5E9;color:#16171C;font-weight:500;font-size:13px;cursor:pointer;margin-left:4px;font-family:inherit;',
    text: 'Non',
  });
  // "Retirer" et pas "Supprimer" : les jours déjà planifiés ne bougent pas.
  const prompt = el('span',
    { style: 'font-size:13px;font-weight:600;color:#C0392F;flex:1;', text: 'Retirer ?' });

  replaceChildren(chip, prompt, yes, no);

  yes.addEventListener('click', e => {
    e.stopPropagation();
    deletePersoType(typeId, typeName);
  });
  no.addEventListener('click', e => {
    e.stopPropagation();
    replaceChildren(chip, ...originalChildren);
    chip.style.animation = '';
    const newDel = chip.querySelector('.chip-delete');
    if (newDel) {
      newDel.addEventListener('click', e2 => {
        e2.stopPropagation();
        e2.preventDefault();
        showDeleteConfirm(chip, typeId, typeName, dateStr, isBatch);
      });
    }
  });
}

// ── Mutations (optimistic UI + persistence) ──────────────────────────────────

// Nombre de jours du planning qui utilisent encore ce type.
function countDaysUsingType(typeId) {
  let n = 0;
  for (const dateStr in events) {
    if (events[dateStr].includes(typeId)) n++;
  }
  return n;
}

// Retire un type perso de la palette. Les jours déjà planifiés le gardent :
// le type passe simplement en "archivé" (invisible dans les chips, toujours
// affiché dans le calendrier et exporté dans l'ICS). S'il n'est utilisé nulle
// part, on le supprime pour de bon.
async function deletePersoType(typeId, typeName) {
  if (isReadOnly()) return;
  const usedOn = countDaysUsingType(typeId);
  const def    = customTypes.find(t => t.id === typeId)
              || DEFAULT_PRESETS.find(t => t.id === typeId);

  customTypes = customTypes.filter(t => t.id !== typeId);
  const presetIdx = DEFAULT_PRESETS.findIndex(t => t.id === typeId);
  if (presetIdx !== -1) DEFAULT_PRESETS.splice(presetIdx, 1);
  if (usedOn > 0 && def) archivedTypes.push(def);

  showToast(usedOn > 0
    ? `« ${typeName} » retiré · ${usedOn} jour(s) conservé(s)`
    : `« ${typeName} » supprimé`);
  render();

  const isBatch = batchMode && batchSelected.size > 0;
  buildChips(selectedDate, isBatch);

  if (selectedDate && !isBatch) {
    const dayEvents = events[selectedDate] || [];
    const section   = document.getElementById('sheetCurrent');
    const divider   = document.getElementById('sheetDivider');
    if (dayEvents.length > 0) {
      renderCurrentEvents(selectedDate, dayEvents);
    } else {
      section.style.display = 'none';
      divider.style.display = 'none';
    }
  }

  if (getAllPersoTypes().length === 0) manageCustomMode = false;

  if (usedOn > 0) await archiveCustomType(typeId);
  else            await purgeCustomType(typeId);
}

async function addEvent(typeId, isBatch) {
  if (manageCustomMode || isReadOnly()) return;
  const type = getEventType(typeId);
  if (!type) return;

  if (isBatch) {
    const dates = [...batchSelected];
    dates.forEach(dateStr => {
      if (!events[dateStr]) events[dateStr] = [];
      if (!events[dateStr].includes(typeId)) events[dateStr].push(typeId);
    });
    showToast(`${type.label} → ${dates.length} jour(s)`);
    batchSelected.clear();
    batchMode = false;
    closeSheet();
    render();
    await saveEventBatch(dates, typeId);
    return;
  }

  if (!selectedDate) { closeSheet(); return; }
  if (!events[selectedDate]) events[selectedDate] = [];
  if (events[selectedDate].includes(typeId)) { closeSheet(); return; }

  events[selectedDate].push(typeId);
  showToast(`${type.label} ajouté`);
  closeSheet();
  render();
  await saveEventAdd(selectedDate, typeId);
}

async function removeEventFromDay(dateStr, evtId) {
  if (isReadOnly() || !events[dateStr]) return;
  events[dateStr] = events[dateStr].filter(e => e !== evtId);
  if (events[dateStr].length === 0) delete events[dateStr];
  delete animatedTags[dateStr + '|' + evtId];

  const type = getEventType(evtId);
  showToast(`${type ? type.label : 'Événement'} retiré`);
  render();

  const dayEvents = events[dateStr] || [];
  const section   = document.getElementById('sheetCurrent');
  const divider   = document.getElementById('sheetDivider');
  if (dayEvents.length > 0) {
    renderCurrentEvents(dateStr, dayEvents);
  } else {
    section.style.display = 'none';
    divider.style.display = 'none';
  }
  buildChips(dateStr, false);

  await saveEventRemove(dateStr, evtId);
  await purgeArchivedTypeIfUnused(evtId);
}

// Un type archivé n'existe que pour les jours qui le référencent (événement
// ponctuel ou type retiré de la palette). Quand le dernier jour disparaît,
// la ligne custom_types n'a plus de raison d'être.
async function purgeArchivedTypeIfUnused(typeId) {
  const idx = archivedTypes.findIndex(t => t.id === typeId);
  if (idx === -1) return;
  if (countDaysUsingType(typeId) > 0) return;
  archivedTypes.splice(idx, 1);
  await purgeCustomType(typeId);
}

// ── Batch mode toggles + bottom-bar state ────────────────────────────────────
function toggleBatchMode() {
  if (isReadOnly()) return;
  batchMode = !batchMode;
  batchSelected.clear();
  if (batchMode) showToast('Tapez les jours puis « Appliquer »');
  render();
}

function updateBatchUI() {
  const counter   = document.getElementById('batchCounter');
  const bottomBar = document.getElementById('bottomBar');

  if (batchMode && batchSelected.size > 0) {
    counter.textContent = `${batchSelected.size} jour(s) sélectionné(s)`;
    counter.classList.add('visible');
    replaceChildren(bottomBar,
      el('button', { class: 'batch-btn active', text: 'Annuler', onClick: toggleBatchMode }),
      el('button', { class: 'batch-btn apply',  text: `Appliquer (${batchSelected.size})`, onClick: openBatchSheet }),
    );
  } else if (batchMode) {
    counter.textContent = 'Sélectionnez des jours';
    counter.classList.add('visible');
    replaceChildren(bottomBar,
      el('button', { class: 'batch-btn active', text: 'Annuler', onClick: toggleBatchMode }),
      el('button', { class: 'batch-btn', text: 'Appliquer',
                     style: 'flex:1;opacity:0.35;cursor:default;',
                     attrs: { disabled: 'disabled' } }),
    );
  } else if (isReadOnly()) {
    counter.classList.remove('visible');
    replaceChildren(bottomBar,
      el('div', { class: 'readonly-bar' },
        icon('eye'),
        el('span', {}, 'Lecture seule · ', el('b', { text: viewingShare.name })),
      ),
      el('button', { class: 'batch-btn', onClick: () => switchToPlanning(null) }, 'Revenir'),
    );
  } else {
    counter.classList.remove('visible');
    const multi = el('button', { class: 'batch-btn multiselect-btn', onClick: toggleBatchMode },
      icon('select'), 'Sélection multiple');
    replaceChildren(bottomBar, multi);
  }
}
