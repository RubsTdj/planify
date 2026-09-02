// ─── Calendar subscription (sens unique Planify → calendrier) ────────────────
// Génère / récupère le token de l'utilisateur, construit les URLs (https + webcal)
// et présente la modal d'aide à l'ajout sur Google Agenda / Apple Calendar.
//
// Backend : Edge Function `calendar-feed` qui sert le .ics à jour à chaque
// poll du calendrier client. Les UIDs sont stables, donc les events se
// mettent à jour au lieu d'être dupliqués. Supprimer un event dans Planify
// le retire au prochain rafraîchissement.

// Hostname utilisé pour les URLs (déduit de SUPABASE_URL).
function feedBaseUrl() {
  // SUPABASE_URL ressemble à https://<ref>.supabase.co
  return `${SUPABASE_URL}/functions/v1/calendar-feed`;
}

// Récupère le token existant ou en provoque la création.
async function getOrCreateCalendarToken() {
  const uid = currentUser?.id;
  if (!uid) return null;

  // 1) Tentative de lecture du token existant.
  const { data: row, error: readErr } = await sb
    .from('user_calendar_tokens')
    .select('token')
    .eq('user_id', uid)
    .maybeSingle();

  if (readErr) {
    console.error('getOrCreateCalendarToken read:', readErr);
    showToast('Lecture du lien impossible');
    return null;
  }
  if (row?.token) return row.token;

  // 2) Pas de token → on appelle la RPC qui en crée un (upsert sécurisé).
  const { data: tok, error: rpcErr } = await sb.rpc('rotate_calendar_token');
  if (rpcErr) {
    console.error('getOrCreateCalendarToken rpc:', rpcErr);
    showToast('Impossible de générer le lien');
    return null;
  }
  return tok;
}

// Régénère le token (invalide tout lien précédemment partagé).
async function rotateCalendarToken() {
  const { data: tok, error } = await sb.rpc('rotate_calendar_token');
  if (error) {
    console.error('rotateCalendarToken:', error);
    showToast('Échec de la régénération');
    return null;
  }
  showToast('Nouveau lien généré');
  return tok;
}

// Copie une string dans le presse-papier (avec fallback pour iOS Safari).
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* fallthrough */ }

  // Fallback : champ caché + execCommand (deprecated mais marche partout).
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity  = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  ta.remove();
  return ok;
}

// Ouvre la modal d'abonnement (chargée à la demande, jamais avant).
async function openSubscribeSheet() {
  closeUserMenu();
  showToast('Préparation du lien…');

  const token = await getOrCreateCalendarToken();
  if (!token) return;

  const httpsUrl  = `${feedBaseUrl()}?token=${token}`;
  const webcalUrl = httpsUrl.replace(/^https?:/, 'webcal:');

  buildSubscribeSheet(httpsUrl, webcalUrl);
  document.getElementById('overlay').classList.add('visible');
  document.getElementById('subscribeSheet').classList.add('visible');
}

function closeSubscribeSheet() {
  document.getElementById('overlay').classList.remove('visible');
  document.getElementById('subscribeSheet').classList.remove('visible');
}

// Construit le contenu de la bottom-sheet d'abonnement, en safe-DOM uniquement.
function buildSubscribeSheet(httpsUrl, webcalUrl) {
  const sheet = document.getElementById('subscribeSheet');

  const handle = el('div', { class: 'sheet-handle' });

  const header = el('div', { class: 'sheet-header' },
    el('h3', { text: 'Synchroniser avec mon agenda' }),
    el('div', { class: 'sheet-date',
      text: 'Modif dans Planify → ton agenda se met à jour automatiquement (toutes les quelques heures).' }),
  );

  // URL display block (read-only, cliquable pour copier).
  const urlInput = el('input', {
    class: 'auth-input subscribe-url',
    attrs: { type: 'text', readonly: 'readonly', spellcheck: 'false', autocomplete: 'off' },
  });
  urlInput.value = httpsUrl;
  urlInput.addEventListener('click', () => urlInput.select());

  const copyBtn = el('button', { class: 'btn btn-primary' }, icon('copy'), 'Copier le lien');
  copyBtn.addEventListener('click', async () => {
    const ok = await copyToClipboard(httpsUrl);
    showToast(ok ? 'Lien copié' : 'Copie échouée');
  });

  // Apple Calendar : webcal:// déclenche directement la fiche d'abonnement.
  const appleBtn = el('a', {
    class: 'btn btn-ghost subscribe-deeplink',
    attrs: { href: webcalUrl },
    text: 'Ajouter à Apple Calendar',
  });

  // Google Calendar : pas de schéma deep-link, on ouvre la page d'ajout par URL.
  const googleHref = `https://calendar.google.com/calendar/u/0/r/settings/addbyurl?cid=${encodeURIComponent(httpsUrl)}`;
  const googleBtn = el('a', {
    class: 'btn btn-ghost subscribe-deeplink',
    attrs: { href: googleHref, target: '_blank', rel: 'noopener noreferrer' },
    text: 'Ajouter à Google Agenda',
  });

  const rotateBtn = el('button', { class: 'manage-custom-btn' },
    icon('refresh'), 'Régénérer le lien (révoque l\'ancien)');
  rotateBtn.addEventListener('click', async () => {
    const ok = window.confirm('Régénérer le lien rendra l\'URL actuelle invalide. Continuer ?');
    if (!ok) return;
    const tok = await rotateCalendarToken();
    if (tok) {
      const newHttps = `${feedBaseUrl()}?token=${tok}`;
      const newWebcal = newHttps.replace(/^https?:/, 'webcal:');
      buildSubscribeSheet(newHttps, newWebcal);
    }
  });

  const closeBtn = el('button', { class: 'btn btn-ghost', text: 'Fermer', onClick: closeSubscribeSheet });

  const content = el('div', { class: 'modal-content' },
    el('div', { class: 'form-group' },
      el('label', { text: 'Lien d\'abonnement' }),
      urlInput,
    ),
    copyBtn,
    el('div', { style: 'height:12px;' }),
    appleBtn,
    el('div', { style: 'height:8px;' }),
    googleBtn,
    el('div', { style: 'height:24px;' }),
    rotateBtn,
    el('div', { style: 'height:8px;' }),
    closeBtn,
  );

  replaceChildren(sheet, handle, header, content);
}
