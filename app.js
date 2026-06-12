/* ================================================
   CLUB 1 PIANO — APP JS
   ================================================ */

// URL del backend su Render — cambia con il tuo URL
const API = 'https://offerte-uxp3.onrender.com';

// ===== STATO UTENTE =====
let currentUser = null;
let userProfile = null;
let isGuest     = false;

// ===== OFFERTE (dal server) =====
let OFFERS = [];

// ===== LIVELLI =====
const LEVELS = [
  { name: 'Silver',   min: 0,    max: 300,  next: 'Gold' },
  { name: 'Gold',     min: 300,  max: 1000, next: 'Platinum' },
  { name: 'Platinum', min: 1000, max: 9999, next: null },
];
function getLevel(pts) {
  return LEVELS.find(l => pts >= l.min && pts < l.max) || LEVELS[LEVELS.length - 1];
}

// ===== NAVIGAZIONE =====
let currentScreen = 'screen-home';
let screenHistory = [];

function goTo(screenId) {
  if (screenId === currentScreen) return;
  screenHistory.push(currentScreen);
  _activateScreen(screenId);
}
function goBack() {
  const prev = screenHistory.pop();
  if (prev) _activateScreen(prev);
}
function _activateScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  currentScreen = screenId;
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.screen === screenId);
  });
  if (screenId === 'screen-qr') { renderOfferQRsOnScreen(); syncRedeemedOffers(); }
  window.scrollTo(0, 0);
}

// ===== AUTH =====
let _refreshPromise = null;

async function _doRefresh() {
  if (!_refreshPromise) {
    _refreshPromise = fetch(API + '/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: localStorage.getItem('club1_refresh') }),
    }).then(async r => {
      if (r.ok) {
        const { accessToken, refreshToken } = await r.json();
        localStorage.setItem('club1_token', accessToken);
        if (refreshToken) localStorage.setItem('club1_refresh', refreshToken);
        return accessToken;
      }
      return null;
    }).finally(() => { _refreshPromise = null; });
  }
  return _refreshPromise;
}

async function authFetch(url, opts = {}) {
  const makeReq = (token) => fetch(API + url, {
    ...opts,
    credentials: 'include',
    headers: {
      ...(opts.headers || {}),
      ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
    },
  });

  let token = localStorage.getItem('club1_token');
  let res = await makeReq(token);

  if (res.status === 401) {
    const newToken = await _doRefresh();
    if (newToken) {
      res = await makeReq(newToken);
    } else {
      // Refresh fallito — sessione scaduta
      localStorage.removeItem('club1_session');
      localStorage.removeItem('club1_token');
      localStorage.removeItem('club1_cached_offers');
      window.location.replace('login.html');
      // Blocca esecuzione: restituisci risposta "pending" che non verrà processata
      return new Response(JSON.stringify({ error: 'Sessione scaduta' }), { status: 401 });
    }
  }

  return res;
}

async function handleLogout() {
  localStorage.removeItem('club1_session');
  localStorage.removeItem('club1_token');
  localStorage.removeItem('club1_refresh');
  localStorage.removeItem('club1_cached_offers');
  await fetch(API + '/api/auth/logout', { method: 'POST', credentials: 'include' });
  currentUser = null;
  userProfile = null;
  window.location.replace('login.html');
}

function requireAuth(fn) {
  if (isGuest) { showToast('Accedi per usare questa funzione'); return; }
  fn();
}

// ===== ENTER APP =====
async function enterApp() {
  document.getElementById('app').classList.remove('hidden');
  await loadOffers();
  if (isGuest) {
    applyGuestMode();
  } else {
    updateUI();
    registerServiceWorker();
    checkPushStatus();
    loadInvitesSent();
    checkPendingInvites();
    populateEditForm();
    fetchRedeemedFromServer(); // scarica offerte già riscattate (dopo logout/nuovo device)
    syncRedeemedOffers();      // aggiorna token esistenti in localStorage
  }
  renderHomeOffers();
  renderOfferList('all');
  initFilters();
  setGreeting();
}

