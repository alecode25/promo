/* ================================================
   CLUB 1 PIANO — SCANNER JS
   Standalone page for waiter QR scanning
   ================================================ */

const API = 'https://offerte-uxp3.onrender.com';

function togglePwd(id) {
  const inp = document.getElementById(id);
  const btn = inp.parentElement.querySelector('.pwd-eye i');
  if (inp.type === 'password') { inp.type = 'text';     btn.className = 'ti ti-eye-off'; }
  else                         { inp.type = 'password'; btn.className = 'ti ti-eye'; }
}

let waiterToken        = null;
let waiterName         = '';
let scannedUserId      = null;
let scannedOfferToken  = null;
let processing         = false;
let html5QrCode        = null;

// ==============================
// AUTH
// ==============================
async function scannerLogin() {
  const username = document.getElementById('s-username').value.trim();
  const password = document.getElementById('s-password').value;
  const errEl    = document.getElementById('s-login-err');
  const btn      = document.getElementById('s-login-btn');

  errEl.classList.add('hidden');
  if (!username || !password) { sErr(errEl, 'Inserisci username e password'); return; }

  btn.disabled = true;
  btn.textContent = 'Accesso…';

  try {
    const res  = await fetch(API + '/api/scanner/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { sErr(errEl, data.error || 'Credenziali errate'); return; }

    waiterToken = data.token;
    waiterName  = data.name;
    sessionStorage.setItem('waiter_token', data.token);
    sessionStorage.setItem('waiter_name',  data.name);
    startScanner();
  } catch(e) {
    sErr(errEl, 'Server non raggiungibile');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Accedi';
  }
}

function scannerLogout() {
  sessionStorage.removeItem('waiter_token');
  sessionStorage.removeItem('waiter_name');
  waiterToken = null;
  waiterName  = '';
  stopCamera();
  document.getElementById('s-app').classList.add('hidden');
  document.getElementById('s-login').classList.remove('hidden');
}

// ==============================
// CAMERA
// ==============================
async function startScanner() {
  document.getElementById('s-login').classList.add('hidden');
  const app = document.getElementById('s-app');
  app.classList.remove('hidden');
  document.getElementById('s-waiter-name').textContent = waiterName || 'Cameriere';

  try {
    html5QrCode = new Html5Qrcode('s-qr-reader');
    await html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 },
      (decodedText) => {
        if (processing) return;
        if (decodedText.startsWith('club1piano-offer:')) {
          processing = true;
          handleOfferQR(decodedText);
        } else if (decodedText.startsWith('club1piano:')) {
          processing = true;
          handleQR(decodedText);
        }
      },
      () => {}
    );
  } catch(e) {
    showNoCameraFallback(e.message);
  }
}

function stopCamera() {
  if (html5QrCode) {
    html5QrCode.stop().then(() => { html5QrCode.clear(); html5QrCode = null; }).catch(() => {});
  }
  processing = false;
}

function showNoCameraFallback(msg) {
  const vp = document.getElementById('s-viewport');
  vp.innerHTML = `
    <div class="s-no-cam">
      <i class="ti ti-camera-off"></i>
      <div class="s-no-cam-title">Fotocamera non disponibile</div>
      <div class="s-no-cam-sub">${msg || 'Controlla i permessi fotocamera nelle impostazioni del browser.'}</div>
    </div>
  `;
}

// ==============================
// QR HANDLING
// ==============================
async function handleQR(qrData) {
  const hint = document.getElementById('s-hint');
  hint.textContent = 'QR rilevato — verifica in corso…';

  try {
    const res  = await fetch(API + '/api/scanner/validate', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + waiterToken,
      },
      body: JSON.stringify({ qr_data: qrData }),
    });
    const data = await res.json();

    if (!res.ok) {
      sToast(data.error || 'QR non valido');
      hint.textContent = 'Punta la fotocamera sul QR dell\'utente';
      processing = false;
      return;
    }

    scannedUserId = data.user_id;
    showUserCard(data.profile);
  } catch(e) {
    sToast('Errore di rete');
    hint.textContent = 'Punta la fotocamera sul QR dell\'utente';
    processing = false;
  }
}

// ==============================
// OFFER QR HANDLING
// ==============================
async function handleOfferQR(qrData) {
  const hint  = document.getElementById('s-hint');
  const token = qrData.replace('club1piano-offer:', '');
  hint.textContent = 'QR offerta rilevato — verifica in corso…';

  try {
    const res  = await fetch(API + '/api/scanner/redeem', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + waiterToken },
      body:    JSON.stringify({ token }),
    });
    const data = await res.json();

    if (!res.ok) {
      sToast(data.error || 'QR non valido');
      hint.textContent = 'Punta la fotocamera sul QR dell\'utente';
      processing = false;
      return;
    }

    scannedOfferToken = token;
    showOfferCard(data.offer, data.profile);
  } catch(e) {
    sToast('Errore di rete');
    hint.textContent = 'Punta la fotocamera sul QR dell\'utente';
    processing = false;
  }
}

