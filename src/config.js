/**
 * Configuration, lue depuis les variables d'environnement
 * (fichier .env à la racine en local, variables Docker en production). Modèle : .env.example
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Chargement de .env s'il existe (fonction native de Node ≥ 20.12)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const port = Number(env.PORT || 8090);

export const config = {
  isProd,
  port,
  /** Adresse publique de l'interface (ex. https://mail.tradingbara.uk). */
  siteUrl: (env.SITE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  /** Données : base SQLite, modèles d'emails, emails de test. */
  dataDir: path.resolve(env.DATA_DIR || path.join(ROOT, 'data')),
  /** Nombre de proxys de confiance devant l'app (1 derrière le tunnel Cloudflare). */
  trustProxy: Number(env.TRUST_PROXY || 0),
  /** Multiplicateur des limites de tentatives : 1 en production (strict), 20 en développement (tests). */
  rateLimitFactor: Number(env.RATE_LIMIT_FACTOR || (isProd ? 1 : 20)),
  sessionSecret: env.SESSION_SECRET || '',
  /** Durée d'une connexion (heures), sans prolongation : il faut se reconnecter ensuite. */
  sessionHours: Number(env.SESSION_HOURS || 12),
  /** Double authentification (code d'une appli sur le téléphone) : LOGIN_2FA=on pour l'activer. */
  login2fa: env.LOGIN_2FA === 'on',
  /** Nombre maximum d'emails envoyés par heure et par compte. */
  sendsPerHour: Number(env.SENDS_PER_HOUR || 60),
  mail: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 465),
    secure: (env.SMTP_SECURE || 'true') === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'Trading Bara <contact@tradingbara.uk>',
    replyTo: env.MAIL_REPLY_TO || '',
  },
};

if (!config.sessionSecret) {
  if (isProd) throw new Error('SESSION_SECRET manquant : définissez-le dans .env (64 caractères aléatoires).');
  config.sessionSecret = 'dev-uniquement-ne-pas-utiliser-en-production-0123456789';
  console.warn('[config] SESSION_SECRET absent : clé de développement utilisée.');
} else if (config.sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET trop court (32 caractères minimum).');
}

fs.mkdirSync(config.dataDir, { recursive: true });
