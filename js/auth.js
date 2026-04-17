// ── Auth state ────────────────────────────────────────────────────────────────
let currentUser = null;

// ── Screen management ─────────────────────────────────────────────────────────
function showScreen(id) {
  ['screenAuth', 'screenPin', 'screenApp'].forEach(s => {
    document.getElementById(s).style.display = s === id ? 'flex' : 'none';
  });
}

// ── Entry point called by app.js ─────────────────────────────────────────────
async function initAuth() {
  buildPinPads();
  initOtpInputs();

  const pin = localStorage.getItem('planify_pin');

  // Try to restore session (works even if access token expired — refresh token lasts months)
  const { data: { session } } = await sb.auth.getSession();

  if (session) {
    // Active session — just ask for PIN or biometric
    currentUser = session.user;
    if (pin) {
      pinMode = 'verify';
      showScreen('screenPin');
      showPinStep('stepPinVerify');
      tryBiometric();
    } else {
      // Logged in but no PIN yet (edge case) — set one up
      pinMode = 'setup';
      showScreen('screenPin');
      showPinStep('stepPinSetup');
    }
  } else if (pin) {
    // No active session but PIN exists — try silent refresh first
    const { data: refreshData } = await sb.auth.refreshSession();
    if (refreshData?.session) {
      currentUser = refreshData.session.user;
      pinMode = 'verify';
      showScreen('screenPin');
      showPinStep('stepPinVerify');
      tryBiometric();
    } else {
      // Refresh token truly expired (rare, after months) — must re-auth via email
      // But show a friendly message rather than blank email form
      showScreen('screenAuth');
      showAuthStep('stepEmailReauth');
    }
  } else {
    // Brand new user — email signup
    showScreen('screenAuth');
    showAuthStep('stepEmail');
  }
  return false;
}

// ── Email OTP auth (code saisi dans l'app — compatible PWA iOS) ───────────────
async function sendOtpCode() {
  const email = document.getElementById('authEmail').value.trim();
  if (!email || !email.includes('@')) { showAuthError('Entre une adresse email valide'); return; }

  setAuthLoading(true);
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  setAuthLoading(false);

  if (error) { showAuthError(error.message); return; }

  // Store email for verification step
  document.getElementById('otpEmailDisplay').textContent = email;
  showAuthStep('stepOtpCode');
  // Auto-focus first digit
  setTimeout(() => document.querySelector('.otp-digit')?.focus(), 100);
}

async function verifyOtpCode() {
  const digits = [...document.querySelectorAll('.otp-digit')].map(i => i.value).join('');
  if (digits.length < 6) { showAuthError('Entre les 6 chiffres du code'); return; }

  const email = document.getElementById('authEmail').value.trim();
  setAuthLoading(true);
  const { data, error } = await sb.auth.verifyOtp({ email, token: digits, type: 'email' });
  setAuthLoading(false);

  if (error) {
    showAuthError('Code incorrect ou expiré');
    shakeOtp();
    return;
  }

  currentUser = data.user;
  const pin = localStorage.getItem('planify_pin');
  if (!pin) {
    pinMode = 'setup';
    showScreen('screenPin');
    showPinStep('stepPinSetup');
  } else {
    await launchApp();
  }
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

// Re-auth variant (session expired)
async function sendOtpCodeReauth() {
  const email = document.getElementById('authEmailReauth').value.trim();
  if (!email || !email.includes('@')) { showAuthError('Entre une adresse email valide'); return; }
  const btn = document.getElementById('authReauthBtn');
  btn.disabled = true; btn.textContent = 'Envoi…';
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  btn.disabled = false; btn.textContent = 'Envoyer le code';
  if (error) { showAuthError(error.message); return; }
  document.getElementById('authEmail').value = email; // reuse same email field for verifyOtp
  document.getElementById('otpEmailDisplay').textContent = email;
  showAuthStep('stepOtpCode');
  setTimeout(() => document.querySelector('.otp-digit')?.focus(), 100);
}

// OTP digit navigation — auto-advance + backspace
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
        setTimeout(verifyOtpCode, 50);
      }
      e.preventDefault();
    });
  });
}

// ── PIN setup & verification ──────────────────────────────────────────────────
let pinBuffer = '';
let pinMode   = 'setup'; // 'setup' | 'confirm' | 'verify'
let pinFirst  = '';

function showPinStep(stepId) {
  ['stepPinSetup', 'stepPinConfirm', 'stepPinVerify'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === stepId ? 'block' : 'none';
  });
  pinBuffer = '';
  updatePinDots();
}

function pinKey(val) {
  if (pinBuffer.length >= 6) return;
  if (val === 'del') {
    pinBuffer = pinBuffer.slice(0, -1);
  } else {
    pinBuffer += val;
  }
  updatePinDots();

  if (pinBuffer.length === 6) {
    setTimeout(() => handlePinComplete(), 120);
  }
}

function updatePinDots() {
  const activeStep = pinMode === 'verify' ? 'stepPinVerify' : (pinMode === 'confirm' ? 'stepPinConfirm' : 'stepPinSetup');
  const dots = document.querySelectorAll(`#${activeStep} .pin-dot`);
  dots.forEach((d, i) => {
    d.classList.toggle('filled', i < pinBuffer.length);
  });
}

