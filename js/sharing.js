// ─── Planning d'équipe ────────────────────────────────────────────────────────
// Un service = une équipe. Un seul code, régénérable, valable 7 jours : à dix,
// distribuer dix codes nominatifs serait une corvée. Le garde-fou du code
// unique, c'est que la liste des membres est visible de tous et qu'un admin
// peut exclure en un geste.
//
// Le partage est limité aux SHIFTS et en LECTURE SEULE. Les événements perso
// ne franchissent jamais la frontière de l'équipe, et c'est la politique RLS
// qui le garantit (voir supabase/migration_sharing.sql). Ce fichier n'est
// qu'une interface — il ne peut rien débloquer de lui-même.

let myProfileName = '';    // mon nom d'affichage
let myTeams       = [];    // [{ id, name, role, members: [{ user_id, name, role }] }]
let teammates     = [];    // coéquipiers, dédoublonnés : [{ user_id, name, teamName }]
let pendingCode   = null;  // { code, teamName } affiché une seule fois
let viewedMember  = null;  // le collègue consulté, null = mon propre planning

// Un seul point de vérité pour « suis-je en lecture seule ». Toutes les
// fonctions qui écrivent s'y réfèrent avant d'agir.
function isReadOnly() {
  return viewedMember !== null;
}

function viewedUserId() {
  return viewedMember ? viewedMember.user_id : currentUserId();
}

function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

function isAdminOf(team) {
  return team.role === 'admin';
}

