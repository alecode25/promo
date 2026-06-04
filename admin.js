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
  loadWaiters();
}

// ============================
// ADMIN SCANNER
// ============================
let adminScanVideo   = null;
let adminScanCanvas  = null;
let adminScanCtx     = null;
let adminScanning    = false;
let adminScannedUid  = null;

function toggleAdminScanner() {
  const btn      = document.getElementById('admin-scan-toggle');
  const camArea  = document.getElementById('admin-cam-area');
  const result   = document.getElementById('admin-scan-result');

  if (adminScanning || adminScanVideo?.srcObject) {
    stopAdminScanner();
    btn.innerHTML = '<i class="ti ti-camera"></i> Avvia fotocamera';
    camArea.classList.add('hidden');
    result.classList.add('hidden');
    return;
  }

  camArea.classList.remove('hidden');
  result.classList.add('hidden');
  btn.innerHTML = '<i class="ti ti-camera-off"></i> Ferma fotocamera';
  startAdminCamera();
}

async function startAdminCamera() {
  adminScanVideo  = document.getElementById('admin-scan-video');
  adminScanCanvas = document.getElementById('admin-scan-canvas');
  adminScanCtx    = adminScanCanvas.getContext('2d', { willReadFrequently: true });

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    adminScanVideo.srcObject = stream;
    await adminScanVideo.play();
    await new Promise(res => {
      if (adminScanVideo.readyState >= 2) { res(); return; }
      adminScanVideo.addEventListener('loadeddata', res, { once: true });
    });
    adminScanCanvas.width  = adminScanVideo.videoWidth  || 640;
    adminScanCanvas.height = adminScanVideo.videoHeight || 480;
    adminScanning = true;
    requestAnimationFrame(adminScanLoop);
  } catch(e) {
    toast('Fotocamera non disponibile: ' + (e.message || 'errore'));
    document.getElementById('admin-cam-area').classList.add('hidden');
    document.getElementById('admin-scan-toggle').innerHTML = '<i class="ti ti-camera"></i> Avvia fotocamera';
  }
}

function stopAdminScanner() {
  adminScanning = false;
  if (adminScanVideo?.srcObject) {
    adminScanVideo.srcObject.getTracks().forEach(t => t.stop());
    adminScanVideo.srcObject = null;
  }
  adminScannedUid = null;
}

function adminScanLoop() {
  if (!adminScanning) return;
  if (adminScanVideo.readyState >= adminScanVideo.HAVE_ENOUGH_DATA) {
    adminScanCtx.drawImage(adminScanVideo, 0, 0, adminScanCanvas.width, adminScanCanvas.height);
    const img  = adminScanCtx.getImageData(0, 0, adminScanCanvas.width, adminScanCanvas.height);
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    if (code?.data?.startsWith('club1piano:')) {
      adminScanning = false;
      handleAdminQR(code.data);
      return;
    }
  }
  requestAnimationFrame(adminScanLoop);
}

async function handleAdminQR(qrData) {
  const hint = document.getElementById('admin-scan-hint');
  hint.textContent = 'QR rilevato — verifica…';

  try {
    const res  = await adminFetch('/api/scanner/validate', 'POST', { qr_data: qrData });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'QR non valido');
      hint.textContent = 'Punta la fotocamera sul QR dell\'utente';
      adminScanning = true;
      requestAnimationFrame(adminScanLoop);
      return;
    }
    adminScannedUid = data.user_id;
    showAdminScanResult(data.profile);
  } catch(e) {
    toast('Errore di rete');
    hint.textContent = 'Punta la fotocamera sul QR dell\'utente';
    adminScanning = true;
    requestAnimationFrame(adminScanLoop);
  }
}

function showAdminScanResult(profile) {
  const nome    = profile.nome    || 'Utente';
  const cognome = profile.cognome || '';
  const full    = nome + (cognome ? ' ' + cognome : '');
  const initials = (nome[0] || '') + (cognome[0] || '');
  const level = (profile.punti || 0) >= 1000 ? 'Platinum' : (profile.punti || 0) >= 300 ? 'Gold' : 'Silver';

  document.getElementById('asr-avatar').textContent = initials.toUpperCase() || '?';
  document.getElementById('asr-name').textContent   = full;
  document.getElementById('asr-level').textContent  = '✦ Membro ' + level;
  document.getElementById('asr-pts').textContent    = profile.punti  || 0;
  document.getElementById('asr-visits').textContent = profile.visite || 0;
  document.getElementById('asr-amount').value = '';
  document.getElementById('admin-scan-result').classList.remove('hidden');
}

function cancelAdminScan() {
  adminScannedUid = null;
  document.getElementById('admin-scan-result').classList.add('hidden');
  document.getElementById('admin-scan-hint').textContent = 'Punta la fotocamera sul QR dell\'utente';
  adminScanning = true;
  requestAnimationFrame(adminScanLoop);
}

