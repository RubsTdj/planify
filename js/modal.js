let customTypes     = [];
let selectedEmoji   = '';
let selectedDuration = 'allday';
let selectedHalfDay  = 'morning';

function buildEmojiPicker() {
  const picker = document.getElementById('emojiPicker');
  picker.innerHTML = '';
  EMOJI_OPTIONS.forEach((e, i) => {
    const opt = document.createElement('div');
    opt.className = `emoji-option${i === 0 ? ' selected' : ''}`;
    opt.textContent = e;
    opt.addEventListener('click', function () { selectEmoji(e, this); });
    picker.appendChild(opt);
  });
  selectedEmoji = EMOJI_OPTIONS[0];
}

function selectEmoji(emoji, el) {
  selectedEmoji = emoji;
  document.querySelectorAll('.emoji-option').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
}

function selectDuration(dur, el) {
  selectedDuration = dur;
  document.querySelectorAll('.duration-selector .duration-option').forEach(o => o.classList.remove('active'));
  el.classList.add('active');
  const timeRow = document.getElementById('timeRowContainer');
  const halfSel = document.getElementById('halfDaySelector');
  if (dur === 'custom')     { timeRow.classList.add('visible'); halfSel.style.display = 'none'; }
  else if (dur === 'half')  { timeRow.classList.remove('visible'); halfSel.style.display = 'flex'; }
  else                      { timeRow.classList.remove('visible'); halfSel.style.display = 'none'; }
}

function selectHalfDay(half, el) {
  selectedHalfDay = half;
  document.querySelectorAll('.half-day-option').forEach(o => o.classList.remove('active'));
  el.classList.add('active');
}

function resetDurationUI() {
  document.querySelectorAll('.duration-selector .duration-option').forEach(o => o.classList.remove('active'));
  document.querySelector('[data-dur="allday"]').classList.add('active');
  document.querySelectorAll('.half-day-option').forEach(o => o.classList.remove('active'));
  document.querySelector('[data-half="morning"]').classList.add('active');
  document.getElementById('timeRowContainer').classList.remove('visible');
  document.getElementById('halfDaySelector').style.display = 'none';
}

function openCustomSheet() {
  closeSheet();
  selectedDuration = 'allday';
  selectedHalfDay  = 'morning';
  document.getElementById('customName').value  = '';
  document.getElementById('customStart').value = '';
  document.getElementById('customEnd').value   = '';
  resetDurationUI();

  setTimeout(() => {
    document.getElementById('overlay').classList.add('visible');
    document.getElementById('customSheet').classList.add('visible');
  }, 350);
}

function closeCustomSheet() {
  document.getElementById('overlay').classList.remove('visible');
  document.getElementById('customSheet').classList.remove('visible');
}

function saveCustomEvent() {
  const name = document.getElementById('customName').value.trim();
  if (!name) { showToast('⚠️ Donne un nom'); return; }

  const newType = {
    id:       'custom_' + Date.now(),
    label:    name,
    emoji:    selectedEmoji,
    duration: selectedDuration,
    allDay:   selectedDuration === 'allday',
  };

  if (selectedDuration === 'half') {
    newType.allDay  = false;
    newType.halfDay = selectedHalfDay;
    if (selectedHalfDay === 'morning') { newType.startTime = '08:00'; newType.endTime = '12:00'; }
    else                               { newType.startTime = '13:00'; newType.endTime = '18:00'; }
  } else if (selectedDuration === 'custom') {
    newType.allDay     = false;
    newType.startTime  = document.getElementById('customStart').value || null;
    newType.endTime    = document.getElementById('customEnd').value   || null;
    if (!newType.startTime) { newType.allDay = true; newType.duration = 'allday'; }
  }

  customTypes.push(newType);
  saveData();
  closeCustomSheet();
  showToast(`${newType.emoji} ${newType.label} créé !`);
  if (selectedDate) setTimeout(() => openSheet(selectedDate, false), 400);
}
