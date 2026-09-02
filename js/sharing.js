// ─── Partage de planning ──────────────────────────────────────────────────────
// Invitation SORTANTE : le propriétaire génère un code, le transmet par son
// propre canal, l'autre le saisit. Pas d'annuaire, donc aucune surface
// d'énumération de comptes (voir supabase/migration_sharing.sql).
//
// Toute la sécurité vit dans la base : les politiques RLS décident qui lit
// quoi et les RPC encadrent la création, la consommation et la révocation.
// Ce fichier n'est qu'une interface — il ne peut rien débloquer de lui-même.

let myProfileName = '';     // mon nom d'affichage
let sharesOut     = [];     // comptes à qui J'AI ouvert mon planning
let sharesIn      = [];     // plannings AUXQUELS j'ai accès
let pendingInvite = null;   // { code, scope } affiché une seule fois
let viewingShare  = null;   // le partage consulté, null = mon propre planning

// Un seul point de vérité pour « suis-je en lecture seule ». Toutes les
// fonctions qui écrivent s'y réfèrent avant d'agir.
function isReadOnly() {
  return viewingShare !== null;
}

function viewedUserId() {
  return viewingShare ? viewingShare.owner_id : currentUserId();
}

function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

// ── Chargement ───────────────────────────────────────────────────────────────
// Les deux sens du partage en une requête : RLS ne renvoie que les lignes où je
// suis propriétaire ou lecteur.
async function loadSharing() {
  const uid = currentUserId();
  if (!uid) return;

  // Le partage est une brique optionnelle : tant que la migration n'est pas
  // passée, les tables n'existent pas. Rien ici ne doit pouvoir interrompre le
  // démarrage de l'app — d'où le try/catch qui englobe tout.
  let shares, prof;
  try {
    const [r1, r2] = await Promise.all([
      sb.from('shares').select('id, owner_id, viewer_id, scope, created_at').is('revoked_at', null),
      sb.from('profiles').select('user_id, display_name'),
    ]);
    if (r1.error || r2.error) throw (r1.error || r2.error);
    shares = r1.data; prof = r2.data;
  } catch (err) {
    console.warn('loadSharing indisponible:', err);
    sharesOut = []; sharesIn = []; viewingShare = null;
    return;
  }

  const names = {};
  for (const p of (prof || [])) names[p.user_id] = p.display_name;
  myProfileName = names[uid] || '';

  sharesOut = (shares || []).filter(s => s.owner_id  === uid)
    .map(s => ({ ...s, name: names[s.viewer_id] || 'Compte Planify' }));
  sharesIn  = (shares || []).filter(s => s.viewer_id === uid)
    .map(s => ({ ...s, name: names[s.owner_id]  || 'Compte Planify' }));

  // Le partage consulté a pu être révoqué entre-temps.
  if (viewingShare && !sharesIn.some(s => s.id === viewingShare.id)) {
    viewingShare = null;
    await loadData();
  }
}

// Nom d'affichage : créé au premier lancement à partir de l'email, modifiable
// ensuite. On ne montre jamais l'email de quelqu'un d'autre.
async function ensureProfile() {
  if (myProfileName) return;
  const fallback = (currentUser?.email || 'Planify').split('@')[0].slice(0, 40);
  try {
    const { data, error } = await sb.rpc('set_display_name', { p_name: fallback });
    if (error) throw error;
    myProfileName = data || fallback;
  } catch (err) {
    console.warn('ensureProfile indisponible:', err);
  }
}

// ── Bascule entre plannings ──────────────────────────────────────────────────
async function switchToPlanning(share) {
  viewingShare = share;
  batchMode = false;
  batchSelected.clear();
  animatedTags = {};
  closeAllSheets();
  await loadData(viewedUserId());
  render();
  showToast(share ? `Planning de ${share.name}` : 'Ton planning');
}

// La sous-ligne du mois porte l'année et, dès qu'un partage existe, le nom du
// planning affiché.
function renderPlanningSwitch() {
  const btn = document.getElementById('planningSwitch');
  const lbl = document.getElementById('yearLabel');
  if (!btn || !lbl) return;

  const switchable = sharesIn.length > 0;
  btn.classList.toggle('switchable', switchable);
  lbl.textContent = switchable
    ? `${currentYear} · ${viewingShare ? viewingShare.name : 'Mon planning'}`
    : String(currentYear);

  replaceChildren(btn, lbl);
  if (switchable) btn.append(icon('down'));
}