async function loadOffers() {
  // Mostra cache subito (zero attesa)
  const cached = localStorage.getItem('club1_cached_offers');
  if (cached) {
    try {
      OFFERS = JSON.parse(cached);
      renderHomeOffers();
      renderOfferList('all');
      renderOfferQRsOnScreen();
    } catch (e) { localStorage.removeItem('club1_cached_offers'); }
  }

  // Fetch dati freschi in background
  try {
    const res = await fetch(API + '/api/offers');
    if (res.ok) {
      const data = await res.json();
      OFFERS = data.map(o => ({
        id:        o.id,
        category:  o.category,
        tag:       o.tag,
        name:      o.name,
        desc:      o.description,
        price:     o.price,
        orig:      o.original_price,
        expiry_date: o.expiry_date,
        active:    o.active,
        image_url: o.image_url || null,
      }));
      localStorage.setItem('club1_cached_offers', JSON.stringify(OFFERS));
      renderHomeOffers();
      renderOfferList('all');
      renderOfferQRsOnScreen();
    }
  } catch(e) {
    console.warn('Offerte non disponibili:', e);
  }
}

// ===== GUEST MODE =====
function applyGuestMode() {
  const heroCard = document.querySelector('.hero-card');
  if (heroCard) {
    heroCard.style.pointerEvents = 'none';
    heroCard.style.position = 'relative';
    heroCard.insertAdjacentHTML('beforeend', `
      <div class="guest-lock-overlay">
        <div class="guest-lock-box">
          <div class="guest-lock-icon">🔒</div>
          <div class="guest-lock-title">Accedi per vedere i tuoi punti</div>
          <button class="guest-lock-btn" onclick="goToLogin()">Accedi o registrati</button>
        </div>
      </div>
    `);
  }
  const qrScreen = document.getElementById('screen-qr');
  if (qrScreen) {
    qrScreen.insertAdjacentHTML('beforeend', `
      <div class="guest-screen-lock">
        <div class="guest-lock-box">
          <div class="guest-lock-icon">🎫</div>
          <div class="guest-lock-title">QR riservato ai soci</div>
          <div class="guest-lock-sub">Crea un account gratuito per accedere alla tessera digitale e alle offerte esclusive.</div>
          <button class="guest-lock-btn" onclick="goToLogin()">Accedi o registrati</button>
        </div>
      </div>
    `);
  }
  const accScreen = document.getElementById('screen-account');
  if (accScreen) {
    accScreen.insertAdjacentHTML('beforeend', `
      <div class="guest-screen-lock">
        <div class="guest-lock-box">
          <div class="guest-lock-icon">👤</div>
          <div class="guest-lock-title">Area riservata ai soci</div>
          <div class="guest-lock-sub">Registrati per tenere traccia dei tuoi punti, visite e offerte usate.</div>
          <button class="guest-lock-btn" onclick="goToLogin()">Accedi o registrati</button>
        </div>
      </div>
    `);
  }
  const greet = document.getElementById('greeting-text');
  if (greet) greet.textContent = 'Benvenuto 👋';
}

function goToLogin() {
  sessionStorage.removeItem('guest_mode');
  window.location.replace('login.html');
}

