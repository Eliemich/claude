/**
 * /api/auth — connexion (pas de création de compte : les comptes se créent en ligne de commande)
 *  GET  /csrf    jeton anti-CSRF de la session
 *  POST /login   email + mot de passe
 *                → double authentification désactivée (défaut) : { step: 'done' }
 *                → activée (LOGIN_2FA=on) : { step: 'totp' } ou { step: 'setup', qr, secret } (1re connexion)
 *  POST /totp    code à 6 chiffres → connexion ouverte
 *  GET  /me      utilisateur connecté (ou null)
 *  POST /logout
 */
import { Router } from 'express';
import QRCode from 'qrcode';
import { db, now } from '../db.js';
import { config } from '../config.js';
import { HttpError, badRequest } from '../errors.js';
import { findByEmail, findById, verifyPassword, fakeVerify, publicUser } from '../users.js';
import { generateSecret, verifyCode, otpauthUrl } from '../totp.js';
import { csrfToken, limits } from '../security.js';

const regenerate = (req) => new Promise((ok, ko) => req.session.regenerate((e) => (e ? ko(e) : ok())));
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Ouvre la session (après le mot de passe, et le code si la double authentification est active). */
function openSession(req, user) {
  req.session.userId = user.id;
  req.session.cookie.maxAge = config.sessionHours * 3600e3;
  csrfToken(req);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), user.id);
  console.log(`[connexion] ${user.email} (${req.ip})`);
}

export function authRouter() {
  const r = Router();

  r.get('/csrf', (req, res) => res.json({ token: csrfToken(req) }));

  r.post('/login', limits.login, async (req, res) => {
    const email = str(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
    if (!email || !password) throw badRequest('Saisissez votre email et votre mot de passe.');
    const user = findByEmail(email);
    const ok = user ? await verifyPassword(user.password_hash, password) : await fakeVerify(password);
    if (!ok) throw new HttpError(401, 'Email ou mot de passe incorrect.', { code: 'BAD_CREDENTIALS' });

    await regenerate(req);
    if (!config.login2fa) {
      openSession(req, user);
      return res.json({ step: 'done', user: publicUser(user), csrf: req.session.csrf });
    }
    req.session.pendingUserId = user.id; // pas encore connecté : il manque le code
    csrfToken(req);
    if (user.totp_secret) return res.json({ step: 'totp', csrf: req.session.csrf });

    // Première connexion : configuration de la double authentification
    const secret = generateSecret();
    req.session.totpSetup = secret;
    const qr = await QRCode.toDataURL(otpauthUrl(secret, user.email), { margin: 1, width: 220, color: { dark: '#03050a', light: '#eef3ff' } });
    res.json({ step: 'setup', qr, secret, csrf: req.session.csrf });
  });

  r.post('/totp', limits.totp, async (req, res) => {
    const code = str(req.body?.code, 6);
    if (!/^\d{6}$/.test(code)) throw badRequest('Le code contient 6 chiffres.', { fields: { code: 'Le code contient 6 chiffres.' } });
    const uid = req.session.pendingUserId;
    const user = uid ? findById(uid) : null;
    const secret = user?.totp_secret || req.session.totpSetup;
    if (!user || !secret) throw new HttpError(401, 'Session expirée, reconnectez-vous.', { code: 'AUTH_REQUIRED' });

    const step = verifyCode(secret, code, user.totp_last_step);
    if (step == null) throw badRequest('Code incorrect ou expiré.', { code: 'BAD_TOTP', fields: { code: 'Code incorrect ou expiré.' } });
    db.prepare('UPDATE users SET totp_secret = ?, totp_last_step = ?, updated_at = ? WHERE id = ?').run(secret, step, now(), uid);
    await regenerate(req);
    openSession(req, user);
    res.json({ ok: true, user: publicUser(user), csrf: req.session.csrf });
  });

  r.get('/me', (req, res) => {
    const u = req.session.userId ? findById(req.session.userId) : null;
    res.json({ user: publicUser(u) });
  });

  r.post('/logout', (req, res, next) => {
    req.session.destroy((e) => (e ? next(e) : (res.clearCookie('tbm.sid'), res.json({ ok: true }))));
  });

  return r;
}
