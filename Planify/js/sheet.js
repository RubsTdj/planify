let selectedDate   = null;
let batchMode      = false;
let batchSelected  = new Set();
let manageCustomMode = false;

function openSheet(dateStr, isBatch) {
  manageCustomMode = false;
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
    if (dayEvents.length > 0) {
      currentSection.style.display = 'block';
      divider.style.display        = 'block';
      renderCurrentEvents(dateStr, dayEvents);
    } else {
      currentSection.style.display = 'none';
      divider.style.display        = 'none';
    }
  } else {
    document.getElementById('sheetTitle').textContent = `⚡ Appliquer à ${batchSelected.size} jour(s)`;
    document.getElementById('sheetDate').textContent  = 'Sélection multiple';
    currentSection.style.display = 'none';
    divider.style.display        = 'none';
  }

  buildChips(dateStr, isBatch);
  overlay.classList.add('visible');
  sheet.classList.add('visible');
}

function renderCurrentEvents(dateStr, dayEvents) {
  const list = document.getElementById('currentEventsList');
  list.innerHTML = '';
  dayEvents.forEach(evtId => {
    const type = getEventType(evtId);
    if (!type) return;
    const bgClass = 'bg-' + (type.cssClass || 'custom');
    let timeLabel = 'Toute la journée';
    if (type.duration === 'half') {
      timeLabel = type.halfDay === 'afternoon' ? 'Après-midi (13h→18h)' : 'Matin (8h→12h)';
    } else if (!type.allDay && type.startTime) {
      timeLabel = `${type.startTime} → ${type.endTime || ''}`;
    }

    const item = document.createElement('div');
    item.className = `current-event-item ${bgClass}`;
    item.innerHTML = `
      <div class="current-event-left">
        <span class="cev-emoji">${type.emoji}</span>
        <div>
          <div class="cev-label">${type.label}</div>
          <div class="cev-time">${timeLabel}</div>
        </div>
      </div>
      <button class="current-event-remove">✕</button>`;

    item.querySelector('.current-event-remove').addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      item.classList.add('removing');
      setTimeout(() => removeEventFromDay(dateStr, evtId), 300);
    });

    list.appendChild(item);
  });
}

function openBatchSheet() { openSheet(null, true); }

function closeAllSheets() {
  document.getElementById('overlay').classList.remove('visible');
  document.getElementById('eventSheet').classList.remove('visible');
  document.getElementById('customSheet').classList.remove('visible');
  manageCustomMode = false;
}

function closeSheet() {
  document.getElementById('overlay').classList.remove('visible');
  document.getElementById('eventSheet').classList.remove('visible');
  manageCustomMode = false;
}

function buildChips(dateStr, isBatch) {
  const dayEvents = !isBatch && dateStr ? (events[dateStr] || []) : [];

  const workContainer = document.getElementById('workChips');
  workContainer.innerHTML = '';
  EVENT_TYPES.filter(t => t.category === 'work').forEach(t => {
    workContainer.appendChild(createChip(t, dayEvents.includes(t.id), isBatch));
  });

  const offContainer = document.getElementById('offChips');
  offContainer.innerHTML = '';
  EVENT_TYPES.filter(t => t.category === 'off').forEach(t => {
    offContainer.appendChild(createChip(t, dayEvents.includes(t.id), isBatch));
  });

  const vacContainer = document.getElementById('vacationChips');
  vacContainer.innerHTML = '';
  EVENT_TYPES.filter(t => t.category === 'vacation').forEach(t => {
    vacContainer.appendChild(createChip(t, dayEvents.includes(t.id), isBatch));
  });

  const customContainer = document.getElementById('customChips');
  customContainer.innerHTML = '';

  getAllPersoTypes().forEach(t => {
    const full    = getEventType(t.id);
    if (!full) return;
    const isAdded = dayEvents.includes(t.id);

    const chip = document.createElement('div');
    chip.className = `event-chip custom${(!isBatch && isAdded) ? ' already-added' : ''}${manageCustomMode ? ' manage-mode' : ''}`;
    chip.innerHTML = `<span class="chip-emoji">${full.emoji}</span> ${full.label}<span class="chip-delete">✕</span>`;

    if (manageCustomMode) {
      chip.querySelector('.chip-delete').addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        deletePersoType(t.id, full.label);
      });
    } else if (!isAdded || isBatch) {
      chip.addEventListener('click', () => addEvent(full.id || t.id, isBatch));
    }

    customContainer.appendChild(chip);
  });

  const addNewChip = document.createElement('div');
  addNewChip.className = 'event-chip custom add-new';
  addNewChip.innerHTML = '<span class="chip-emoji">➕</span> Nouveau...';
  addNewChip.addEventListener('click', openCustomSheet);
  customContainer.appendChild(addNewChip);

  const manageBtn  = document.getElementById('manageCustomBtn');
  const allPerso   = getAllPersoTypes();
  manageBtn.style.display = allPerso.length > 0 ? 'inline-flex' : 'none';
  if (manageCustomMode) {
    manageBtn.classList.add('active');
    manageBtn.innerHTML = '✓ Terminé';
  } else {
    manageBtn.classList.remove('active');
    manageBtn.innerHTML = '🗑️ Gérer mes types';
  }
}