// ===== UI =====
function updateUI() {
  if (!userProfile) return;
  const nome     = userProfile.nome || 'Utente';
  const cognome  = userProfile.cognome || '';
  const fullname = nome + (cognome ? ' ' + cognome : '');
  const initials = (nome[0] || '') + (cognome[0] || '');
  const pts      = userProfile.punti || 0;
  const lv       = getLevel(pts);
  const pct      = lv.max < 9999 ? Math.round(((pts - lv.min) / (lv.max - lv.min)) * 100) : 100;
  const nextLabel = lv.next ? `${lv.max - pts} pt → ${lv.next}` : 'Livello massimo 🏆';

  setText('hero-points', pts);
  setText('hero-level', lv.name);
  setStyle('hero-progress-fill', 'width', pct + '%');
  setText('hero-progress-label', lv.next ? `${lv.max - pts} pt al livello ${lv.next}` : 'Livello massimo 🏆');

  setText('qr-fullname', fullname);
  setText('qr-avatar', initials || '?');

  setText('acc-avatar', initials || '?');
  setText('acc-name', fullname);
  setText('acc-email', userProfile.email || '');
  setText('acc-badge', '✦ Membro ' + lv.name);
  setText('stat-pts', pts);
  setText('stat-visits', userProfile.visite || 0);
  setText('stat-used', userProfile.offerte_usate || 0);

  setGreeting();
  generateQR();
  updateRewardUI();
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function setStyle(id, prop, val) {
  const el = document.getElementById(id);
  if (el) el.style[prop] = val;
}

// ===== QR =====
function getQRPayload() {
  const uid = currentUser ? currentUser.id : 'guest';
  return `club1piano:${uid}`;
}
function _makeQR(containerId, text, size) {
  const el = document.getElementById(containerId);
  if (!el || typeof QRCode === 'undefined') return;
  el.innerHTML = '';
  new QRCode(el, { text, width: size, height: size, colorDark: '#0D0D0D', colorLight: '#FFFFFF', correctLevel: QRCode.CorrectLevel.M });
}

function generateQR() {
  _makeQR('qr-box', getQRPayload(), 176);
}

function refreshQR() {
  const box = document.getElementById('qr-box');
  const btn = document.getElementById('refresh-qr');
  box.style.opacity = '0.2';
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-refresh"></i> Aggiornamento…';
  setTimeout(() => {
    generateQR();
    box.style.opacity = '1';
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-refresh"></i> Aggiorna codice';
    showToast('Codice QR aggiornato ✓');
  }, 900);
}

// ===== OFFERTE RENDER =====
// Solo offerte confermate usate → spariscono da home/lista
function _getRedeemedOfferIds() {
  const raw = JSON.parse(localStorage.getItem(_offerTokensKey()) || '{}');
  return new Set(Object.entries(raw).filter(([, v]) => v.used).map(([id]) => Number(id)));
}

function renderHomeOffers() {
  const activated = isGuest ? new Set() : _getRedeemedOfferIds();
  const scroll = document.getElementById('offer-scroll');
  scroll.innerHTML = OFFERS.filter(o => o.active && !activated.has(o.id)).map(o => `
    <div class="offer-snap-card" onclick="openModal(${o.id})">
      ${o.image_url ? `<div class="offer-snap-img"><img src="${o.image_url}" alt="${o.name}" loading="lazy"></div>` : ''}
      <div class="offer-snap-tag">${o.tag}</div>
      <div class="offer-snap-badge">${capitalize(o.category)}</div>
      <div class="offer-snap-name">${o.name}</div>
      <div class="offer-snap-desc">${o.desc.split('.')[0]}.</div>
      <div>
        <span class="offer-snap-price">${o.price}</span>
        ${o.orig && o.price !== 'Gratis' ? `<span class="offer-snap-orig">${o.orig}</span>` : ''}
      </div>
      <button class="offer-snap-use-btn" onclick="event.stopPropagation();useOffer(${o.id})">
        <i class="ti ti-qrcode"></i> Usa QR
      </button>
    </div>
  `).join('');
}
function renderOfferList(filter = 'all') {
  const activated = isGuest ? new Set() : _getRedeemedOfferIds();
  const list  = document.getElementById('offer-list');
  const base  = filter === 'all' ? OFFERS : OFFERS.filter(o => o.category === filter);
  const items = base.filter(o => !activated.has(o.id));
  list.innerHTML = items.map(o => `
    <div class="offer-full-card${o.active ? '' : ' dimmed'}"${o.active ? ` onclick="openModal(${o.id})"` : ''}>
      ${o.image_url ? `<div class="offer-full-img"><img src="${o.image_url}" alt="${o.name}" loading="lazy"></div>` : ''}
      <div class="offer-full-top">
        <div class="offer-full-name">${o.name}</div>
        <div class="offer-full-chip">${capitalize(o.category)}</div>
      </div>
      <div class="offer-full-desc">${o.desc}</div>
      <div class="offer-full-footer">
        <div>
          <span class="offer-full-price">${o.price}</span>
          ${o.orig && o.price !== 'Gratis' ? `<span class="offer-full-orig">${o.orig}</span>` : ''}
        </div>
        ${o.active
          ? `<button class="offer-use-btn" onclick="event.stopPropagation();useOffer(${o.id})">Usa QR</button>`
          : `<span class="offer-coming-lbl">In arrivo</span>`}
      </div>
      ${o.expiry_date ? `<div class="offer-expiry">⏱ Scade il ${new Date(o.expiry_date).toLocaleDateString('it', {day:'2-digit',month:'2-digit',year:'numeric'})}</div>` : ''}
    </div>
  `).join('');
}
function initFilters() {
  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderOfferList(btn.dataset.filter);
    });
  });
}