function openPlanningPicker() {
  if (sharesIn.length === 0) return;
  const sheet = document.getElementById('planningSheet');

  const row = (label, sub, active, onClick) => {
    const r = el('div', { class: 'share-row', onClick },
      el('div', { class: 'share-avatar', text: initials(label) }),
      el('div', { class: 'share-row-tx' },
        el('b', { text: label }),
        el('span', { text: sub }),
      ),
    );
    if (active) r.append(icon('check'));
    return r;
  };

  replaceChildren(sheet,
    el('div', { class: 'sheet-handle' }),
    el('div', { class: 'sheet-header' },
      el('h3', { text: 'Quel planning' }),
      el('div', { class: 'sheet-date', text: 'Un seul à la fois, en lecture seule pour les autres.' }),
    ),
    el('div', { class: 'sheet-section' },
      row('Mon planning', currentUser?.email || '', !viewingShare,
          () => { closeAllSheets(); switchToPlanning(null); }),
      ...sharesIn.map(s => row(s.name,
        s.scope === 'all' ? 'Tout son planning' : 'Ses shifts uniquement',
        viewingShare?.id === s.id,
        () => { closeAllSheets(); switchToPlanning(s); })),
    ),
  );

  document.getElementById('overlay').classList.add('visible');
  sheet.classList.add('visible');
}

function closePlanningSheet() {
  document.getElementById('overlay').classList.remove('visible');
  document.getElementById('planningSheet').classList.remove('visible');
}

// ── Actions ──────────────────────────────────────────────────────────────────
async function createInvite(scope) {
  const { data, error } = await sb.rpc('create_share_invite', { p_scope: scope });
  if (error) {
    console.error('createInvite:', error);
    showToast(/pending|limit/.test(error.message || '')
      ? 'Trop de codes en attente'
      : 'Impossible de créer le code');
    return;
  }
  pendingInvite = { code: data, scope };
  buildShareSheet();
}

async function redeemInvite(rawCode) {
  const code = (rawCode || '').trim();
  if (code.length < 6) { showToast('Code incomplet'); return; }

  const { data, error } = await sb.rpc('redeem_share_invite', { p_code: code });
  if (error) {
    console.error('redeemInvite:', error);
    const m = error.message || '';
    showToast(/too many attempts/.test(m) ? 'Trop d\'essais, réessaie dans une heure'
            : /yourself/.test(m)          ? 'C\'est ton propre code'
            : 'Code invalide ou expiré');
    return;
  }

  const row = Array.isArray(data) ? data[0] : data;
  await loadSharing();
  buildShareSheet();
  renderPlanningSwitch();
  showToast(`Tu suis le planning de ${row?.o_display_name || 'ce compte'}`);
}

async function revokeShare(shareId, name) {
  const { error } = await sb.rpc('revoke_share', { p_share_id: shareId });
  if (error) { console.error('revokeShare:', error); showToast('Révocation impossible'); return; }
  await loadSharing();
  buildShareSheet();
  renderPlanningSwitch();
  render();
  showToast(`Accès retiré · ${name}`);
}

async function saveDisplayName(name) {
  const { data, error } = await sb.rpc('set_display_name', { p_name: name });
  if (error) { console.error('saveDisplayName:', error); showToast('Nom refusé'); return; }
  myProfileName = data;
  showToast('Nom enregistré');
}

// ── Feuille « Partage de planning » ──────────────────────────────────────────
function shareRow(name, sub, actionLabel, onAction) {
  const btn = el('button', { class: 'share-row-act', text: actionLabel, onClick: onAction });
  return el('div', { class: 'share-row' },
    el('div', { class: 'share-avatar', text: initials(name) }),
    el('div', { class: 'share-row-tx' }, el('b', { text: name }), el('span', { text: sub })),
    btn,
  );
}

