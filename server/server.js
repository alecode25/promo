/* ================================================
   CLUB 1 PIANO — BACKEND API
   Deploy su Render: https://render.com
   Frontend su dominio separato.
   ================================================ */

require('dotenv').config();
const express          = require('express');
const cookieParser     = require('cookie-parser');
const cors             = require('cors');
const webpush          = require('web-push');
const crypto           = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

const app  = express();
const PROD = process.env.NODE_ENV === 'production';

// ===== CORS =====
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean);
const LOCAL_ORIGIN    = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);                    // Postman / curl
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    if (LOCAL_ORIGIN.test(origin)) return cb(null, true); // qualsiasi porta locale
    cb(new Error('CORS: origine non autorizzata'));
  },
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

// ===== SUPABASE — solo lato server =====
const sbService = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const sbAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ===== WEB PUSH / VAPID =====
webpush.setVapidDetails(
  'mailto:' + process.env.ADMIN_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ===================================================
// HELPERS
// ===================================================
const COOKIE_OPTS = {
  httpOnly: true,
  secure:   PROD,
  sameSite: PROD ? 'none' : 'strict',  // 'none' richiesto per cross-domain
};

function setSessionCookies(res, session) {
  res.cookie('sb_access',  session.access_token,  { ...COOKIE_OPTS, maxAge: 7  * 24 * 60 * 60 * 1000 });
  res.cookie('sb_refresh', session.refresh_token, { ...COOKIE_OPTS, maxAge: 30 * 24 * 60 * 60 * 1000 });
}
function clearSessionCookies(res) {
  res.clearCookie('sb_access',  { ...COOKIE_OPTS });
  res.clearCookie('sb_refresh', { ...COOKIE_OPTS });
}
async function getUserFromRequest(req) {
  // Accetta sia cookie che Authorization: Bearer <token>
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.startsWith('Bearer '))
    ? authHeader.slice(7)
    : req.cookies.sb_access;
  if (!token) return null;
  const { data: { user }, error } = await sbService.auth.getUser(token);
  if (!error && user) return user;

  // Token scaduto — prova refresh con cookie
  const refreshToken = req.cookies.sb_refresh;
  if (!refreshToken) return null;
  const { data: refreshed, error: refreshErr } = await sbAnon.auth.refreshSession({ refresh_token: refreshToken });
  if (refreshErr || !refreshed?.session) return null;
  return refreshed.session.user;
}
// Alias per compatibilità
const getUserFromCookies = getUserFromRequest;
async function getProfile(userId) {
  const { data } = await sbService.from('profiles').select('*').eq('id', userId).single();
  return data;
}
function tradErr(msg) {
  if (msg.includes('Invalid login'))      return 'Email o password errati';
  if (msg.includes('already registered')) return 'Email già registrata';
  if (msg.includes('Password'))           return 'Password troppo corta (min. 8 caratteri)';
  return msg;
}

// ===================================================
// AUTH — LOGIN
// ===================================================
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Dati mancanti' });

  const { data, error } = await sbAnon.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: tradErr(error.message) });

  setSessionCookies(res, data.session);
  const profile = await getProfile(data.user.id);
  res.json({
    user:        { id: data.user.id, email: data.user.email },
    profile:     profile || { nome: data.user.user_metadata?.nome || 'Utente', cognome: data.user.user_metadata?.cognome || '', email: data.user.email, punti: 0, visite: 0, offerte_usate: 0 },
    accessToken: data.session.access_token,
  });
});

// ===================================================
// AUTH — REGISTER
// ===================================================
app.post('/api/auth/register', async (req, res) => {
  const { nome, cognome, email, password, phone } = req.body;
  if (!nome || !cognome || !email || !password) return res.status(400).json({ error: 'Dati mancanti' });
  if (password.length < 8) return res.status(400).json({ error: 'Password min. 8 caratteri' });

  const { data, error } = await sbAnon.auth.signUp({
    email, password,
    options: { data: { nome, cognome } },
  });
  if (error) return res.status(400).json({ error: tradErr(error.message) });

  if (data.user) {
    const referralCode = generateReferralCode();
    const normalizedPhone = phone ? phone.replace(/\s+/g, '') : null;
    await sbService.from('profiles').upsert({
      id: data.user.id, nome, cognome, email, punti: 0, visite: 0, offerte_usate: 0,
      referral_code: referralCode,
      phone: normalizedPhone,
    });

    // Se c'è un codice referral → incrementa il referrer
    const { referred_by_code } = req.body;
    if (referred_by_code) {
      const { data: referrer } = await sbService
        .from('profiles')
        .select('id, referral_count')
        .eq('referral_code', referred_by_code.toUpperCase())
        .single();
      if (referrer) {
        await sbService.from('profiles')
          .update({ referral_count: (referrer.referral_count || 0) + 1 })
          .eq('id', referrer.id);
        await sbService.from('profiles')
          .update({ referred_by: referrer.id })
          .eq('id', data.user.id);
      }
    }
  }

  if (data.session) setSessionCookies(res, data.session);
  res.json({
    user:        { id: data.user.id, email: data.user.email },
    profile:     { nome, cognome, email, punti: 0, visite: 0, offerte_usate: 0 },
    accessToken: data.session?.access_token || null,
  });
});

