/**
 * Sécurité HTTP :
 *  - en-têtes (helmet) avec une politique de sécurité du contenu (CSP) stricte : aucun script en ligne
 *  - protection CSRF (jeton de session envoyé dans l'en-tête X-CSRF-Token)
 *  - limites de tentatives (connexion, code 2FA, envois)
 *  - contrôle d'accès : toute l'API d'envoi exige une session ouverte
 */
import crypto from 'node:crypto';
import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { config } from './config.js';
import { forbidden, unauthorized } from './errors.js';

/* ---------- En-têtes de sécurité ---------- */

export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Aperçu des emails : styles en ligne, images et polices en ligne (https://…) des modèles
        styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: false } : false,
    referrerPolicy: { policy: 'no-referrer' },
  });
}

/* ---------- CSRF ---------- */

export function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  return req.session.csrf;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
export function csrfProtect(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  const sent = req.get('x-csrf-token') || '';
  const expected = req.session?.csrf || '';
  const ok = sent.length > 0 && sent.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) return next(forbidden('Votre session a expiré, rechargez la page puis réessayez.', { code: 'CSRF' }));
  next();
}

/* ---------- Limites de tentatives ---------- */

const limiter = (windowMin, limit, message, key) => rateLimit({
  windowMs: windowMin * 60e3,
  limit: Math.max(1, Math.round(limit * config.rateLimitFactor)),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: key || ((req) => ipKeyGenerator(req.ip || '')),
  handler: (_req, res) => res.status(429).json({ error: message, code: 'RATE_LIMIT' }),
});

export const limits = {
  // par adresse IP + email saisi
  login: limiter(15, 8, 'Trop de tentatives de connexion. Réessayez dans 15 minutes.', (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return `${ipKeyGenerator(req.ip || '')}|${email}`;
  }),
  totp: limiter(15, 10, 'Trop de codes essayés. Réessayez dans 15 minutes.'),
  // par compte : protège la réputation de l'adresse d'envoi (Zoho limite aussi les envois)
  send: rateLimit({
    windowMs: 3600e3,
    limit: config.sendsPerHour,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `user-${req.session.userId}`,
    handler: (_req, res) => res.status(429).json({ error: `Limite atteinte : ${config.sendsPerHour} emails par heure. Réessayez plus tard.`, code: 'RATE_LIMIT' }),
  }),
};

/* ---------- Contrôle d'accès ---------- */

export function requireAuth(req, _res, next) {
  if (!req.session?.userId) return next(unauthorized('Session expirée : reconnectez-vous.'));
  next();
}