// ===== MODAL =====
function openModal(offerId) {
  const o = OFFERS.find(x => x.id === offerId);
  if (!o) return;
  document.getElementById('modal-content').innerHTML = `
    ${o.image_url ? `<div class="modal-img"><img src="${o.image_url}" alt="${o.name}" loading="lazy"></div>` : ''}
    <div class="modal-eyebrow">${capitalize(o.category)} · ${o.tag}</div>
    <div class="modal-title">${o.name}</div>
    <div class="modal-desc">${o.desc}</div>
    <div class="modal-price-row">
      <span class="modal-price">${o.price}</span>
      ${o.orig && o.price !== 'Gratis' ? `<span class="modal-orig">${o.orig}</span>` : ''}
    </div>
    <button class="modal-cta" onclick="useOffer(${o.id})">Apri QR e usa l'offerta</button>
    ${o.expiry_date ? `<div class="modal-expiry">⏱ Scade il ${new Date(o.expiry_date).toLocaleDateString('it', {day:'2-digit',month:'2-digit',year:'numeric'})}</div>` : ''}
  `;
  document.getElementById('offer-modal').classList.remove('hidden');
}
function closeModal(event) {
  if (!event) { document.getElementById('offer-modal').classList.add('hidden'); return; }
  if (event.target === document.getElementById('offer-modal') || event.target.closest('.modal-close')) {
    document.getElementById('offer-modal').classList.add('hidden');
  }
}
function useOffer(id) {
  document.getElementById('offer-modal').classList.add('hidden');
  requireAuth(() => {
    goTo('screen-qr');
    openOfferQR(id);
  });
}

function _ensureQRLib() {
  if (typeof QRCode !== 'undefined') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/qrcode.min.js';
    s.onload  = resolve;
    s.onerror = () => reject(new Error('Libreria QR non caricata'));
    document.head.appendChild(s);
  });
}

