// ─── Custom event creation modal ──────────────────────────────────────────────
// Bottom sheet for creating a user-defined event type (custom_*). Stores the
// in-progress selection in module-local state, then commits via storage on
// save.

let customTypes      = [];
let selectedEmoji    = '';
let selectedDuration = 'allday';
let selectedHalfDay  = 'morning';
// Jour(s) sur le(s)quel(s) l'événement sera posé, figé à l'ouverture du sheet.
// Sans cible, l'événement ne peut être que réutilisable (sinon il serait
// invisible : ni chip dans la palette, ni jour dans le planning).
let pendingTarget    = null;

// ── Emoji picker ─────────────────────────────────────────────────────────────
function buildEmojiPicker() {
  const picker = document.getElementById('emojiPicker');
  const options = EMOJI_OPTIONS.map((emoji, i) => {
    const opt = el('div', {
      class: `emoji-option${i === 0 ? ' selected' : ''}`,
      text:  emoji,
    });
    opt.addEventListener('click', () => selectEmoji(emoji, opt));
    return opt;
  });
  replaceChildren(picker, ...options);
  selectedEmoji = EMOJI_OPTIONS[0];
}

function selectEmoji(emoji, target) {
  selectedEmoji = emoji;
  document.querySelectorAll('.emoji-option').forEach(e => e.classList.remove('selected'));
  target.classList.add('selected');
}

// ── Duration selection (allday / half-day / custom range) ────────────────────
function selectDuration(dur, target) {
  selectedDuration = dur;
  document.querySelectorAll('.duration-selector .duration-option').forEach(o => o.classList.remove('active'));
  target.classList.add('active');

  const timeRow = document.getElementById('timeRowContainer');
  const halfSel = document.getElementById('halfDaySelector');

  if (dur === 'custom') {
    timeRow.classList.add('visible');
    halfSel.style.display = 'none';
  } else if (dur === 'half') {
    timeRow.classList.remove('visible');
    halfSel.style.display = 'flex';
  } else {
    timeRow.classList.remove('visible');
    halfSel.style.display = 'none';
  }
}

function selectHalfDay(half, target) {
  selectedHalfDay = half;
  document.querySelectorAll('.half-day-option').forEach(o => o.classList.remove('active'));
  target.classList.add('active');
}

function resetDurationUI() {
  document.querySelectorAll('.duration-selector .duration-option').forEach(o => o.classList.remove('active'));
  document.querySelector('[data-dur="allday"]').classList.add('active');
  document.querySelectorAll('.half-day-option').forEach(o => o.classList.remove('active'));
  document.querySelector('[data-half="morning"]').classList.add('active');
  document.getElementById('timeRowContainer').classList.remove('visible');
  document.getElementById('halfDaySelector').style.display = 'none';
}

// Résume la cible du sheet ("Ponctuel → sur quel(s) jour(s) ?").
function describeTarget(target) {
  if (!target) return '';
  if (target.dates.length > 1) return `${target.dates.length} jours sélectionnés`;
  const d = new Date(target.dates[0] + 'T00:00:00');
  return `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]}`;
}

// ── Open / close ─────────────────────────────────────────────────────────────
function openCustomSheet() {
  // La cible est figée MAINTENANT : closeSheet() ne touche pas à selectedDate
  // ni à batchSelected, mais l'utilisateur ne doit pas pouvoir la faire bouger
  // pendant qu'il remplit le formulaire.
  const isBatch = batchMode && batchSelected.size > 0;
  if (isBatch)                pendingTarget = { dates: [...batchSelected], isBatch: true };
  else if (selectedDate)      pendingTarget = { dates: [selectedDate],     isBatch: false };
  else                        pendingTarget = null;

  closeSheet();
  selectedDuration = 'allday';
  selectedHalfDay  = 'morning';
  // Décoché = ponctuel : le cas courant, et rien ne s'accumule dans la palette.
  document.getElementById('customKeep').checked = false;
  document.getElementById('customName').value  = '';
  document.getElementById('customStart').value = '';
  document.getElementById('customEnd').value   = '';
  resetDurationUI();

  // Sans cible, l'option n'a pas de sens : on la masque (keep forcé au save).
  const scopeRow = document.getElementById('scopeGroup');
  const subtitle = document.getElementById('customTargetLabel');
  scopeRow.style.display = pendingTarget ? 'flex'  : 'none';
  subtitle.style.display = pendingTarget ? 'block' : 'none';
  subtitle.textContent   = pendingTarget ? describeTarget(pendingTarget) : '';

  // Wait for the previous sheet's close animation before re-opening overlay.
  setTimeout(() => {
    document.getElementById('overlay').classList.add('visible');
    document.getElementById('customSheet').classList.add('visible');
  }, 350);
}

function closeCustomSheet() {
  document.getElementById('overlay').classList.remove('visible');
  document.getElementById('customSheet').classList.remove('visible');
}

// ── Build a new custom type from current form state ──────────────────────────
function buildCustomTypeFromForm(name) {
  // Cap label length to avoid pathological inputs.
  const safeName = name.slice(0, 60);
  const newType = {
    id:       'custom_' + Date.now(),
    label:    safeName,
    emoji:    selectedEmoji,
    duration: selectedDuration,
    allDay:   selectedDuration === 'allday',
  };

  if (selectedDuration === 'half') {
    newType.allDay    = false;
    newType.halfDay   = selectedHalfDay;
    newType.startTime = selectedHalfDay === 'morning' ? '08:00' : '13:00';
    newType.endTime   = selectedHalfDay === 'morning' ? '12:00' : '18:00';
  } else if (selectedDuration === 'custom') {
    newType.allDay    = false;
    newType.startTime = document.getElementById('customStart').value || null;
    newType.endTime   = document.getElementById('customEnd').value   || null;
    if (!newType.startTime) {
      // No start time → fall back to all-day.
      newType.allDay   = true;
      newType.duration = 'allday';
    }
  }
  return newType;
}

// Pose le nouveau type sur le(s) jour(s) ciblé(s) (optimiste + persistance).
async function applyTypeToTarget(type, target) {
  const dates = target.dates;
  for (const dateStr of dates) {
    if (!events[dateStr]) events[dateStr] = [];
    if (!events[dateStr].includes(type.id)) events[dateStr].push(type.id);
  }
  if (target.isBatch) {
    batchSelected.clear();
    batchMode = false;
  }
  render();

  if (dates.length === 1) await saveEventAdd(dates[0], type.id);
  else                    await saveEventBatch(dates, type.id);
}

async function saveCustomEvent() {
  const rawName = document.getElementById('customName').value.trim();
  if (!rawName) { showToast('⚠️ Donne un nom'); return; }

  const newType = buildCustomTypeFromForm(rawName);
  const target  = pendingTarget;
  const keep    = !target || document.getElementById('customKeep').checked;

  // Optimistic update. Un événement ponctuel va direct dans archivedTypes :
  // il reste affichable partout mais n'encombre pas la palette de chips.
  if (keep) customTypes.push(newType);
  else      archivedTypes.push(newType);

  pendingTarget = null;
  closeCustomSheet();

  if (target) {
    showToast(`${newType.emoji} ${newType.label} → ${describeTarget(target)}`);
  } else {
    showToast(`${newType.emoji} ${newType.label} créé !`);
  }

  await saveCustomType(newType, !keep);
  if (target) await applyTypeToTarget(newType, target);
}
