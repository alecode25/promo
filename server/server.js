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

// ===== CORS — accetta richieste solo dal tuo dominio =====
app.use(cors({
  origin:      process.env.ALLOWED_ORIGIN,   // es. https://tuosito.it
  credentials: true,                          // necessario per i cookie
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
  if (error || !user) return null;
  return user;
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

// PATCH /api/profile/phone — aggiorna numero telefono
app.patch('/api/profile/phone', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Numero mancante' });
  const normalized = phone.replace(/\s+/g, '');
  const { error } = await sbService.from('profiles').update({ phone: normalized }).eq('id', user.id);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Club 1 Piano API attiva su porta ${PORT}`));
