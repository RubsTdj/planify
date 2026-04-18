// ── Auth state ─────────────────────────────────────────────────────────────
let currentUser = null;

// ── Screen management ──────────────────────────────────────────────────────
function showScreen(id) {
  document.getElementById('screenAuth').style.display = id === 'screenAuth' ? 'flex' : 'none';
  document.getElementById('screenApp').style.display  = id === 'screenApp'  ? 'flex' : 'none';
}

function showAuthStep(stepId) {
  ['stepEmail', 'stepOtpCode', 'stepExpired'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === stepId ? 'block' : 'none';
  });
}

// ── Entry point ────────────────────────────────────────────────────────────
async function initAuth() {
  initOtpInputs();

  try {
    const { data: { session } } = await sb.auth.getSession();

    if (session) {
      currentUser = session.user;
      await launchApp();
    } else {
      const { data } = await sb.auth.refreshSession();
      if (data?.session) {
        currentUser = data.session.user;
        await launchApp();
      } else {
        showScreen('screenAuth');
        showAuthStep('stepEmail');
      }
    }
  } catch (err) {
    console.error('initAuth error:', err);
    // If anything fails, always show auth screen — never leave loader stuck
    hideLoader();
    showScreen('screenAuth');
    showAuthStep('stepEmail');
  }
}

// ── Step 1: send OTP code ──────────────────────────────────────────────────
async function sendOtpCode() {
  const email = document.getElementById('authEmail').value.trim();
  if (!email || !email.includes('@')) { showAuthError('Entre une adresse email valide'); return; }

  setAuthLoading(true);
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  setAuthLoading(false);

  if (error) { showAuthError(error.message); return; }

  document.getElementById('otpEmailDisplay').textContent = email;
  showAuthStep('stepOtpCode');
  setTimeout(() => document.querySelector('.otp-digit')?.focus(), 150);
}

// ── Step 2: verify OTP code ────────────────────────────────────────────────
async function verifyOtpCode() {
  const digits = [...document.querySelectorAll('.otp-digit')].map(i => i.value).join('');
  if (digits.length < 6) return;

  const email = document.getElementById('authEmail').value.trim();
  setOtpLoading(true);
  const { data, error } = await sb.auth.verifyOtp({ email, token: digits, type: 'email' });
  setOtpLoading(false);

  if (error) { shakeOtp(); return; }

  currentUser = data.user;
  await launchApp();
}

// ── Step: expired session — resend OTP ────────────────────────────────────
async function sendExpiredOtp() {
  const email = document.getElementById('expiredEmail').value.trim();
  if (!email || !email.includes('@')) { showAuthError('Entre une adresse email valide'); return; }

  const btn = document.getElementById('expiredBtn');
  btn.disabled = true; btn.textContent = 'Envoi…';
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  btn.disabled = false; btn.textContent = 'Envoyer le code';
  if (error) { showAuthError(error.message); return; }

  // Reuse the OTP input step
  document.getElementById('authEmail').value = email;
  document.getElementById('otpEmailDisplay').textContent = email;
  showAuthStep('stepOtpCode');
  setTimeout(() => document.querySelector('.otp-digit')?.focus(), 150);
}

// ── OTP input UX ───────────────────────────────────────────────────────────
function initOtpInputs() {
  const inputs = [...document.querySelectorAll('.otp-digit')];
  inputs.forEach((input, idx) => {
    input.addEventListener('input', e => {
      const val = e.target.value.replace(/\D/g, '');
      e.target.value = val.slice(-1);
      if (val && idx < inputs.length - 1) inputs[idx + 1].focus();
      if (inputs.every(i => i.value)) verifyOtpCode();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !input.value && idx > 0) inputs[idx - 1].focus();
    });
    input.addEventListener('paste', e => {
      const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
      if (pasted.length === 6) {
        inputs.forEach((inp, i) => { inp.value = pasted[i] || ''; });
        inputs[5].focus();
        setTimeout(verifyOtpCode, 80);
      }
      e.preventDefault();
    });
  });
}

function shakeOtp() {
  const row = document.querySelector('.otp-row');
  if (!row) return;
  row.classList.add('shake');
  setTimeout(() => { row.classList.remove('shake'); clearOtp(); }, 500);
}

function clearOtp() {
  document.querySelectorAll('.otp-digit').forEach(i => { i.value = ''; });
  document.querySelector('.otp-digit')?.focus();
}

// ── Launch app ─────────────────────────────────────────────────────────────
async function launchApp() {
  try {
    setUserAvatar();
    showScreen('screenApp');
    showLoader();
    buildEmojiPicker();
    const [_] = await Promise.all([
      loadData(),
      new Promise(r => setTimeout(r, 2500)),
    ]);
    hideLoader();
    render();
    document.getElementById('overlay').addEventListener('click', closeAllSheets);
    document.getElementById('manageCustomBtn').addEventListener('click', toggleManageCustom);
    initSwipeToClose(document.getElementById('eventSheet'),  closeSheet);
    initSwipeToClose(document.getElementById('customSheet'), closeCustomSheet);
  } catch (err) {
    console.error('launchApp error:', err);
    hideLoader();
    render();
  }
}

// ── User menu ──────────────────────────────────────────────────────────────
function setUserAvatar() {
  const email  = currentUser?.email || '';
  const letter = email.charAt(0).toUpperCase();
  const avatar    = document.getElementById('userAvatar');
  const menuEmail = document.getElementById('userMenuEmail');
  if (avatar)    avatar.textContent    = letter;
  if (menuEmail) menuEmail.textContent = email;
}

function toggleUserMenu() {
  const menu   = document.getElementById('userMenu');
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) setTimeout(() => document.addEventListener('click', closeUserMenu, { once: true }), 10);
}

function closeUserMenu() {
  const menu = document.getElementById('userMenu');
  if (menu) menu.style.display = 'none';
}

function confirmSignOut() {
  closeUserMenu();
  const menu = document.getElementById('userMenu');
  menu.style.display = 'block';
  menu.innerHTML = `
    <p class="user-menu-confirm">Se déconnecter ?</p>
    <div class="user-menu-confirm-row">
      <button class="user-menu-item danger" onclick="doSignOut()">Oui, déconnexion</button>
      <button class="user-menu-item" onclick="closeUserMenu()">Annuler</button>
    </div>`;
}

async function doSignOut() {
  closeUserMenu();
  await sb.auth.signOut();
  currentUser = null;
  events = {};
  customTypes = [];
  DEFAULT_PRESETS.length = 0;
  showScreen('screenAuth');
  showAuthStep('stepEmail');
}

async function signOut() { await doSignOut(); }

// ── Helpers ────────────────────────────────────────────────────────────────
function showAuthError(msg) {
  const el = document.getElementById('authError');
  if (!el) return;
  el.textContent    = msg;
  el.style.display  = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3500);
}

function setAuthLoading(on) {
  const btn = document.getElementById('authSubmitBtn');
  if (!btn) return;
  btn.disabled    = on;
  btn.textContent = on ? 'Envoi…' : 'Continuer';
}

function setOtpLoading(on) {
  document.querySelectorAll('.otp-digit').forEach(i => { i.disabled = on; });
}