// ── Chargement ───────────────────────────────────────────────────────────────
// RLS ne renvoie que les équipes dont je suis membre, et que les profils de mes
// coéquipiers. Le client n'a rien à filtrer.
async function loadSharing() {
  const uid = currentUserId();
  if (!uid) return;

  // Brique optionnelle : tant que la migration n'est pas passée, ces tables
  // n'existent pas. Rien ici ne doit interrompre le démarrage de l'app.
  let members, teams, profiles;
  try {
    const [r1, r2, r3] = await Promise.all([
      sb.from('team_members').select('team_id, user_id, role'),
      sb.from('teams').select('id, name'),
      sb.from('profiles').select('user_id, display_name'),
    ]);
    if (r1.error || r2.error || r3.error) throw (r1.error || r2.error || r3.error);
    members = r1.data; teams = r2.data; profiles = r3.data;
  } catch (err) {
    console.warn('Équipes indisponibles:', err);
    myTeams = []; teammates = []; viewedMember = null;
    return;
  }

  const names = {};
  for (const p of (profiles || [])) names[p.user_id] = p.display_name;
  myProfileName = names[uid] || '';

  myTeams = (teams || []).map(t => {
    const rows = (members || []).filter(m => m.team_id === t.id);
    const mine = rows.find(m => m.user_id === uid);
    return {
      id: t.id,
      name: t.name,
      role: mine ? mine.role : 'member',
      members: rows.map(m => ({
        user_id: m.user_id,
        role: m.role,
        name: m.user_id === uid ? (myProfileName || 'Moi') : (names[m.user_id] || 'Collègue'),
      })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  // Un collègue peut appartenir à deux équipes : on ne le liste qu'une fois.
  const seen = new Set([uid]);
  teammates = [];
  for (const t of myTeams) {
    for (const m of t.members) {
      if (seen.has(m.user_id)) continue;
      seen.add(m.user_id);
      teammates.push({ user_id: m.user_id, name: m.name, teamName: t.name });
    }
  }

  // Le collègue consulté a pu quitter l'équipe entre-temps.
  if (viewedMember && !teammates.some(m => m.user_id === viewedMember.user_id)) {
    viewedMember = null;
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
async function switchToPlanning(member) {
  viewedMember = member;
  batchMode = false;
  batchSelected.clear();
  animatedTags = {};
  closeAllSheets();
  await loadData(viewedUserId());
  render();
  showToast(member ? `Planning de ${member.name}` : 'Ton planning');
}

// La sous-ligne du mois porte l'année et, dès qu'une équipe existe, le nom du
// planning affiché.
function renderPlanningSwitch() {
  const btn = document.getElementById('planningSwitch');
  const lbl = document.getElementById('yearLabel');
  if (!btn || !lbl) return;

  const switchable = teammates.length > 0;
  btn.classList.toggle('switchable', switchable);
  lbl.textContent = switchable
    ? `${currentYear} · ${viewedMember ? viewedMember.name : 'Mon planning'}`
    : String(currentYear);

  replaceChildren(btn, lbl);
  if (switchable) btn.append(icon('down'));
}

function openPlanningPicker() {
  if (teammates.length === 0) return;
  const sheet = document.getElementById('planningSheet');

  const row = (label, sub, active, onClick) => {
    const r = el('div', { class: 'share-row', onClick },
      el('div', { class: 'share-avatar', text: initials(label) }),
      el('div', { class: 'share-row-tx' }, el('b', { text: label }), el('span', { text: sub })),
    );
    if (active) r.append(icon('check'));
    return r;
  };

  replaceChildren(sheet,
    el('div', { class: 'sheet-handle' }),
    el('div', { class: 'sheet-header' },
      el('h3', { text: 'Quel planning' }),
      el('div', { class: 'sheet-date', text: 'Les shifts de tes collègues, en lecture seule.' }),
    ),
    el('div', { class: 'sheet-section' },
      row('Mon planning', currentUser?.email || '', !viewedMember,
          () => { closeAllSheets(); switchToPlanning(null); }),
      ...teammates.map(m => row(m.name, m.teamName,
        viewedMember?.user_id === m.user_id,
        () => { closeAllSheets(); switchToPlanning(m); })),
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
function rpcErrorMessage(error, fallback) {
  const m = error?.message || '';
  if (/too many attempts/.test(m))   return 'Trop d\'essais, réessaie dans une heure';
  if (/invalid or expired/.test(m))  return 'Code invalide ou expiré';
  if (/team is full/.test(m))        return 'Cette équipe est complète';
  if (/too many teams/.test(m))      return 'Tu as déjà trois équipes';
  if (/promote another admin/.test(m)) return 'Nomme un autre admin avant de partir';
  if (/not a team admin/.test(m))    return 'Réservé aux admins';
  return fallback;
}

async function createTeam(name) {
  if (!name.trim()) { showToast('Donne un nom au service'); return; }
  const { data, error } = await sb.rpc('create_team', { p_name: name });
  if (error) { showToast(rpcErrorMessage(error, 'Création impossible')); return; }
  const row = Array.isArray(data) ? data[0] : data;
  await loadSharing();
  pendingCode = { code: row?.o_code, teamName: name };
  buildShareSheet();
  renderPlanningSwitch();
  showToast('Service créé');
}

async function joinTeam(rawCode) {
  const code = (rawCode || '').trim();
  if (code.length < 6) { showToast('Code incomplet'); return; }
  const { data, error } = await sb.rpc('join_team', { p_code: code });
  if (error) { showToast(rpcErrorMessage(error, 'Impossible de rejoindre')); return; }
  const row = Array.isArray(data) ? data[0] : data;
  await loadSharing();
  buildShareSheet();
  renderPlanningSwitch();
  showToast(`Bienvenue dans ${row?.o_team_name || 'l\'équipe'}`);
}

// Le code n'est stocké que haché : on ne peut pas le « réafficher », seulement
// en générer un nouveau, ce qui invalide le précédent.
async function generateTeamCode(team) {
  const { data, error } = await sb.rpc('rotate_team_code', { p_team: team.id });
  if (error) { showToast(rpcErrorMessage(error, 'Génération impossible')); return; }
  pendingCode = { code: data, teamName: team.name };
  buildShareSheet();
}

async function leaveTeam(team) {
  const { error } = await sb.rpc('leave_team', { p_team: team.id });
  if (error) { showToast(rpcErrorMessage(error, 'Impossible de quitter')); return; }
  await loadSharing();
  buildShareSheet();
  renderPlanningSwitch();
  render();
  showToast(`Tu as quitté ${team.name}`);
}

async function removeMember(team, member) {
  const { error } = await sb.rpc('remove_team_member', { p_team: team.id, p_user: member.user_id });
  if (error) { showToast(rpcErrorMessage(error, 'Retrait impossible')); return; }
  await loadSharing();
  buildShareSheet();
  renderPlanningSwitch();
  render();
  showToast(`${member.name} retiré du service`);
}

async function saveDisplayName(name) {
  const { data, error } = await sb.rpc('set_display_name', { p_name: name });
  if (error) { showToast('Nom refusé'); return; }
  myProfileName = data;
  await loadSharing();
  showToast('Nom enregistré');
}

// ── Feuille « Mon service » ──────────────────────────────────────────────────
function memberRow(team, member) {
  const isMe = member.user_id === currentUserId();
  const sub  = member.role === 'admin' ? 'Admin' : 'Membre';

  const row = el('div', { class: 'share-row' },
    el('div', { class: 'share-avatar', text: initials(member.name) }),
    el('div', { class: 'share-row-tx' },
      el('b', { text: isMe ? `${member.name} (toi)` : member.name }),
      el('span', { text: sub }),
    ),
  );
  // Le contrepoids du code unique : un admin sort quelqu'un en un geste.
  if (isAdminOf(team) && !isMe) {
    row.append(el('button', { class: 'share-row-act', text: 'Retirer',
      onClick: () => removeMember(team, member) }));
  }
  return row;
}

function teamBlock(team) {
  const children = [
    el('div', { class: 'share-title', text: `${team.name} · ${team.members.length} membre(s)` }),
    ...team.members.map(m => memberRow(team, m)),
    el('div', { style: 'height:12px' }),
  ];

  if (isAdminOf(team)) {
    children.push(el('button', { class: 'btn btn-ghost', onClick: () => generateTeamCode(team) },
      icon('refresh'), 'Générer un code d\'invitation'));
    children.push(el('div', { class: 'share-hint', text:
      'Le nouveau code remplace le précédent. Valable 7 jours, à partager avec le service.' }));
    children.push(el('div', { style: 'height:10px' }));
  }

  children.push(el('button', { class: 'share-row-act', text: `Quitter ${team.name}`,
    style: 'padding:8px 0', onClick: () => leaveTeam(team) }));

  return el('div', { class: 'share-block' }, ...children);
}

function buildShareSheet() {
  const sheet  = document.getElementById('shareSheet');
  const blocks = [];

  // 1. Mon nom, tel que le service le verra.
  const nameInput = el('input', { class: 'form-input',
    attrs: { type: 'text', maxlength: '40', placeholder: 'Ton prénom' } });
  nameInput.value = myProfileName;
  blocks.push(el('div', { class: 'share-block' },
    el('div', { class: 'share-title', text: 'Ton nom, tel que le service le verra' }),
    nameInput,
    el('div', { style: 'height:9px' }),
    el('button', { class: 'btn btn-ghost', text: 'Enregistrer',
      onClick: () => saveDisplayName(nameInput.value) }),
  ));

  // 2. Le code qui vient d'être généré, affiché une seule fois.
  if (pendingCode) {
    const copyBtn = el('button', { class: 'btn btn-primary' }, icon('copy'), 'Copier le code');
    copyBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(pendingCode.code);
      showToast(ok ? 'Code copié' : 'Copie échouée');
    });
    blocks.push(el('div', { class: 'share-block' },
      el('div', { class: 'share-title', text: `Code d'invitation · ${pendingCode.teamName}` }),
      el('div', { class: 'share-code', text: pendingCode.code }),
      el('div', { style: 'height:10px' }),
      copyBtn,
      el('div', { class: 'share-hint', text:
        'Valable 7 jours. Il donne accès aux shifts du service, jamais aux événements perso. Il ne sera plus affiché ensuite.' }),
      el('div', { style: 'height:10px' }),
      el('button', { class: 'btn btn-ghost', text: 'Terminé',
        onClick: () => { pendingCode = null; buildShareSheet(); } }),
    ));
  }

  // 3. Mes équipes.
  myTeams.forEach(t => blocks.push(teamBlock(t)));

  // 4. Rejoindre, ou créer si je n'ai pas encore de service.
  const codeInput = el('input', { class: 'form-input',
    attrs: { type: 'text', placeholder: 'Ex : A1B2C3D4E5', autocapitalize: 'characters',
             autocomplete: 'off', spellcheck: 'false' } });
  codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinTeam(codeInput.value); });
  blocks.push(el('div', { class: 'share-block' },
    el('div', { class: 'share-title', text: 'Rejoindre un service' }),
    codeInput,
    el('div', { style: 'height:9px' }),
    el('button', { class: 'btn btn-ghost', text: 'Rejoindre',
      onClick: () => joinTeam(codeInput.value) }),
  ));

  if (myTeams.length === 0) {
    const teamInput = el('input', { class: 'form-input',
      attrs: { type: 'text', maxlength: '60', placeholder: 'Ex : Cardio 3e étage' } });
    blocks.push(el('div', { class: 'share-block' },
      el('div', { class: 'share-title', text: 'Ou créer le tien' }),
      teamInput,
      el('div', { style: 'height:9px' }),
      el('button', { class: 'btn btn-primary', text: 'Créer le service',
        onClick: () => createTeam(teamInput.value) }),
    ));
  }

  replaceChildren(sheet,
    el('div', { class: 'sheet-handle' }),
    el('div', { class: 'sheet-header' },
      el('h3', { text: 'Mon service' }),
      el('div', { class: 'sheet-date', text:
        'Chacun voit les shifts des autres, en lecture seule. Les événements perso restent privés.' }),
    ),
    el('div', { class: 'modal-content' },
      ...blocks,
      el('div', { style: 'height:6px' }),
      el('button', { class: 'btn btn-ghost', text: 'Fermer', onClick: closeShareSheet }),
    ),
  );
}

async function openShareSheet() {
  closeAllSheets();
  pendingCode = null;
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
  pendingCode = null;
}