// ===================================================
// AUTH — LOGOUT
// ===================================================
app.post('/api/auth/logout', (req, res) => {
  clearSessionCookies(res);
  res.json({ ok: true });
});

// ===================================================
// AUTH — SESSION CHECK
// ===================================================
app.get('/api/auth/session', async (req, res) => {
  const user = await getUserFromCookies(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  const profile = await getProfile(user.id);
  res.json({
    user:    { id: user.id, email: user.email },
    profile: profile || { nome: user.user_metadata?.nome || 'Utente', cognome: user.user_metadata?.cognome || '', email: user.email, punti: 0, visite: 0, offerte_usate: 0 },
  });
});

// ===================================================
// ADMIN — middleware
// ===================================================
function requireAdmin(req, res, next) {
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }
  next();
}

// POST /api/admin/verify
app.post('/api/admin/verify', (req, res) => {
  if (req.body.password !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Password errata' });
  }
  res.json({ ok: true });
});

// GET /api/admin/offers
app.get('/api/admin/offers', requireAdmin, async (req, res) => {
  const { data, error } = await sbService.from('offers').select('*').order('sort_order');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/admin/offers
app.post('/api/admin/offers', requireAdmin, async (req, res) => {
  const { name, category, tag, price, original_price, expiry_date, description, image_url, sort_order, active } = req.body;
  if (!name || !description || !price || !category) return res.status(400).json({ error: 'Campi obbligatori mancanti' });
  const { data, error } = await sbService.from('offers')
    .insert({ name, category, tag, price, original_price, expiry_date: expiry_date || null, description, image_url, sort_order: sort_order || 0, active: active !== false })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PUT /api/admin/offers/:id
app.put('/api/admin/offers/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, category, tag, price, original_price, expiry_date, description, image_url, sort_order, active } = req.body;
  const { data, error } = await sbService.from('offers')
    .update({ name, category, tag, price, original_price, expiry_date: expiry_date || null, description, image_url, sort_order, active })
    .eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/admin/offers/:id
app.delete('/api/admin/offers/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { error } = await sbService.from('offers').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// GET /api/admin/users
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const { data, error } = await sbService.from('profiles').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/profile/update — aggiorna nome, cognome, telefono
app.patch('/api/profile/update', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  const { nome, cognome, phone } = req.body;
  if (!nome || !cognome) return res.status(400).json({ error: 'Nome e cognome obbligatori' });
  const updates = { nome, cognome, phone: phone ? phone.replace(/\s+/g, '') : null };
  const { error } = await sbService.from('profiles').update(updates).eq('id', user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// GET /api/admin/storage-config  (per upload immagini da frontend)
app.get('/api/admin/storage-config', requireAdmin, (req, res) => {
  res.json({
    url:     process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    bucket:  'offer-images',
  });
});

// ===================================================
// INVITI
// ===================================================

// POST /api/invite  — invia invito a numero di telefono
app.post('/api/invite', async (req, res) => {
  const user = await getUserFromCookies(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });

  let { friend_phone } = req.body;
  if (!friend_phone) return res.status(400).json({ error: 'Numero mancante' });
  friend_phone = friend_phone.replace(/\s+/g, '');

  // Controlla che non si inviti se stesso
  const myProfile = await getProfile(user.id);
  if (myProfile?.phone === friend_phone) return res.status(400).json({ error: 'Non puoi invitare te stesso' });

  // Controlla invito già inviato e pendente
  const { data: existing } = await sbService.from('invites')
    .select('id')
    .eq('inviter_id', user.id)
    .eq('friend_phone', friend_phone)
    .eq('status', 'pending')
    .single();
  if (existing) return res.status(400).json({ error: 'Invito già inviato a questo numero' });

  const { data, error } = await sbService.from('invites')
    .insert({ inviter_id: user.id, friend_phone })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, invite: data });
});

// GET /api/invite/sent  — inviti inviati dall'utente
app.get('/api/invite/sent', async (req, res) => {
  const user = await getUserFromCookies(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  const { data } = await sbService.from('invites')
    .select('*')
    .eq('inviter_id', user.id)
    .order('created_at', { ascending: false });
  res.json(data || []);
});

// GET /api/invite/pending  — inviti ricevuti per il mio numero di telefono
app.get('/api/invite/pending', async (req, res) => {
  const user = await getUserFromCookies(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  const myProfile = await getProfile(user.id);
  if (!myProfile?.phone) return res.json([]);

  const { data } = await sbService.from('invites')
    .select('id, inviter_id, created_at')
    .eq('friend_phone', myProfile.phone)
    .eq('status', 'pending');

  if (!data?.length) return res.json([]);

  // Aggiungi nome invitante
  const withNames = await Promise.all(data.map(async inv => {
    const { data: p } = await sbService.from('profiles').select('nome, cognome').eq('id', inv.inviter_id).single();
    return { ...inv, inviter_name: p ? `${p.nome} ${p.cognome}`.trim() : 'Un amico' };
  }));
  res.json(withNames);
});

// POST /api/invite/:id/respond  — body: { action: 'accepted'|'declined' }
app.post('/api/invite/:id/respond', async (req, res) => {
  const user = await getUserFromCookies(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });

  const { action } = req.body;
  if (!['accepted', 'declined'].includes(action)) return res.status(400).json({ error: 'Azione non valida' });

  const myProfile = await getProfile(user.id);
  if (!myProfile?.phone) return res.status(400).json({ error: 'Nessun telefono nel profilo' });

  // Verifica che l'invito sia per questo utente
  const { data: invite, error: invErr } = await sbService.from('invites')
    .select('*')
    .eq('id', req.params.id)
    .eq('friend_phone', myProfile.phone)
    .eq('status', 'pending')
    .single();
  if (invErr || !invite) return res.status(404).json({ error: 'Invito non trovato' });

  // Aggiorna stato
  await sbService.from('invites').update({ status: action }).eq('id', invite.id);

  // Se accettato → incrementa referral_count dell'invitante
  if (action === 'accepted') {
    const { data: inviterProfile } = await sbService.from('profiles')
      .select('referral_count').eq('id', invite.inviter_id).single();
    await sbService.from('profiles')
      .update({ referral_count: (inviterProfile?.referral_count || 0) + 1 })
      .eq('id', invite.inviter_id);
  }

  res.json({ ok: true });
});

// ===================================================
// OFFERTE
// ===================================================
app.get('/api/offers', async (req, res) => {
  const now = new Date().toISOString();
  const { data, error } = await sbService
    .from('offers')
    .select('*')
    .or(`expiry_date.is.null,expiry_date.gt.${now}`)
    .order('sort_order');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/offers/:id/token — genera token monouso per riscattare offerta
app.post('/api/offers/:id/token', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });

  const offerId = parseInt(req.params.id, 10);
  const { data: offer } = await sbService.from('offers').select('id,name,active,expiry_date').eq('id', offerId).single();
  if (!offer || !offer.active) return res.status(404).json({ error: 'Offerta non disponibile' });

  // Blocca se offerta già riscattata da questo utente
  const { data: redeemed } = await sbService.from('offer_redemptions')
    .select('token')
    .eq('user_id', user.id)
    .eq('offer_id', offerId)
    .not('used_at', 'is', null)
    .maybeSingle();
  if (redeemed) return res.status(409).json({ error: 'Offerta già riscattata' });

  // Riusa token già esistente non usato per questo utente+offerta
  const { data: existing } = await sbService.from('offer_redemptions')
    .select('token,expires_at')
    .eq('user_id', user.id)
    .eq('offer_id', offerId)
    .is('used_at', null)
    .single();
  if (existing) return res.json({ token: existing.token, expires_at: existing.expires_at });

  // expires_at = scadenza offerta oppure nessuna scadenza (anno 9999)
  const expires_at = offer.expiry_date || '9999-12-31T23:59:59Z';
  const token      = crypto.randomUUID();
  const { error }  = await sbService.from('offer_redemptions')
    .insert({ user_id: user.id, offer_id: offerId, token, expires_at });
  if (error) return res.status(500).json({ error: error.message });

  res.json({ token, expires_at });
});

// POST /api/offers/check-tokens — restituisce quali token sono già stati usati
app.post('/api/offers/check-tokens', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });

  const { tokens } = req.body;
  if (!Array.isArray(tokens) || tokens.length === 0) return res.json({ used: [] });

  const { data } = await sbService.from('offer_redemptions')
    .select('token')
    .eq('user_id', user.id)
    .in('token', tokens)
    .not('used_at', 'is', null);

  res.json({ used: (data || []).map(r => r.token) });
});

// POST /api/scanner/redeem — cameriere scansiona QR offerta
app.post('/api/scanner/redeem', requireScanner, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token mancante' });

  const { data: redemption } = await sbService.from('offer_redemptions')
    .select('*').eq('token', token).single();

  if (!redemption) return res.status(404).json({ error: 'QR non valido' });
  if (redemption.used_at) return res.status(409).json({ error: 'QR già utilizzato' });

  const { data: offer } = await sbService.from('offers').select('name,description,price,category,expiry_date,active').eq('id', redemption.offer_id).single();
  if (!offer || !offer.active) return res.status(404).json({ error: 'Offerta non più disponibile' });
  if (offer.expiry_date && new Date(offer.expiry_date) < new Date()) return res.status(410).json({ error: 'Offerta scaduta' });
  const profile           = await getProfile(redemption.user_id);

  res.json({ ok: true, token, offer, user_id: redemption.user_id, profile });
});

// POST /api/scanner/confirm-redeem — conferma riscatto offerta
app.post('/api/scanner/confirm-redeem', requireScanner, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token mancante' });

  const { data: redemption } = await sbService.from('offer_redemptions')
    .select('*').eq('token', token).single();

  if (!redemption) return res.status(404).json({ error: 'Token non trovato' });
  if (redemption.used_at) return res.status(409).json({ error: 'Già utilizzato' });

  const { error } = await sbService.from('offer_redemptions')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token);
  if (error) return res.status(500).json({ error: error.message });

  // Incrementa offerte_usate
  const profile = await getProfile(redemption.user_id);
  if (profile) {
    await sbService.from('profiles')
      .update({ offerte_usate: (profile.offerte_usate || 0) + 1 })
      .eq('id', redemption.user_id);
  }

  res.json({ ok: true });
});

