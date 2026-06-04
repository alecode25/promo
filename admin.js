/* ================================================
   CLUB 1 PIANO — ADMIN JS
   ================================================ */

const API = 'https://offerte-uxp3.onrender.com';
let adminSecret    = '';
let storageConfig  = null;  // { url, anonKey, bucket }

// ============================
// AUTH
// ============================
async function adminLogin() {
  const pwd = document.getElementById('admin-pwd').value.trim();
  const err = document.getElementById('login-err');
  err.classList.add('hidden');
  if (!pwd) { showErr(err, 'Inserisci la password'); return; }

  try {
    const res = await fetch(API + '/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd }),
    });
    if (!res.ok) { showErr(err, 'Password errata'); return; }
    adminSecret = pwd;
    sessionStorage.setItem('admin_secret', pwd);
    showDashboard();
  } catch(e) {
    showErr(err, 'Server non raggiungibile');
  }
}

function adminLogout() {
  sessionStorage.removeItem('admin_secret');
  adminSecret    = '';
  storageConfig  = null;
  document.getElementById('admin-dashboard').classList.add('hidden');
  document.getElementById('admin-login').classList.remove('hidden');
  document.getElementById('admin-pwd').value = '';
}

async function showDashboard() {
  document.getElementById('admin-login').classList.add('hidden');
  document.getElementById('admin-dashboard').classList.remove('hidden');
  await loadStorageConfig();
  loadOffers();
  loadUsers();
}

// ============================
// SIDEBAR (mobile)
// ============================
function toggleSidebar() {
  const sb  = document.getElementById('sidebar');
  const bd  = document.getElementById('sidebar-backdrop');
  const open = sb.classList.toggle('open');
  bd.classList.toggle('show', open);
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('show');
}

// ============================
// TABS
// ============================
function switchTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.remove('hidden');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  closeSidebar();
}

// ============================
// STORAGE CONFIG
// ============================
async function loadStorageConfig() {
  try {
    const res = await adminFetch('/api/admin/storage-config');
    if (res.ok) storageConfig = await res.json();
  } catch(e) { /* non bloccante */ }
}

// ============================
// IMAGE UPLOAD
// ============================
function triggerFilePick() {
  document.getElementById('f-img-file').click();
}