function handlePinComplete() {
  if (pinMode === 'setup') {
    pinFirst = pinBuffer;
    pinMode  = 'confirm';
    showPinStep('stepPinConfirm');
  } else if (pinMode === 'confirm') {
    if (pinBuffer === pinFirst) {
      localStorage.setItem('planify_pin', pinBuffer);
      pinMode = 'verify';
      registerBiometric().then(() => launchApp());
    } else {
      shakePinDots('stepPinConfirm');
      setTimeout(() => { pinMode = 'setup'; pinFirst = ''; showPinStep('stepPinSetup'); }, 600);
    }
  } else if (pinMode === 'verify') {
    const saved = localStorage.getItem('planify_pin');
    if (pinBuffer === saved) {
      launchApp();
    } else {
      shakePinDots('stepPinVerify');
      pinBuffer = '';
      updatePinDots();
    }
  }
}

function shakePinDots(stepId) {
  const row = document.querySelector(`#${stepId} .pin-dots`);
  if (!row) return;
  row.classList.add('shake');
  setTimeout(() => row.classList.remove('shake'), 500);
}

// ── Biometric (Face ID / Touch ID via WebAuthn) ───────────────────────────────
async function registerBiometric() {
  if (!window.PublicKeyCredential) return;
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp:        { name: 'Planify' },
        user: {
          id:          new TextEncoder().encode(currentUser.id),
          name:        currentUser.email,
          displayName: currentUser.email,
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification:        'required',
        },
        timeout: 30000,
      },
    });
    // Store credential id for later verification
    localStorage.setItem('planify_cred_id', btoa(String.fromCharCode(...new Uint8Array(cred.rawId))));
  } catch (e) {
    // User declined biometric — silently skip
  }
}

async function tryBiometric() {
  const credId = localStorage.getItem('planify_cred_id');
  if (!window.PublicKeyCredential || !credId) return;
  try {
    const rawId = Uint8Array.from(atob(credId), c => c.charCodeAt(0));
    await navigator.credentials.get({
      publicKey: {
        challenge:        crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: rawId }],
        userVerification: 'required',
        timeout:          30000,
      },
    });
    // Biometric passed
    launchApp();
  } catch (e) {
    // Biometric failed/cancelled — show PIN instead
    pinMode = 'verify';
    showPinStep('stepPinVerify');
  }
}

// ── Launch app after auth ─────────────────────────────────────────────────────
async function launchApp() {
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
}

// ── User menu ─────────────────────────────────────────────────────────────────
function setUserAvatar() {
  const email = currentUser?.email || '';
  const letter = email.charAt(0).toUpperCase();
  const avatar = document.getElementById('userAvatar');
  const menuEmail = document.getElementById('userMenuEmail');
  if (avatar) avatar.textContent = letter;
  if (menuEmail) menuEmail.textContent = email;
}

function toggleUserMenu() {
  const menu = document.getElementById('userMenu');
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // Close on next outside tap
    setTimeout(() => document.addEventListener('click', closeUserMenu, { once: true }), 10);
  }
}

function closeUserMenu() {
  const menu = document.getElementById('userMenu');
  if (menu) menu.style.display = 'none';
}

function confirmSignOut() {
  closeUserMenu();
  // Inline confirm inside the sheet
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
  localStorage.removeItem('planify_pin');
  localStorage.removeItem('planify_cred_id');
  currentUser = null;
  events = {};
  customTypes = [];
  DEFAULT_PRESETS.length = 0;
  showScreen('screenAuth');
  showAuthStep('stepEmail');
}

// Keep old name as alias for any remaining references
async function signOut() { await doSignOut(); }

// ── Build PIN numpad ─────────────────────────────────────────────────────────
function buildPinPads() {
  const keys = [
    ['1',''],['2','ABC'],['3','DEF'],
    ['4','GHI'],['5','JKL'],['6','MNO'],
    ['7','PQRS'],['8','TUV'],['9','WXYZ'],
    ['empty',''],['0',''],['del','⌫'],
  ];
  ['pinPadSetup','pinPadConfirm','pinPadVerify'].forEach(id => {
    const pad = document.getElementById(id);
    if (!pad) return;
    pad.innerHTML = '';
    keys.forEach(([val, sub]) => {
      const btn = document.createElement('button');
      if (val === 'empty') {
        btn.className = 'pin-key empty';
      } else if (val === 'del') {
        btn.className = 'pin-key del';
        btn.textContent = '⌫';
        btn.addEventListener('click', () => pinKey('del'));
      } else {
        btn.className = 'pin-key';
        btn.innerHTML = `${val}${sub ? `<span class="pin-key-sub">${sub}</span>` : ''}`;
        btn.addEventListener('click', () => pinKey(val));
      }
      pad.appendChild(btn);
    });
  });

  // Show biometric button if credential registered
  const bioBtn = document.getElementById('biometricBtn');
  if (bioBtn && localStorage.getItem('planify_cred_id') && window.PublicKeyCredential) {
    bioBtn.style.display = 'inline-flex';
    // Detect Face ID vs Touch ID by platform
    const isIOS = /iPhone|iPad/.test(navigator.userAgent);
    document.getElementById('biometricIcon').textContent = isIOS ? '🔒' : '🔒';
  }
}

// ── Auth screen helpers ───────────────────────────────────────────────────────
function showAuthStep(stepId) {
  ['stepEmail', 'stepOtpCode', 'stepEmailReauth'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === stepId ? 'block' : 'none';
  });
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3500);
}

function setAuthLoading(on) {
  const btn = document.getElementById('authSubmitBtn');
  if (!btn) return;
  btn.disabled    = on;
  btn.textContent = on ? 'Envoi…' : 'Continuer';
}