// ===================================================
// PUSH — VAPID public key
// ===================================================
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

// ===================================================
// PUSH — salva subscription
// ===================================================
app.post('/api/push/subscribe', async (req, res) => {
  const { subscription } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: 'Subscription non valida' });

  const user = await getUserFromCookies(req);
  const { error } = await sbService.from('push_subscriptions').upsert({
    user_id:  user?.id || null,
    endpoint: subscription.endpoint,
    p256dh:   subscription.keys.p256dh,
    auth_key: subscription.keys.auth,
  }, { onConflict: 'endpoint' });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ===================================================
// PUSH — manda a tutti (admin)
// ===================================================
app.post('/api/push/send', async (req, res) => {
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }
  const { title, body, url = '/' } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title e body obbligatori' });

  const { data: subs, error } = await sbService.from('push_subscriptions').select('*');
  if (error) return res.status(500).json({ error: error.message });

  const payload = JSON.stringify({ title, body, url, tag: 'club1piano-' + Date.now() });
  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        payload
      ).catch(async err => {
        if (err.statusCode === 410) {
          await sbService.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
        throw err;
      })
    )
  );

  res.json({
    sent:   results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
    total:  subs.length,
  });
});

// ===================================================
// SCANNER — helpers
// ===================================================
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}
function checkPassword(password, stored) {
  try {
    const idx  = stored.indexOf(':');
    const salt = stored.slice(0, idx);
    const hash = stored.slice(idx + 1);
    const h2   = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(h2, 'hex'));
  } catch { return false; }
}
function makeWaiterToken(waiterId) {
  const payload = `${waiterId}:${Date.now()}`;
  const sig     = crypto.createHmac('sha256', process.env.ADMIN_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64');
}
function verifyWaiterToken(token) {
  try {
    const raw  = Buffer.from(token, 'base64').toString('utf8');
    const last = raw.lastIndexOf(':');
    const sig  = raw.slice(last + 1);
    const body = raw.slice(0, last);
    const exp  = crypto.createHmac('sha256', process.env.ADMIN_SECRET).update(body).digest('hex');
    if (sig.length !== exp.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(exp, 'hex'))) return null;
    return body.split(':')[0]; // UUID has no colons, safe split
  } catch { return null; }
}
async function requireScanner(req, res, next) {
  if (req.headers['x-admin-secret'] === process.env.ADMIN_SECRET) {
    req.scannerRole = 'admin';
    return next();
  }
  const auth = req.headers['authorization'];
  if (auth?.startsWith('Bearer ')) {
    const wid = verifyWaiterToken(auth.slice(7));
    if (wid) {
      const { data: w } = await sbService.from('waiters').select('name,active').eq('id', wid).single();
      if (w?.active) { req.scannerRole = 'waiter'; req.scannerName = w.name; return next(); }
    }
  }
  res.status(401).json({ error: 'Non autorizzato' });
}