async function uploadImage(file) {
  if (!storageConfig) { toast('Config storage non disponibile'); return null; }
  if (file.size > 5 * 1024 * 1024) { toast('Immagine troppo grande (max 5 MB)'); return null; }

  const ext      = file.name.split('.').pop().toLowerCase();
  const filename = `offer-${Date.now()}.${ext}`;
  const uploadUrl = `${storageConfig.url}/storage/v1/object/${storageConfig.bucket}/${filename}`;

  // mostra progress bar
  const wrap = document.getElementById('img-progress-wrap');
  const bar  = document.getElementById('img-progress-bar');
  wrap.classList.remove('hidden');
  bar.style.width = '0%';

  // animazione fake progress
  let prog = 0;
  const tick = setInterval(() => { prog = Math.min(prog + 10, 85); bar.style.width = prog + '%'; }, 100);

  try {
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${storageConfig.anonKey}`,
        'Content-Type':  file.type,
        'x-upsert':      'true',
      },
      body: file,
    });

    clearInterval(tick);

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      bar.style.width = '0%';
      wrap.classList.add('hidden');
      toast('Upload fallito: ' + (d.message || res.status));
      return null;
    }

    bar.style.width = '100%';
    setTimeout(() => wrap.classList.add('hidden'), 500);

    return `${storageConfig.url}/storage/v1/object/public/${storageConfig.bucket}/${filename}`;
  } catch(e) {
    clearInterval(tick);
    wrap.classList.add('hidden');
    toast('Errore upload');
    return null;
  }
}

function setImagePreview(url) {
  const preview = document.getElementById('f-img-preview');
  if (url) {
    preview.innerHTML = `
      <img src="${url}" onerror="this.parentElement.classList.add('hidden')">
      <button class="img-preview-remove" onclick="clearImage()" title="Rimuovi"><i class="ti ti-x"></i></button>
    `;
    preview.classList.remove('hidden');
  } else {
    preview.classList.add('hidden');
    preview.innerHTML = '';
  }
}

function clearImage() {
  document.getElementById('f-img').value = '';
  document.getElementById('f-img-file').value = '';
  setImagePreview(null);
}

// ============================
// INIT
// ============================
document.addEventListener('DOMContentLoaded', () => {
  const saved = sessionStorage.getItem('admin_secret');
  if (saved) { adminSecret = saved; showDashboard(); }

  document.getElementById('admin-pwd').addEventListener('keydown', e => {
    if (e.key === 'Enter') adminLogin();
  });

  // Aggiorna preview quando si incolla URL manualmente
  document.getElementById('f-img').addEventListener('input', e => {
    setImagePreview(e.target.value.trim() || null);
  });

  // File picker — upload da galleria
  document.getElementById('f-img-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    toast('Caricamento in corso…');
    const url = await uploadImage(file);
    if (url) {
      document.getElementById('f-img').value = url;
      setImagePreview(url);
      toast('Immagine caricata ✓');
    }
  });

  // Drag & drop (desktop)
  const area = document.getElementById('img-upload-area');
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', async e => {
    e.preventDefault();
    area.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const url = await uploadImage(file);
    if (url) {
      document.getElementById('f-img').value = url;
      setImagePreview(url);
      toast('Immagine caricata ✓');
    }
  });
});

// ============================
// OFFERS
// ============================
let allOffers = [];

async function loadOffers() {
  try {
    const res = await adminFetch('/api/admin/offers');
    allOffers = await res.json();
    renderOffersTable(allOffers.filter(o => o.category !== 'evento'), 'offers-tbody');
    renderOffersTable(allOffers.filter(o => o.category === 'evento'), 'events-tbody');
  } catch(e) { toast('Errore caricamento offerte'); }
}

function renderOffersTable(items, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px">Nessun elemento</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(o => {
    const expired = o.expiry_date && new Date(o.expiry_date) < new Date();
    const expiryLabel = o.expiry_date
      ? new Date(o.expiry_date).toLocaleString('it', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
      : '—';
    return `
    <tr>
      <td>${o.name}</td>
      <td><span class="badge badge--cat">${o.category}</span></td>
      <td>${o.price}</td>
      <td>
        <span class="badge ${expired ? 'badge--off' : o.active ? 'badge--on' : 'badge--off'}">
          ${expired ? '⏰ Scaduta' : o.active ? 'Attiva' : 'Inattiva'}
        </span>
      </td>
      <td style="font-size:12px;color:var(--text-muted)">${expiryLabel}</td>
      <td>
        <div class="row-actions">
          <button class="icon-action" onclick="editOffer(${o.id})" title="Modifica"><i class="ti ti-pencil"></i></button>
          <button class="icon-action del" onclick="deleteOffer(${o.id})" title="Elimina"><i class="ti ti-trash"></i></button>
        </div>
      </td>
    </tr>
  `}).join('');
}

// ============================
// MODAL OFFERTA
// ============================
let editingId = null;

function openOfferModal(defaultCategory = 'drink') {
  editingId = null;
  document.getElementById('modal-title').textContent = defaultCategory === 'evento' ? 'Nuovo evento' : 'Nuova offerta';
  document.getElementById('f-id').value          = '';
  document.getElementById('f-name').value        = '';
  document.getElementById('f-category').value    = defaultCategory;
  document.getElementById('f-tag').value         = '';
  document.getElementById('f-price').value       = '';
  document.getElementById('f-orig').value        = '';
  document.getElementById('f-expiry-date').value = '';
  document.getElementById('f-desc').value        = '';
  document.getElementById('f-img').value         = '';
  document.getElementById('f-img-file').value    = '';
  document.getElementById('f-order').value       = '0';
  document.getElementById('f-active').checked    = true;
  document.getElementById('modal-err').classList.add('hidden');
  document.getElementById('modal-save-btn').textContent = 'Crea';
  setImagePreview(null);
  document.getElementById('offer-modal').classList.remove('hidden');
}

function editOffer(id) {
  const o = allOffers.find(x => x.id === id);
  if (!o) return;
  editingId = id;
  document.getElementById('modal-title').textContent  = 'Modifica ' + (o.category === 'evento' ? 'evento' : 'offerta');
  document.getElementById('f-id').value          = o.id;
  document.getElementById('f-name').value        = o.name;
  document.getElementById('f-category').value    = o.category;
  document.getElementById('f-tag').value         = o.tag || '';
  document.getElementById('f-price').value       = o.price;
  document.getElementById('f-orig').value        = o.original_price || '';
  document.getElementById('f-expiry-date').value = o.expiry_date ? o.expiry_date.slice(0,16) : '';
  document.getElementById('f-desc').value        = o.description;
  document.getElementById('f-img').value         = o.image_url || '';
  document.getElementById('f-order').value       = o.sort_order ?? 0;
  document.getElementById('f-active').checked    = o.active;
  document.getElementById('modal-err').classList.add('hidden');
  document.getElementById('modal-save-btn').textContent = 'Salva';
  setImagePreview(o.image_url || null);
  document.getElementById('offer-modal').classList.remove('hidden');
}

function closeOfferModal(event) {
  if (!event) { document.getElementById('offer-modal').classList.add('hidden'); return; }
  if (event.target === document.getElementById('offer-modal')) {
    document.getElementById('offer-modal').classList.add('hidden');
  }
}

async function saveOffer() {
  const err = document.getElementById('modal-err');
  err.classList.add('hidden');

  const payload = {
    name:           document.getElementById('f-name').value.trim(),
    category:       document.getElementById('f-category').value,
    tag:            document.getElementById('f-tag').value.trim(),
    price:          document.getElementById('f-price').value.trim(),
    original_price: document.getElementById('f-orig').value.trim() || null,
    expiry_date:    document.getElementById('f-expiry-date').value || null,
    description:    document.getElementById('f-desc').value.trim(),
    image_url:      document.getElementById('f-img').value.trim() || null,
    sort_order:     parseInt(document.getElementById('f-order').value) || 0,
    active:         document.getElementById('f-active').checked,
  };

  if (!payload.name || !payload.description || !payload.price) {
    showErr(err, 'Nome, descrizione e prezzo sono obbligatori');
    return;
  }

  const btn = document.getElementById('modal-save-btn');
  btn.disabled = true;
  btn.textContent = 'Salvataggio…';

  try {
    const url    = editingId ? `/api/admin/offers/${editingId}` : '/api/admin/offers';
    const method = editingId ? 'PUT' : 'POST';
    const res    = await adminFetch(url, method, payload);
    if (!res.ok) { const d = await res.json(); showErr(err, d.error || 'Errore'); return; }
    closeOfferModal();
    await loadOffers();
    toast(editingId ? 'Offerta aggiornata ✓' : 'Offerta creata ✓');
  } catch(e) {
    showErr(err, 'Errore di rete');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salva';
  }
}

async function deleteOffer(id) {
  if (!confirm('Eliminare questa offerta?')) return;
  try {
    await adminFetch(`/api/admin/offers/${id}`, 'DELETE');
    await loadOffers();
    toast('Offerta eliminata');
  } catch(e) { toast('Errore eliminazione'); }
}

// ============================
// PUSH
// ============================
async function sendPush() {
  const title  = document.getElementById('push-title').value.trim();
  const body   = document.getElementById('push-body').value.trim();
  const url    = document.getElementById('push-url').value.trim() || '/';
  const result = document.getElementById('push-result');
  result.classList.add('hidden');

  if (!title || !body) { toast('Titolo e messaggio obbligatori'); return; }

  try {
    const r = await adminFetch('/api/push/send', 'POST', { title, body, url });
    const d = await r.json();
    if (!r.ok) {
      result.className = 'push-result err';
      result.textContent = d.error;
      result.classList.remove('hidden');
      return;
    }
    result.className = 'push-result ok';
    result.textContent = `Inviata a ${d.sent}/${d.total} dispositivi`;
    result.classList.remove('hidden');
    toast('Notifica inviata ✓');
  } catch(e) { toast('Errore invio'); }
}

// ============================
// USERS
// ============================
async function loadUsers() {
  try {
    const res   = await adminFetch('/api/admin/users');
    const users = await res.json();
    const tbody = document.getElementById('users-tbody');
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px">Nessun utente</td></tr>';
      return;
    }
    tbody.innerHTML = users.map(u => `
      <tr>
        <td>${u.nome} ${u.cognome}</td>
        <td style="font-size:12px">${u.email || '—'}</td>
        <td>${u.punti}</td>
        <td>${u.visite}</td>
        <td>${u.referral_count || 0}</td>
        <td style="color:var(--text-muted);font-size:12px">${u.created_at ? new Date(u.created_at).toLocaleDateString('it') : '—'}</td>
      </tr>
    `).join('');
  } catch(e) { /* silenzioso */ }
}

// ============================
// HELPERS
// ============================
function adminFetch(path, method = 'GET', body = null) {
  return fetch(API + path, {
    method,
    headers: {
      'x-admin-secret': adminSecret,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function showErr(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('a-toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