async function confirmAdminCheckin() {
  if (!adminScannedUid) return;
  const amount = parseFloat(document.getElementById('asr-amount').value) || 0;
  const btn    = document.getElementById('asr-confirm-btn');
  btn.disabled = true; btn.textContent = 'Salvataggio…';

  try {
    const res  = await adminFetch('/api/scanner/checkin', 'POST', { user_id: adminScannedUid, amount_spent: amount });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Errore'); return; }
    toast(amount > 0 ? `Check-in confermato ✓  +${Math.round(amount)} pt` : 'Check-in confermato ✓');
    document.getElementById('admin-scan-result').classList.add('hidden');
    adminScannedUid = null;
    document.getElementById('admin-scan-hint').textContent = 'Punta la fotocamera sul QR dell\'utente';
    adminScanning = true;
    requestAnimationFrame(adminScanLoop);
  } catch(e) {
    toast('Errore di rete');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> Conferma check-in';
  }
}

// ============================
// WAITERS
// ============================
async function loadWaiters() {
  try {
    const res    = await adminFetch('/api/admin/waiters');
    const waiters = await res.json();
    const tbody  = document.getElementById('waiters-tbody');
    if (!waiters.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px">Nessun cameriere</td></tr>';
      return;
    }
    tbody.innerHTML = waiters.map(w => `
      <tr>
        <td>${w.name}</td>
        <td style="font-size:12px;color:var(--text-muted)">${w.username}</td>
        <td>
          <span class="badge ${w.active ? 'badge--on' : 'badge--off'}">
            ${w.active ? 'Attivo' : 'Disabilitato'}
          </span>
        </td>
        <td style="font-size:12px;color:var(--text-muted)">${w.created_at ? new Date(w.created_at).toLocaleDateString('it') : '—'}</td>
        <td>
          <div class="row-actions">
            <button class="icon-action" onclick="toggleWaiter('${w.id}')" title="${w.active ? 'Disabilita' : 'Attiva'}">
              <i class="ti ${w.active ? 'ti-eye-off' : 'ti-eye'}"></i>
            </button>
            <button class="icon-action del" onclick="deleteWaiter('${w.id}')" title="Elimina">
              <i class="ti ti-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch(e) { toast('Errore caricamento camerieri'); }
}

function openWaiterModal() {
  document.getElementById('w-name').value     = '';
  document.getElementById('w-username').value = '';
  document.getElementById('w-password').value = '';
  document.getElementById('waiter-modal-err').classList.add('hidden');
  document.getElementById('waiter-save-btn').textContent = 'Crea';
  document.getElementById('waiter-modal').classList.remove('hidden');
}
function closeWaiterModal(event) {
  if (!event || event.target === document.getElementById('waiter-modal'))
    document.getElementById('waiter-modal').classList.add('hidden');
}

async function saveWaiter() {
  const name     = document.getElementById('w-name').value.trim();
  const username = document.getElementById('w-username').value.trim();
  const password = document.getElementById('w-password').value;
  const err      = document.getElementById('waiter-modal-err');
  const btn      = document.getElementById('waiter-save-btn');
  err.classList.add('hidden');
  if (!name || !username || !password) { showErr(err, 'Tutti i campi sono obbligatori'); return; }

  btn.disabled = true; btn.textContent = 'Creazione…';
  try {
    const res  = await adminFetch('/api/admin/waiters', 'POST', { name, username, password });
    const data = await res.json();
    if (!res.ok) { showErr(err, data.error || 'Errore'); return; }
    document.getElementById('waiter-modal').classList.add('hidden');
    await loadWaiters();
    toast('Cameriere creato ✓');
  } catch(e) {
    showErr(err, 'Errore di rete');
  } finally {
    btn.disabled = false; btn.textContent = 'Crea';
  }
}

async function toggleWaiter(id) {
  try {
    const res  = await adminFetch(`/api/admin/waiters/${id}/toggle`, 'PATCH');
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Errore'); return; }
    await loadWaiters();
    toast(data.active ? 'Cameriere attivato ✓' : 'Cameriere disabilitato');
  } catch(e) { toast('Errore di rete'); }
}

async function deleteWaiter(id) {
  if (!confirm('Eliminare questo cameriere?')) return;
  try {
    await adminFetch(`/api/admin/waiters/${id}`, 'DELETE');
    await loadWaiters();
    toast('Cameriere eliminato');
  } catch(e) { toast('Errore eliminazione'); }
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
  // Stop admin scanner if leaving scanner tab
  if (tab !== 'scanner' && (adminScanning || adminScanVideo?.srcObject)) {
    stopAdminScanner();
    const camArea = document.getElementById('admin-cam-area');
    const result  = document.getElementById('admin-scan-result');
    if (camArea) camArea.classList.add('hidden');
    if (result)  result.classList.add('hidden');
    const toggleBtn = document.getElementById('admin-scan-toggle');
    if (toggleBtn) toggleBtn.innerHTML = '<i class="ti ti-camera"></i> Avvia fotocamera';
  }
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

  // Waiter modal: Enter on password
  document.getElementById('w-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveWaiter();
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