function showOfferCard(offer, profile) {
  const nome    = profile?.nome    || 'Utente';
  const cognome = profile?.cognome || '';
  const full    = nome + (cognome ? ' ' + cognome : '');
  const initials = (nome[0] || '') + (cognome[0] || '');
  const pts     = profile?.punti || 0;
  const level   = pts >= 1000 ? 'Platinum' : pts >= 300 ? 'Gold' : 'Silver';

  document.getElementById('s-offer-avatar').textContent    = initials.toUpperCase() || '?';
  document.getElementById('s-offer-user-name').textContent = full;
  document.getElementById('s-offer-user-level').textContent = '✦ Membro ' + level;
  document.getElementById('s-offer-name').textContent      = offer?.name        || '—';
  document.getElementById('s-offer-desc').textContent      = offer?.description || '';
  document.getElementById('s-offer-price').textContent     = offer?.price       || '';

  document.getElementById('s-offer-card').classList.remove('hidden');
}

function cancelOfferScan() {
  scannedOfferToken = null;
  document.getElementById('s-offer-card').classList.add('hidden');
  document.getElementById('s-hint').textContent = 'Punta la fotocamera sul QR dell\'utente';
  processing = false;
}

async function confirmRedeem() {
  if (!scannedOfferToken) return;
  const btn = document.getElementById('s-offer-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Conferma…';

  try {
    const res  = await fetch(API + '/api/scanner/confirm-redeem', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + waiterToken },
      body:    JSON.stringify({ token: scannedOfferToken }),
    });
    const data = await res.json();

    if (!res.ok) { sToast(data.error || 'Errore'); return; }

    const flash = document.createElement('div');
    flash.className = 's-success-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 600);

    sToast('Offerta riscattata ✓');
    document.getElementById('s-offer-card').classList.add('hidden');
    scannedOfferToken = null;
    document.getElementById('s-hint').textContent = 'Punta la fotocamera sul QR dell\'utente';
    processing = false;
  } catch(e) {
    sToast('Errore di rete');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-gift"></i> Conferma riscatto';
  }
}

function showUserCard(profile) {
  const nome     = profile.nome    || 'Utente';
  const cognome  = profile.cognome || '';
  const full     = nome + (cognome ? ' ' + cognome : '');
  const initials = (nome[0] || '') + (cognome[0] || '');
  const pts      = profile.punti  || 0;
  const visits   = profile.visite || 0;
  const level    = pts >= 1000 ? 'Platinum' : pts >= 300 ? 'Gold' : 'Silver';

  document.getElementById('s-result-avatar').textContent  = initials.toUpperCase() || '?';
  document.getElementById('s-result-name').textContent    = full;
  document.getElementById('s-result-level').textContent   = '✦ Membro ' + level;
  document.getElementById('s-result-pts').textContent     = pts;
  document.getElementById('s-result-visits').textContent  = visits;
  document.getElementById('s-amount').value               = '';

  const card = document.getElementById('s-result-card');
  card.classList.remove('hidden');
}

function cancelScan() {
  scannedUserId = null;
  document.getElementById('s-result-card').classList.add('hidden');
  document.getElementById('s-hint').textContent = 'Punta la fotocamera sul QR dell\'utente';
  processing = false;
}

async function confirmCheckin() {
  if (!scannedUserId) return;
  const amount = parseFloat(document.getElementById('s-amount').value) || 0;
  const btn    = document.getElementById('s-confirm-btn');

  btn.disabled    = true;
  btn.textContent = 'Salvataggio…';

  try {
    const res  = await fetch(API + '/api/scanner/checkin', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + waiterToken,
      },
      body: JSON.stringify({ user_id: scannedUserId, amount_spent: amount }),
    });
    const data = await res.json();

    if (!res.ok) {
      sToast(data.error || 'Errore check-in');
      return;
    }

    // success flash
    const flash = document.createElement('div');
    flash.className = 's-success-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 600);

    const ptsAdded = Math.round(amount);
    sToast(ptsAdded > 0
      ? `Check-in confermato ✓  +${ptsAdded} pt`
      : 'Check-in confermato ✓'
    );

    document.getElementById('s-result-card').classList.add('hidden');
    scannedUserId = null;
    document.getElementById('s-hint').textContent = 'Punta la fotocamera sul QR dell\'utente';
    processing = false;
  } catch(e) {
    sToast('Errore di rete');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> Conferma check-in';
  }
}

// ==============================
// UTILS
// ==============================
function sErr(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

let sToastTimer;
function sToast(msg) {
  const t = document.getElementById('s-toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(sToastTimer);
  sToastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ==============================
// INIT
// ==============================
document.addEventListener('DOMContentLoaded', () => {
  const savedToken = sessionStorage.getItem('waiter_token');
  const savedName  = sessionStorage.getItem('waiter_name');

  if (savedToken) {
    waiterToken = savedToken;
    waiterName  = savedName || '';
    startScanner();
    return;
  }

  document.getElementById('s-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') scannerLogin();
  });
  document.getElementById('s-username').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('s-password').focus();
  });
});
