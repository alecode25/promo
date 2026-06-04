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
  if (screenId === 'screen-qr') startQRTimer();
  window.scrollTo(0, 0);
}

// ===== AUTH =====
async function handleLogout() {
  await fetch(API + '/api/auth/logout', { method: 'POST' });
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
  }
  renderHomeOffers();
  renderOfferList('all');
  initFilters();
  setGreeting();
}

async function loadOffers() {
  try {
    const res = await fetch(API + '/api/offers');
    if (res.ok) {
      const data = await res.json();
      OFFERS = data.map(o => ({
        id:       o.id,
        category: o.category,
        tag:      o.tag,
        name:     o.name,
        desc:     o.description,
        price:    o.price,
        orig:     o.original_price,
        expiry:   o.expiry,
        active:   o.active,
      }));
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
  setText('qr-level-badge', '✦ Membro ' + lv.name);
  setText('qr-points', pts);
  setText('qr-level-label', lv.name);
  setText('qr-next-label', nextLabel);
  setStyle('qr-progress-fill', 'width', pct + '%');

  setText('acc-avatar', initials || '?');
  setText('acc-name', fullname);
  setText('acc-email', userProfile.email || '');
  setText('acc-badge', '✦ Membro ' + lv.name);
  setText('stat-pts', pts);
  setText('stat-visits', userProfile.visite || 0);
  setText('stat-used', userProfile.offerte_usate || 0);

  setGreeting();
  generateQR();
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
  const uid  = currentUser ? currentUser.id : 'guest';
  const slot = Math.floor(Date.now() / (5 * 60 * 1000));
  return `club1piano:${uid}:${slot}`;
}
function generateQR() {
  const payload = getQRPayload();
  const mainCanvas = document.getElementById('qr-canvas');
  if (mainCanvas && typeof QRCode !== 'undefined') {
    QRCode.toCanvas(mainCanvas, payload, { width: 176, margin: 1, color: { dark: '#0D0D0D', light: '#FFFFFF' } });
  }
  const miniCanvas = document.getElementById('mini-qr-canvas');
  if (miniCanvas && typeof QRCode !== 'undefined') {
    QRCode.toCanvas(miniCanvas, payload, { width: 80, margin: 1, color: { dark: '#0D0D0D', light: '#FFFFFF' } });
  }
}

let qrTimerInterval = null;
let qrSecondsLeft   = 300;

function startQRTimer() {
  if (qrTimerInterval) clearInterval(qrTimerInterval);
  const slotMs = 5 * 60 * 1000;
  qrSecondsLeft = Math.ceil((slotMs - (Date.now() % slotMs)) / 1000);
  updateTimerDisplay();
  qrTimerInterval = setInterval(() => {
    qrSecondsLeft--;
    if (qrSecondsLeft <= 0) {
      generateQR();
      qrSecondsLeft = Math.ceil((slotMs - (Date.now() % slotMs)) / 1000);
    }
    updateTimerDisplay();
  }, 1000);
}
function updateTimerDisplay() {
  const m = Math.floor(qrSecondsLeft / 60);
  const s = qrSecondsLeft % 60;
  const val = document.getElementById('qr-validity');
  if (val) val.innerHTML = `Codice valido · si rinnova tra <span id="qr-timer">${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}</span>`;
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
    startQRTimer();
    showToast('Codice QR aggiornato ✓');
  }, 900);
}

// ===== OFFERTE RENDER =====
function renderHomeOffers() {
  const scroll = document.getElementById('offer-scroll');
  scroll.innerHTML = OFFERS.filter(o => o.active).map(o => `
    <div class="offer-snap-card" onclick="openModal(${o.id})">
      <div class="offer-snap-tag">${o.tag}</div>
      <div class="offer-snap-badge">${capitalize(o.category)}</div>
      <div class="offer-snap-name">${o.name}</div>
      <div class="offer-snap-desc">${o.desc.split('.')[0]}.</div>
      <div>
        <span class="offer-snap-price">${o.price}</span>
        ${o.orig && o.price !== 'Gratis' ? `<span class="offer-snap-orig">${o.orig}</span>` : ''}
      </div>
    </div>
  `).join('');
}
function renderOfferList(filter = 'all') {
  const list  = document.getElementById('offer-list');
  const items = filter === 'all' ? OFFERS : OFFERS.filter(o => o.category === filter);
  list.innerHTML = items.map(o => `
    <div class="offer-full-card${o.active ? '' : ' dimmed'}"${o.active ? ` onclick="openModal(${o.id})"` : ''}>
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
          ? `<button class="offer-use-btn" onclick="event.stopPropagation();openModal(${o.id})">Usa QR</button>`
          : `<span class="offer-coming-lbl">In arrivo</span>`}
      </div>
      <div class="offer-expiry">⏱ ${o.expiry}</div>
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
    <div class="modal-eyebrow">${capitalize(o.category)} · ${o.tag}</div>
    <div class="modal-title">${o.name}</div>
    <div class="modal-desc">${o.desc}</div>
    <div class="modal-price-row">
      <span class="modal-price">${o.price}</span>
      ${o.orig && o.price !== 'Gratis' ? `<span class="modal-orig">${o.orig}</span>` : ''}
    </div>
    <button class="modal-cta" onclick="useOffer(${o.id})">Apri QR e usa l'offerta</button>
    <div class="modal-expiry">⏱ ${o.expiry}</div>
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
    showToast('QR pronto — mostralo al personale! ✓');
  });
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

// ===== UTILS =====
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

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

    // Controlla sessione via server (cookie httpOnly)
    try {
      const res = await fetch(API + '/api/auth/session', { credentials: 'include' });
      if (res.ok) {
        const { user, profile } = await res.json();
        currentUser = user;
        userProfile = profile;
        await enterApp();
        return;
      }
    } catch(e) { /* server non disponibile */ }

    window.location.replace('login.html');
  }, 1900);
});