function buildShareSheet() {
  const sheet = document.getElementById('shareSheet');

  // 1. Mon nom, tel que les autres le verront.
  const nameInput = el('input', {
    class: 'form-input',
    attrs: { type: 'text', maxlength: '40', placeholder: 'Ton prénom' },
  });
  nameInput.value = myProfileName;
  const nameBtn = el('button', { class: 'btn btn-ghost', text: 'Enregistrer',
    onClick: () => saveDisplayName(nameInput.value) });

  const blockName = el('div', { class: 'share-block' },
    el('div', { class: 'share-title', text: 'Ton nom, tel que les autres le verront' }),
    nameInput,
    el('div', { style: 'height:9px' }),
    nameBtn,
  );

  // 2. Créer un code. Le périmètre est la décision de confidentialité : les
  //    événements perso ne traversent que si on choisit « tout ».
  let blockInvite;
  if (pendingInvite) {
    const copyBtn = el('button', { class: 'btn btn-primary' }, icon('copy'), 'Copier le code');
    copyBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(pendingInvite.code);
      showToast(ok ? 'Code copié' : 'Copie échouée');
    });
    blockInvite = el('div', { class: 'share-block' },
      el('div', { class: 'share-title', text: 'Ton code, à transmettre de vive voix ou par SMS' }),
      el('div', { class: 'share-code', text: pendingInvite.code }),
      el('div', { style: 'height:10px' }),
      copyBtn,
      el('div', { class: 'share-hint', text:
        `Valable 72 heures, une seule utilisation, ${pendingInvite.scope === 'all'
          ? 'donne accès à tout ton planning.'
          : 'ne donne accès qu\'à tes shifts.'} Il ne sera plus affiché ensuite.` }),
      el('div', { style: 'height:10px' }),
      el('button', { class: 'btn btn-ghost', text: 'Terminé',
        onClick: () => { pendingInvite = null; buildShareSheet(); } }),
    );
  } else {
    blockInvite = el('div', { class: 'share-block' },
      el('div', { class: 'share-title', text: 'Partager mon planning' }),
      el('div', { class: 'duration-selector' },
        el('div', { class: 'duration-option active', dataset: { scope: 'shifts' },
                    onClick: e => selectShareScope(e.currentTarget) },
          el('span', { class: 'dur-emoji' }, icon('matin')),
          el('span', { class: 'dur-label', text: 'Mes shifts' }),
          el('span', { class: 'dur-desc',  text: 'Sans le perso' }),
        ),
        el('div', { class: 'duration-option', dataset: { scope: 'all' },
                    onClick: e => selectShareScope(e.currentTarget) },
          el('span', { class: 'dur-emoji' }, icon('eye')),
          el('span', { class: 'dur-label', text: 'Tout' }),
          el('span', { class: 'dur-desc',  text: 'Perso compris' }),
        ),
      ),
      el('button', { class: 'btn btn-primary', text: 'Créer un code',
        onClick: () => createInvite(selectedShareScope) }),
    );
  }

  // 3. Qui voit mon planning.
  const blockOut = el('div', { class: 'share-block' },
    el('div', { class: 'share-title', text: 'Ont accès à mon planning' }),
    ...(sharesOut.length
      ? sharesOut.map(s => shareRow(s.name,
          s.scope === 'all' ? 'Tout mon planning' : 'Mes shifts uniquement',
          'Révoquer', () => revokeShare(s.id, s.name)))
      : [el('div', { class: 'share-empty', text: 'Personne pour le moment.' })]),
  );

  // 4. Saisir un code reçu.
  const codeInput = el('input', {
    class: 'form-input',
    attrs: { type: 'text', placeholder: 'Ex : A1B2C3D4E5', autocapitalize: 'characters',
             autocomplete: 'off', spellcheck: 'false' },
  });
  codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') redeemInvite(codeInput.value); });

  const blockJoin = el('div', { class: 'share-block' },
    el('div', { class: 'share-title', text: 'J\'ai reçu un code' }),
    codeInput,
    el('div', { style: 'height:9px' }),
    el('button', { class: 'btn btn-ghost', text: 'Rejoindre',
      onClick: () => redeemInvite(codeInput.value) }),
  );

  // 5. Les plannings que je suis.
  const blockIn = el('div', { class: 'share-block' },
    el('div', { class: 'share-title', text: 'Plannings que je suis' }),
    ...(sharesIn.length
      ? sharesIn.map(s => shareRow(s.name,
          s.scope === 'all' ? 'Tout son planning' : 'Ses shifts uniquement',
          'Se désabonner', () => revokeShare(s.id, s.name)))
      : [el('div', { class: 'share-empty', text: 'Aucun pour le moment.' })]),
  );

  replaceChildren(sheet,
    el('div', { class: 'sheet-handle' }),
    el('div', { class: 'sheet-header' },
      el('h3', { text: 'Partage de planning' }),
      el('div', { class: 'sheet-date', text: 'En lecture seule, révocable à tout moment des deux côtés.' }),
    ),
    el('div', { class: 'modal-content' },
      blockName, blockInvite, blockOut, blockJoin, blockIn,
      el('div', { style: 'height:6px' }),
      el('button', { class: 'btn btn-ghost', text: 'Fermer', onClick: closeShareSheet }),
    ),
  );
}

let selectedShareScope = 'shifts';
function selectShareScope(target) {
  selectedShareScope = target.dataset.scope;
  target.parentElement.querySelectorAll('.duration-option')
    .forEach(o => o.classList.toggle('active', o === target));
}

async function openShareSheet() {
  closeAllSheets();
  pendingInvite = null;
  selectedShareScope = 'shifts';
  await ensureProfile();
  await loadSharing();
  buildShareSheet();
  setTimeout(() => {
    document.getElementById('overlay').classList.add('visible');
    document.getElementById('shareSheet').classList.add('visible');
  }, 250);
}

function closeShareSheet() {
  document.getElementById('overlay').classList.remove('visible');
  document.getElementById('shareSheet').classList.remove('visible');
  pendingInvite = null;
}
