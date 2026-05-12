// ─── Custom event creation modal ──────────────────────────────────────────────
// Bottom sheet for creating a user-defined event type (custom_*). Stores the
// in-progress selection in module-local state, then commits via storage on
// save.

let customTypes      = [];
let selectedEmoji    = '';
let selectedDuration = 'allday';
let selectedHalfDay  = 'morning';

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

// ── Open / close ─────────────────────────────────────────────────────────────
function openCustomSheet() {
  closeSheet();
  selectedDuration = 'allday';
  selectedHalfDay  = 'morning';
  document.getElementById('customName').value  = '';
  document.getElementById('customStart').value = '';
  document.getElementById('customEnd').value   = '';
  resetDurationUI();

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

async function saveCustomEvent() {
  const rawName = document.getElementById('customName').value.trim();
  if (!rawName) { showToast('⚠️ Donne un nom'); return; }

  const newType = buildCustomTypeFromForm(rawName);

  // Optimistic update — re-open the event sheet with the new type already there.
  customTypes.push(newType);
  closeCustomSheet();
  showToast(`${newType.emoji} ${newType.label} créé !`);
  if (selectedDate) setTimeout(() => openSheet(selectedDate, false), 400);

  await saveCustomType(newType);
}