// POST /api/scanner/login
app.post('/api/scanner/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Credenziali mancanti' });
  const { data: w } = await sbService.from('waiters').select('*').eq('username', username).eq('active', true).single();
  if (!w) return res.status(401).json({ error: 'Credenziali errate' });
  if (!checkPassword(password, w.password_hash)) return res.status(401).json({ error: 'Credenziali errate' });
  res.json({ ok: true, token: makeWaiterToken(w.id), name: w.name });
});

// POST /api/scanner/validate
app.post('/api/scanner/validate', requireScanner, async (req, res) => {
  const { qr_data } = req.body;
  if (!qr_data) return res.status(400).json({ error: 'QR mancante' });
  const parts = qr_data.split(':');
  if (parts.length !== 2 || parts[0] !== 'club1piano') return res.status(400).json({ error: 'QR non valido' });
  const uid = parts[1];
  const profile = await getProfile(uid);
  if (!profile) return res.status(404).json({ error: 'Utente non trovato' });
  res.json({ ok: true, user_id: uid, profile });
});

// POST /api/scanner/checkin
app.post('/api/scanner/checkin', requireScanner, async (req, res) => {
  const { user_id, amount_spent } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id mancante' });
  const profile = await getProfile(user_id);
  if (!profile) return res.status(404).json({ error: 'Utente non trovato' });
  const pts       = Math.max(0, Math.round(parseFloat(amount_spent) || 0));
  const newPunti  = (profile.punti  || 0) + pts;
  const newVisite = (profile.visite || 0) + 1;
  const { error } = await sbService.from('profiles').update({ punti: newPunti, visite: newVisite }).eq('id', user_id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, punti: newPunti, visite: newVisite });
});

