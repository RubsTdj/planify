// ─── Authentication (Supabase magic-link OTP) ─────────────────────────────────
// Two-step flow:
//   1) User enters their email → `signInWithOtp` sends a 6-digit code.
//   2) User pastes/types the code → `verifyOtp` issues a session.
// All UI strings come from the user but are inserted via textContent — no HTML
// injection surface remains in this file.

let currentUser = null;

// ── Screen / step management ─────────────────────────────────────────────────
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

// ── Entry point — called from app.js on DOMContentLoaded ─────────────────────
async function initAuth() {
  initOtpInputs();

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      currentUser = session.user;
      await launchApp();
      return;
    }
    // No active session — try refreshing (e.g. cookie still valid).
    const { data } = await sb.auth.refreshSession();
    if (data?.session) {
      currentUser = data.session.user;
      await launchApp();
      return;
    }
    showScreen('screenAuth');
    showAuthStep('stepEmail');
  } catch (err) {
    console.error('initAuth error:', err);
    // Never leave the loader stuck — bail out to the auth screen.
    hideLoader();
    showScreen('screenAuth');
    showAuthStep('stepEmail');
  }
}

// ── Step 1: send OTP code ────────────────────────────────────────────────────
async function sendOtpCode() {
  const email = document.getElementById('authEmail').value.trim();
  if (!isValidEmail(email)) { showAuthError('Entre une adresse email valide'); return; }

  setAuthLoading(true);
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  setAuthLoading(false);

  if (error) { showAuthError(error.message); return; }

  document.getElementById('otpEmailDisplay').textContent = email;
  showAuthStep('stepOtpCode');
  setTimeout(() => document.querySelector('.otp-digit')?.focus(), 150);
}

// ── Step 2: verify OTP code ──────────────────────────────────────────────────
async function verifyOtpCode() {
  const digits = [...document.querySelectorAll('.otp-digit')].map(i => i.value).join('');
  if (!/^\d{6}$/.test(digits)) return;

  const email = document.getElementById('authEmail').value.trim();
  setOtpLoading(true);
  const { data, error } = await sb.auth.verifyOtp({ email, token: digits, type: 'email' });
  setOtpLoading(false);

  if (error) { shakeOtp(); return; }

  currentUser = data.user;
  await launchApp();
}

// ── Step 3: expired session — resend OTP ─────────────────────────────────────
async function sendExpiredOtp() {
  const email = document.getElementById('expiredEmail').value.trim();
  if (!isValidEmail(email)) { showAuthError('Entre une adresse email valide'); return; }

  const btn = document.getElementById('expiredBtn');
  btn.disabled = true; btn.textContent = 'Envoi…';
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  btn.disabled = false; btn.textContent = 'Envoyer le code';
  if (error) { showAuthError(error.message); return; }

  document.getElementById('authEmail').value = email;
  document.getElementById('otpEmailDisplay').textContent = email;
  showAuthStep('stepOtpCode');
  setTimeout(() => document.querySelector('.otp-digit')?.focus(), 150);
}

// ── OTP digit-input UX ───────────────────────────────────────────────────────
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
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text')
        .replace(/\D/g, '').slice(0, 6);
      if (pasted.length === 6) {
        inputs.forEach((inp, i) => { inp.value = pasted[i] || ''; });
        inputs[5].focus();
        setTimeout(verifyOtpCode, 80);
      }
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

// ── Launch app ───────────────────────────────────────────────────────────────
async function launchApp() {
  try {
    setUserAvatar();
    showScreen('screenApp');
    showLoader();
      // Minimum loader display time so the UI doesn't flash on fast connections.
    await Promise.all([
      loadData(),
      new Promise(r => setTimeout(r, 2500)),
    ]);
    hideLoader();
    render();
    document.getElementById('overlay').addEventListener('click', closeAllSheets);
    document.getElementById('manageCustomBtn').addEventListener('click', toggleManageCustom);
    initSwipeToClose(document.getElementById('eventSheet'),     closeSheet);
    initSwipeToClose(document.getElementById('customSheet'),    closeCustomSheet);
    initSwipeToClose(document.getElementById('subscribeSheet'), closeSubscribeSheet);
  } catch (err) {
    console.error('launchApp error:', err);
    hideLoader();
    render();
  }
}

// ── User menu ────────────────────────────────────────────────────────────────
function setUserAvatar() {
  const email  = currentUser?.email || '';
  const letter = email.charAt(0).toUpperCase();
  const avatar    = document.getElementById('userAvatar');
  const menuEmail = document.getElementById('userMenuEmail');
  if (avatar)    avatar.textContent    = letter;
  if (menuEmail) menuEmail.textContent = email;
}

// La synchro agenda a son propre bouton dans l'en-tête : la dupliquer ici
// n'apportait rien. Le menu du compte ne sert plus qu'à se déconnecter.
function buildSignedOutMenu(menu) {
  const signOutBtn = el('button', { class: 'user-menu-item danger', onClick: confirmSignOut },
    icon('logout'), 'Se déconnecter');

  replaceChildren(
    menu,
    el('div', { class: 'user-menu-email', text: currentUser?.email || '' }),
    el('div', { class: 'user-menu-divider' }),
    signOutBtn,
  );
}

function toggleUserMenu() {
  const menu   = document.getElementById('userMenu');
  const isOpen = menu.style.display !== 'none';
  if (isOpen) { menu.style.display = 'none'; return; }

  buildSignedOutMenu(menu);
  menu.style.display = 'block';
  // Close on next outside click.
  setTimeout(() => document.addEventListener('click', closeUserMenu, { once: true }), 10);
}

function closeUserMenu() {
  const menu = document.getElementById('userMenu');
  if (menu) menu.style.display = 'none';
}

// Inline confirm UI — no HTML injection, no inline onclick.
function confirmSignOut() {
  const menu = document.getElementById('userMenu');
  if (!menu) return;
  const title  = el('p', { class: 'user-menu-confirm', text: 'Se déconnecter ?' });
  const yes    = el('button', { class: 'user-menu-item danger', text: 'Oui, déconnexion', onClick: doSignOut });
  const cancel = el('button', { class: 'user-menu-item',         text: 'Annuler',         onClick: closeUserMenu });
  const row    = el('div', { class: 'user-menu-confirm-row' }, yes, cancel);
  replaceChildren(menu, title, row);
  menu.style.display = 'block';
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

// ── Generic helpers ──────────────────────────────────────────────────────────
function showAuthError(msg) {
  const errEl = document.getElementById('authError');
  if (!errEl) return;
  errEl.textContent   = msg; // textContent — safe
  errEl.style.display = 'block';
  setTimeout(() => { errEl.style.display = 'none'; }, 3500);
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
