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
async function getUserFromCookies(req) {
  const token = req.cookies.sb_access;
  if (!token) return null;
  const { data: { user }, error } = await sbService.auth.getUser(token);
  if (error || !user) return null;
  return user;
}
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
    user:    { id: data.user.id, email: data.user.email },
    profile: profile || { nome: data.user.user_metadata?.nome || 'Utente', cognome: data.user.user_metadata?.cognome || '', email: data.user.email, punti: 0, visite: 0, offerte_usate: 0 },
  });
});

// ===================================================
// AUTH — REGISTER
// ===================================================
app.post('/api/auth/register', async (req, res) => {
  const { nome, cognome, email, password } = req.body;
  if (!nome || !cognome || !email || !password) return res.status(400).json({ error: 'Dati mancanti' });
  if (password.length < 8) return res.status(400).json({ error: 'Password min. 8 caratteri' });

  const { data, error } = await sbAnon.auth.signUp({
    email, password,
    options: { data: { nome, cognome } },
  });
  if (error) return res.status(400).json({ error: tradErr(error.message) });

  if (data.user) {
    const referralCode = generateReferralCode();
    await sbService.from('profiles').upsert({
      id: data.user.id, nome, cognome, email, punti: 0, visite: 0, offerte_usate: 0,
      referral_code: referralCode,
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
    user:    { id: data.user.id, email: data.user.email },
    profile: { nome, cognome, email, punti: 0, visite: 0, offerte_usate: 0 },
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
// OFFERTE
// ===================================================
app.get('/api/offers', async (req, res) => {
  const { data, error } = await sbService.from('offers').select('*').order('sort_order');
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