async function openOfferQR(offerId) {
  const stored = JSON.parse(localStorage.getItem(_offerTokensKey()) || '{}');

  // Già usata → blocca
  if (stored[offerId]?.used) {
    showToast('Offerta già riscattata');
    return;
  }

  // Token già generato ma non usato → mostra QR esistente senza chiamare il server
  if (stored[offerId]?.token) {
    await _ensureQRLib();
    renderOfferQRsOnScreen();
    return;
  }

  const o = OFFERS.find(x => x.id === offerId);
  showToast('Generazione QR…');

  try {
    await _ensureQRLib();
    const res  = await authFetch(`/api/offers/${offerId}/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (res.status === 409) {
      // Offerta già riscattata — aggiorna localStorage e nascondi
      const raw = JSON.parse(localStorage.getItem(_offerTokensKey()) || '{}');
      raw[offerId] = { ...(raw[offerId] || { name: o?.name || '—', token: '', expiry_date: null }), used: true };
      localStorage.setItem(_offerTokensKey(), JSON.stringify(raw));
      renderHomeOffers();
      renderOfferList('all');
      showToast('Offerta già riscattata');
      return;
    }
    if (!res.ok) { showToast(data.error || 'Errore generazione QR'); return; }

    _saveOfferToken(offerId, o ? o.name : '—', data.token, o?.expiry_date || null);
    renderOfferQRsOnScreen();
  } catch(e) {
    console.error('[offerQR]', e);
    showToast(e.message || 'Errore QR');
  }
}

function closeOfferQR(event) {
  if (event && event.target !== document.getElementById('offer-qr-overlay')) return;
  document.getElementById('offer-qr-overlay').classList.add('hidden');
}

// ===== OFFER QR PERSISTENCE =====
function _offerTokensKey() { return 'club1_offer_tokens_' + (currentUser?.id || 'guest'); }

function _saveOfferToken(offerId, name, token, expiry_date) {
  const stored = JSON.parse(localStorage.getItem(_offerTokensKey()) || '{}');
  stored[offerId] = { name, token, expiry_date, used: stored[offerId]?.used || false };
  localStorage.setItem(_offerTokensKey(), JSON.stringify(stored));
}

function _removeOfferToken(offerId) {
  const stored = JSON.parse(localStorage.getItem(_offerTokensKey()) || '{}');
  delete stored[offerId];
  localStorage.setItem(_offerTokensKey(), JSON.stringify(stored));
  renderOfferQRsOnScreen();
}

function renderOfferQRsOnScreen() {
  const section = document.getElementById('qr-offers-section');
  const hint    = document.getElementById('qr-offer-hint');
  if (!section) return;

  const raw = JSON.parse(localStorage.getItem(_offerTokensKey()) || '{}');

  // rimuovi scaduti (controlla expiry salvato + offerta corrente)
  const now = Date.now();
  let changed = false;
  Object.entries(raw).forEach(([id, v]) => {
    const offer = OFFERS.find(o => o.id == id);
    const offerExpiry = v.expiry_date || offer?.expiry_date;
    const gone = !offer || (offerExpiry && new Date(offerExpiry) < now) || offer?.active === false;
    if (gone) { delete raw[id]; changed = true; }
  });
  if (changed) localStorage.setItem(_offerTokensKey(), JSON.stringify(raw));

  const entries = Object.entries(raw);

  if (!entries.length) {
    section.innerHTML = '';
    if (hint) hint.classList.remove('hidden');
    return;
  }

  if (hint) hint.classList.add('hidden');

  section.innerHTML = entries.map(([id, { name, token, used }]) => used ? `
    <div class="qr-offer-card qr-offer-card--used" id="qr-offer-card-${id}">
      <button class="qr-offer-card-remove" onclick="_removeOfferToken(${id})" title="Rimuovi">
        <i class="ti ti-x"></i>
      </button>
      <div class="qr-used-stamp">USATA</div>
      <div class="qr-used-icon"><i class="ti ti-circle-check"></i></div>
      <div class="qr-used-title">Offerta Riscattata</div>
      <div class="qr-used-name">${name}</div>
      <div class="qr-used-sub">Questa offerta è già stata utilizzata</div>
    </div>
  ` : `
    <div class="qr-offer-card" id="qr-offer-card-${id}">
      <div class="qr-offer-card-header">
        <div class="qr-offer-card-name"><i class="ti ti-tag"></i> ${name}</div>
        <button class="qr-offer-card-remove" onclick="_removeOfferToken(${id})" title="Rimuovi">
          <i class="ti ti-x"></i>
        </button>
      </div>
      <div class="qr-offer-box-wrap">
        <div class="qr-offer-box" id="qr-offer-box-${id}"></div>
      </div>
      <div class="qr-hint">Mostra al cameriere per riscattare</div>
    </div>
  `).join('');

  // genera QR solo per offerte non ancora usate
  if (typeof QRCode === 'undefined') return;
  entries.forEach(([id, { token, used }]) => {
    if (used) return;
    const el = document.getElementById(`qr-offer-box-${id}`);
    if (el) new QRCode(el, { text: `club1piano-offer:${token}`, width: 176, height: 176, colorDark: '#0D0D0D', colorLight: '#FFFFFF', correctLevel: QRCode.CorrectLevel.M });
  });
}

// Scarica dal server tutte le offerte già riscattate (utile dopo logout/login o nuovo device)
async function fetchRedeemedFromServer() {
  if (isGuest) return;
  try {
    const res = await authFetch('/api/offers/my-redemptions');
    if (!res.ok) return;
    const redemptions = await res.json();
    if (!redemptions.length) return;
    const raw = JSON.parse(localStorage.getItem(_offerTokensKey()) || '{}');
    let changed = false;
    redemptions.forEach(({ offer_id, token }) => {
      if (!raw[offer_id] || !raw[offer_id].used) {
        const name = OFFERS.find(o => o.id === offer_id)?.name || '—';
        raw[offer_id] = { name, token, expiry_date: null, used: true };
        changed = true;
      }
    });
    if (changed) {
      localStorage.setItem(_offerTokensKey(), JSON.stringify(raw));
      renderHomeOffers();
      renderOfferList('all');
    }
  } catch(e) {}
}

async function syncRedeemedOffers() {
  if (isGuest) return;
  const raw = JSON.parse(localStorage.getItem(_offerTokensKey()) || '{}');
  const tokens = Object.values(raw).map(v => v.token).filter(Boolean);
  if (!tokens.length) return;
  try {
    const res = await authFetch('/api/offers/check-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens }),
    });
    if (!res.ok) return;
    const { used } = await res.json();
    if (!used?.length) return;
    let changed = false;
    Object.entries(raw).forEach(([id, v]) => {
      if (used.includes(v.token) && !v.used) { raw[id] = { ...v, used: true }; changed = true; }
    });
    if (changed) {
      localStorage.setItem(_offerTokensKey(), JSON.stringify(raw));
      renderOfferQRsOnScreen();
      renderHomeOffers();
      renderOfferList('all');
    }
  } catch(e) {}
}

// ===== SERVICE WORKER =====
let swRegistration = null;
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js');
  } catch(e) { console.warn('Service worker non registrato:', e); }
}

// ===== PUSH =====
let pushGranted = false;

function checkPushStatus() {
  if (!('Notification' in window)) return;
  const granted = Notification.permission === 'granted';
  pushGranted = granted;
  updatePushUI(granted);
  const dot = document.getElementById('notif-dot');
  if (dot) dot.style.display = granted ? 'none' : 'block';
}

async function requestPushPermission() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    showToast('Notifiche non supportate su questo browser');
    return;
  }
  if (Notification.permission === 'granted') { showToast('Notifiche già attive ✓'); return; }

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { showToast('Permesso notifiche negato'); return; }

  pushGranted = true;
  updatePushUI(true);
  const dot = document.getElementById('notif-dot');
  if (dot) dot.style.display = 'none';
  await subscribeToPush();
  showToast('Notifiche attivate ✓');
}

async function subscribeToPush() {
  try {
    if (!swRegistration) await registerServiceWorker();
    if (!swRegistration) return;
    const res = await fetch(API + '/api/push/vapid-public-key');
    if (!res.ok) return;
    const { key } = await res.json();
    const subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    await fetch(API + '/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription }),
    });
  } catch(e) { console.warn('Subscription push fallita:', e); }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function updatePushUI(active) {
  const btn = document.getElementById('notif-toggle-btn');
  const sub = document.getElementById('notif-status-text');
  if (btn) { btn.textContent = active ? 'Attive ✓' : 'Attiva'; btn.classList.toggle('active', active); }
  if (sub) sub.textContent = active ? 'Notifiche push attive' : 'Attiva per non perdere le offerte';
}

// ===== TOAST =====
let toastTimeout;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.remove('show'), 2600);
}

// ===== GREETING =====
function setGreeting() {
  const h      = new Date().getHours();
  const saluto = h < 12 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const nome   = isGuest ? 'Ospite' : (userProfile?.nome || 'Benvenuto');
  const el     = document.getElementById('greeting-text');
  if (el) el.textContent = `${saluto}, ${nome} 👋`;
}

// ===== TEMA =====
function initTheme() {
  if (localStorage.getItem('theme') === 'light') applyTheme('light');
}
function applyTheme(mode) {
  const isLight = mode === 'light';
  document.body.classList.toggle('theme-light', isLight);
  const toggle = document.getElementById('theme-toggle');
  const icon   = document.getElementById('theme-icon');
  const label  = document.getElementById('theme-label');
  if (toggle) toggle.classList.toggle('on', isLight);
  if (icon)   icon.className = isLight ? 'ti ti-sun' : 'ti ti-moon-stars';
  if (label)  label.textContent = isLight ? 'Tema chiaro' : 'Tema scuro';
}
function toggleTheme() {
  const next = document.body.classList.contains('theme-light') ? 'dark' : 'light';
  localStorage.setItem('theme', next);
  applyTheme(next);
}

// ===== INVITI =====
let pendingInviteId = null;

async function loadInvitesSent() {
  try {
    const res = await authFetch('/api/invite/sent');
    if (!res.ok) return;
    const invites = await res.json();
    const list = document.getElementById('invite-list');
    if (!list) return;
    if (!invites.length) { list.innerHTML = ''; return; }
    list.innerHTML = invites.map(inv => {
      const icon = inv.status === 'accepted' ? '✅' : inv.status === 'declined' ? '❌' : '⏳';
      const label = inv.status === 'accepted' ? 'Accettato' : inv.status === 'declined' ? 'Rifiutato' : 'In attesa';
      return `<div class="invite-item"><span class="invite-phone">${inv.friend_phone}</span><span class="invite-status invite-status--${inv.status}">${icon} ${label}</span></div>`;
    }).join('');
  } catch(e) {}
}

async function checkPendingInvites() {
  try {
    const res = await authFetch('/api/invite/pending');
    if (!res.ok) return;
    const invites = await res.json();
    if (!invites.length) return;
    const inv = invites[0];
    pendingInviteId = inv.id;
    // Crea banner dinamicamente
    const banner = document.createElement('div');
    banner.id = 'invite-banner';
    banner.className = 'invite-banner';
    banner.innerHTML = `
      <div class="invite-banner-body">
        <div class="invite-banner-icon">🎁</div>
        <div class="invite-banner-text">
          <div class="invite-banner-title">${inv.inviter_name} ti ha invitato!</div>
          <div class="invite-banner-sub">Se accetti, riceverà un drink omaggio</div>
        </div>
      </div>
      <div class="invite-banner-actions">
        <button class="invite-accept-btn" onclick="respondInvite('accepted')">Accetta</button>
        <button class="invite-decline-btn" onclick="respondInvite('declined')">Rifiuta</button>
      </div>
    `;
    document.getElementById('app').appendChild(banner);
  } catch(e) {}
}

async function sendInvite() {
  const input = document.getElementById('invite-phone');
  const phone = input.value.trim();
  if (!phone) { showToast('Inserisci un numero di telefono'); return; }
  try {
    const res = await authFetch('/api/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friend_phone: phone }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Errore invio'); return; }
    input.value = '';
    showToast('Invito inviato ✓');
    loadInvitesSent();
  } catch(e) { showToast('Errore di rete'); }
}

async function respondInvite(action) {
  if (!pendingInviteId) return;
  const banner = document.getElementById('invite-banner');
  if (banner) banner.remove();
  try {
    const res = await authFetch(`/api/invite/${pendingInviteId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) return;
    pendingInviteId = null;
    if (action === 'accepted') showToast('Invito accettato — grazie! 🎉');
    else showToast('Invito rifiutato');
  } catch(e) {}
}

function updateRewardUI() {
  const count = parseInt(userProfile?.referral_count) || 0;
  if (count <= 0) return;
  if (document.getElementById('referral-reward')) return;
  const invitePanel = document.querySelector('.invite-panel');
  if (!invitePanel) return;
  const el = document.createElement('div');
  el.id = 'referral-reward';
  el.className = 'referral-reward';
  el.innerHTML = `
    <div class="referral-reward-top"><span class="referral-reward-badge">🎉 Offerta sbloccata</span></div>
    <div class="referral-reward-name">Drink omaggio</div>
    <div class="referral-reward-desc">Un tuo amico ha accettato! Mostra il QR al personale per riscuotere.</div>
  `;
  invitePanel.insertAdjacentElement('afterend', el);
}

// ===== MODIFICA PROFILO =====
function populateEditForm() {
  if (!userProfile) return;
  const nome    = document.getElementById('edit-nome');
  const cognome = document.getElementById('edit-cognome');
  const phone   = document.getElementById('edit-phone');
  const email   = document.getElementById('edit-email-display');
  if (nome)    nome.value    = userProfile.nome    || '';
  if (cognome) cognome.value = userProfile.cognome || '';
  if (phone)   phone.value   = userProfile.phone   || '';
  if (email)   email.textContent = userProfile.email || '—';
}

async function saveProfile() {
  const nome    = document.getElementById('edit-nome').value.trim();
  const cognome = document.getElementById('edit-cognome').value.trim();
  const phone   = document.getElementById('edit-phone').value.trim();
  if (!nome || !cognome) { showToast('Nome e cognome obbligatori'); return; }

  try {
    const res = await authFetch('/api/profile/update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, cognome, phone: phone || null }),
    });
    if (!res.ok) { showToast('Errore salvataggio'); return; }
    userProfile.nome    = nome;
    userProfile.cognome = cognome;
    userProfile.phone   = phone;
    const session = JSON.parse(localStorage.getItem('club1_session') || '{}');
    if (session.profile) { Object.assign(session.profile, { nome, cognome, phone }); localStorage.setItem('club1_session', JSON.stringify(session)); }
    updateUI();
    populateEditForm();
    goBack();
    showToast('Profilo aggiornato ✓');
  } catch(e) { showToast('Errore di rete'); }
}