function createChip(type, isAlreadyAdded, isBatch) {
  const chip = document.createElement('div');
  chip.className = `event-chip ${type.cssClass}${(!isBatch && isAlreadyAdded) ? ' already-added' : ''}`;
  chip.innerHTML = `<span class="chip-emoji">${type.emoji}</span> ${type.label}`;
  if (!isAlreadyAdded || isBatch) {
    chip.addEventListener('click', () => addEvent(type.id, isBatch));
  }
  return chip;
}

function toggleManageCustom() {
  manageCustomMode = !manageCustomMode;
  const isBatch = batchMode && batchSelected.size > 0;
  buildChips(selectedDate, isBatch);
}

function deletePersoType(typeId, typeName) {
  if (!confirm(`Supprimer "${typeName}" ?\n\nCe type sera aussi retiré de tous les jours du calendrier.`)) return;

  for (const dateStr in events) {
    events[dateStr] = events[dateStr].filter(e => e !== typeId);
    if (events[dateStr].length === 0) delete events[dateStr];
    delete animatedTags[dateStr + '|' + typeId];
  }

  customTypes = customTypes.filter(t => t.id !== typeId);

  const presetIdx = DEFAULT_PRESETS.findIndex(t => t.id === typeId);
  if (presetIdx !== -1) {
    DEFAULT_PRESETS.splice(presetIdx, 1);
    persistRemovedPreset(typeId);
  }

  saveData();
  showToast(`🗑️ "${typeName}" supprimé`);
  render();

  const isBatch = batchMode && batchSelected.size > 0;
  buildChips(selectedDate, isBatch);

  if (selectedDate && !isBatch) {
    const dayEvents      = events[selectedDate] || [];
    const currentSection = document.getElementById('sheetCurrent');
    const divider        = document.getElementById('sheetDivider');
    if (dayEvents.length > 0) {
      renderCurrentEvents(selectedDate, dayEvents);
    } else {
      currentSection.style.display = 'none';
      divider.style.display        = 'none';
    }
  }

  if (getAllPersoTypes().length === 0) manageCustomMode = false;
}

function addEvent(typeId, isBatch) {
  if (manageCustomMode) return;
  if (isBatch) {
    batchSelected.forEach(dateStr => {
      if (!events[dateStr]) events[dateStr] = [];
      if (!events[dateStr].includes(typeId)) events[dateStr].push(typeId);
    });
    const type = getEventType(typeId);
    showToast(`${type.emoji} ${type.label} → ${batchSelected.size} jour(s)`);
    batchSelected.clear();
    batchMode = false;
  } else {
    if (!events[selectedDate]) events[selectedDate] = [];
    if (!events[selectedDate].includes(typeId)) {
      events[selectedDate].push(typeId);
      const type = getEventType(typeId);
      showToast(`${type.emoji} ${type.label} ajouté !`);
    }
  }
  saveData();
  closeSheet();
  render();
}

function removeEventFromDay(dateStr, evtId) {
  if (!events[dateStr]) return;
  events[dateStr] = events[dateStr].filter(e => e !== evtId);
  if (events[dateStr].length === 0) delete events[dateStr];
  delete animatedTags[dateStr + '|' + evtId];
  const type = getEventType(evtId);
  showToast(`${type ? type.emoji + ' ' + type.label : 'Event'} retiré`);
  saveData();
  render();

  const dayEvents      = events[dateStr] || [];
  const currentSection = document.getElementById('sheetCurrent');
  const divider        = document.getElementById('sheetDivider');
  if (dayEvents.length > 0) {
    renderCurrentEvents(dateStr, dayEvents);
  } else {
    currentSection.style.display = 'none';
    divider.style.display        = 'none';
  }
  buildChips(dateStr, false);
}

function toggleBatchMode() {
  batchMode = !batchMode;
  batchSelected.clear();
  if (batchMode) showToast('⚡ Tapez les jours puis "Appliquer"');
  render();
}

function updateBatchUI() {
  const counter   = document.getElementById('batchCounter');
  const bottomBar = document.getElementById('bottomBar');
  if (batchMode && batchSelected.size > 0) {
    counter.textContent = `⚡ ${batchSelected.size} jour(s) sélectionné(s)`;
    counter.classList.add('visible');
    bottomBar.innerHTML = `
      <button class="batch-btn active" onclick="toggleBatchMode()">✕ Annuler</button>
      <button class="batch-btn apply" onclick="openBatchSheet()">✓ Appliquer (${batchSelected.size})</button>`;
  } else if (batchMode) {
    counter.textContent = '⚡ Sélectionnez des jours';
    counter.classList.add('visible');
    bottomBar.innerHTML = `
      <button class="batch-btn active" onclick="toggleBatchMode()">✕ Annuler</button>
      <button class="batch-btn" disabled style="opacity:0.4;cursor:default;">✓ Appliquer</button>`;
  } else {
    counter.classList.remove('visible');
    bottomBar.innerHTML = `
      <button class="batch-btn" onclick="toggleBatchMode()">⚡ Multi-select</button>
      <button class="batch-btn today-btn" onclick="goToday()">📍 Aujourd'hui</button>`;
  }
}
