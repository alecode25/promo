/* ================================================
   CLUB 1 PIANO — LOGIN / REGISTER
   Parla solo con /api/auth/* — nessuna chiave nel frontend
   ================================================ */

const API = 'https://offerte-uxp3.onrender.com';

// Se sessione già attiva → vai all'app
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('club1_session');
  if (saved) {
    try { JSON.parse(saved); window.location.replace('offerte.html'); }
    catch(e) { localStorage.removeItem('club1_session'); }
  }
  // Cattura codice referral dall'URL
  const ref = new URLSearchParams(window.location.search).get('ref');
  if (ref) {
    sessionStorage.setItem('pending_ref', ref.toUpperCase());
    switchTab('register');
  }
});

// ===== TAB =====
function switchTab(tab) {
  document.getElementById('form-login').classList.toggle('hidden', tab !== 'login');
  document.getElementById('form-register').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
}

// ===== LOGIN =====
async function handleLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('login-btn');

  errEl.classList.add('hidden');
  if (!email || !password) { showError(errEl, 'Compila tutti i campi'); return; }

  btn.disabled = true;
  btn.textContent = 'Accesso…';

  try {
    const res  = await fetch(API + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) { showError(errEl, data.error || 'Errore di accesso'); return; }
    localStorage.setItem('club1_session', JSON.stringify(data));
    if (data.accessToken) localStorage.setItem('club1_token', data.accessToken);
    window.location.replace('offerte.html');
  } catch(e) {
    showError(errEl, 'Server non raggiungibile');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entra';
  }
}

// ===== REGISTER =====
async function handleRegister() {
  const nome    = document.getElementById('reg-name').value.trim();
  const cognome = document.getElementById('reg-surname').value.trim();
  const email   = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const phone   = document.getElementById('reg-phone').value.trim();
  const errEl   = document.getElementById('reg-error');
  const btn     = document.getElementById('register-btn');

  errEl.classList.add('hidden');
  if (!nome || !cognome || !email || !password || !phone) { showError(errEl, 'Compila tutti i campi, incluso il numero'); return; }
  if (password.length < 8) { showError(errEl, 'Password min. 8 caratteri'); return; }

  btn.disabled = true;
  btn.textContent = 'Creazione…';

  try {
    const res  = await fetch(API + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ nome, cognome, email, password, phone: phone || null, referred_by_code: sessionStorage.getItem('pending_ref') || null }),
    });
    const data = await res.json();

    if (!res.ok) { showError(errEl, data.error || 'Errore di registrazione'); return; }
    sessionStorage.removeItem('pending_ref');
    localStorage.setItem('club1_session', JSON.stringify(data));
    if (data.accessToken) localStorage.setItem('club1_token', data.accessToken);
    window.location.replace('offerte.html');
  } catch(e) {
    showError(errEl, 'Server non raggiungibile');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crea account';
  }
}

// ===== GUEST =====
function enterAsGuest() {
  sessionStorage.setItem('guest_mode', 'true');
  window.location.replace('offerte.html');
}

// ===== UTILS =====
function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

let toastTimer;
function showMsg(msg) {
  const t = document.getElementById('msg-toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