// ===================================================
// ADMIN — CAMERIERI
// ===================================================
app.get('/api/admin/waiters', requireAdmin, async (req, res) => {
  const { data, error } = await sbService.from('waiters')
    .select('id,name,username,active,created_at')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/admin/waiters', requireAdmin, async (req, res) => {
  const { name, username, password } = req.body;
  if (!name || !username || !password) return res.status(400).json({ error: 'Tutti i campi sono obbligatori' });
  if (password.length < 6) return res.status(400).json({ error: 'Password min. 6 caratteri' });
  const password_hash = hashPassword(password);
  const { data, error } = await sbService.from('waiters')
    .insert({ name, username, password_hash })
    .select('id,name,username,active,created_at').single();
  if (error) {
    if (error.code === '23505') return res.status(400).json({ error: 'Username già in uso' });
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

app.patch('/api/admin/waiters/:id/toggle', requireAdmin, async (req, res) => {
  const { data: w } = await sbService.from('waiters').select('active').eq('id', req.params.id).single();
  if (!w) return res.status(404).json({ error: 'Non trovato' });
  const { error } = await sbService.from('waiters').update({ active: !w.active }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, active: !w.active });
});

app.delete('/api/admin/waiters/:id', requireAdmin, async (req, res) => {
  const { error } = await sbService.from('waiters').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Club 1 Piano API attiva su porta ${PORT}`);
  const KEEP_ALIVE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  setInterval(() => {
    fetch(`${KEEP_ALIVE_URL}/api/health`)
      .then(r => console.log(`[keep-alive] ${new Date().toISOString()} → ${r.status}`))
      .catch(err => console.warn('[keep-alive] ping failed:', err.message));
  }, 14 * 60 * 1000);
});
