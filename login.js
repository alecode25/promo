/* ================================================
   CLUB 1 PIANO — LOGIN / REGISTER
   Parla solo con /api/auth/* — nessuna chiave nel frontend
   ================================================ */

const API = 'https://offerte-uxp3.onrender.com';

// Se sessione già attiva → vai all'app
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch(API + '/api/auth/session', { credentials: 'include' });
    if (res.ok) window.location.replace('offerte.html');
  } catch(e) { /* server non raggiungibile, mostra form */ }
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
  const errEl   = document.getElementById('reg-error');
  const btn     = document.getElementById('register-btn');

  errEl.classList.add('hidden');
  if (!nome || !cognome || !email || !password) { showError(errEl, 'Compila tutti i campi'); return; }
  if (password.length < 8) { showError(errEl, 'Password min. 8 caratteri'); return; }

  btn.disabled = true;
  btn.textContent = 'Creazione…';

  try {
    const res  = await fetch(API + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ nome, cognome, email, password }),
    });
    const data = await res.json();

    if (!res.ok) { showError(errEl, data.error || 'Errore di registrazione'); return; }
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