// ===== UTILS =====
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ===== PULL TO REFRESH =====
function initPullToRefresh() {
  let startY = 0;
  let pulling = false;

  const indicator = document.createElement('div');
  indicator.id = 'ptr-indicator';
  indicator.innerHTML = '<div class="ptr-spinner"></div>';
  document.getElementById('app').prepend(indicator);

  document.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    const scrollEl = document.querySelector('.screen.active .scroll-content');
    if (scrollEl && scrollEl.scrollTop > 0) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 60 && !pulling) {
      pulling = true;
      indicator.classList.add('ptr-visible');
    }
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (pulling) {
      pulling = false;
      indicator.classList.add('ptr-spinning');
      setTimeout(() => location.reload(), 500);
    }
  });
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initPullToRefresh();

  const hasCached = !!localStorage.getItem('club1_cached_offers');
  const hasSaved = !!localStorage.getItem('club1_session');
  const splashDelay = (hasCached && hasSaved) ? 600 : 1900;

  setTimeout(async () => {
    const splash = document.getElementById('splash');
    splash.style.opacity = '0';
    splash.style.transition = 'opacity 0.5s';
    setTimeout(() => splash.style.display = 'none', 500);

    // Guest mode
    if (sessionStorage.getItem('guest_mode') === 'true') {
      isGuest = true;
      await enterApp();
      return;
    }

    // Controlla sessione salvata in localStorage
    const saved = localStorage.getItem('club1_session');
    if (saved) {
      try {
        const { user, profile } = JSON.parse(saved);
        currentUser = user;
        userProfile = profile;
        await enterApp();
        return;
      } catch(e) { localStorage.removeItem('club1_session'); }
    }

    window.location.replace('login.html');
  }, splashDelay);
});
