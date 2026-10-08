/**
 * ============================================================
 *  TRADING BARA — INTERFACE D'ENVOI D'EMAILS (Express + SQLite)
 * ============================================================
 *  /          page de connexion (pas de création de compte)
 *  /envoi     interface d'envoi : modèles, balises, aperçu, historique
 *  /api       connexion + envoi (session obligatoire)
 *  Lancement : npm run dev → http://localhost:8090
 * ============================================================
 */
import path from 'node:path';
import express from 'express';
import session from 'express-session';
import compression from 'compression';
import { config, ROOT } from './config.js';
import { db } from './db.js';
import { SqliteSessionStore } from './session-store.js';
import { HttpError } from './errors.js';
import { securityHeaders, csrfProtect } from './security.js';
import { authRouter } from './routes/auth.js';
import { mailRouter } from './routes/mail.js';
import { installDefaults, ASSETS_DIR } from './modeles.js';
import { publicFacture, getFactureRow, factureTemplateValues, factureExampleValues } from './factures.js';
import { installFactureDefaults, getActiveSlug, renderFacture } from './facture-modeles.js';
import { checkSmtp } from './mailer.js';

const installed = installDefaults();
if (installed) console.log(`[modèles] ${installed} modèles Trading Bara installés dans data/modeles/`);
installFactureDefaults();

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy); // derrière le tunnel Cloudflare en production

app.use(securityHeaders());
app.use(compression()); // three.js pèse 2 Mo non compressé (≈ 450 Ko compressé)

/* ---------- Sessions (cookie httpOnly, stockées en base, durée fixe) ---------- */
const ttlMs = config.sessionHours * 3600e3;
const store = new SqliteSessionStore(db, { ttlMs });
app.use(session({
  name: 'tbm.sid',
  secret: config.sessionSecret,
  store,
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: config.isProd, maxAge: ttlMs },
}));

/* ---------- API ---------- */
const api = express.Router();
api.use('/modeles', express.json({ limit: '700kb' })); // import d'un modèle d'email (.html)
api.use('/factures/modeles', express.json({ limit: '800kb' })); // import d'un modèle de facture (.html)
api.use(express.json({ limit: '40kb' }));
api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
api.get('/health', (_req, res) => res.json({ ok: true }));
api.use(csrfProtect);
// Lecture d'une facture par son lien (PUBLIC, sans connexion) : l'id non devinable fait office de clé.
api.get('/facture/:id', (req, res) => {
  const f = publicFacture(req.params.id);
  if (!f) throw new HttpError(404, 'Facture introuvable.');
  res.json(f);
});
api.use('/auth', authRouter());
api.use('/', mailRouter());
api.use((_req, _res, next) => next(new HttpError(404, 'Ressource introuvable.')));
app.use('/api', api);

/* ---------- Pages (connexion vérifiée par le serveur) ---------- */
const VIEWS = path.join(ROOT, 'views');
const page = (file) => (_req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(VIEWS, file));
// « / » : écran de maintenance (décor) pour tout le monde. Le vrai outil est derrière /connexion.
app.get('/', page('accueil.html'));
app.get('/connexion', (req, res, next) => (req.session.userId ? res.redirect('/envoi') : page('connexion.html')(req, res, next)));
app.get('/envoi', (req, res, next) => (req.session.userId ? page('envoi.html')(req, res, next) : res.redirect('/connexion')));

// Page facture (publique) : rendue côté serveur à partir du modèle de facture choisi.
//   /facture        → aperçu d'exemple (modèle par défaut)
//   /facture/<id>   → la facture d'un client, via son lien (id non devinable)
function factureNotFound(res) {
  res.status(404).type('html').send('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Facture introuvable</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05070d;color:#aab6cf;font-family:system-ui,-apple-system,Arial,sans-serif;padding:24px}.c{max-width:440px;text-align:center}.c h1{color:#eef3ff;font-size:20px;margin:0 0 10px}a{color:#5aa9ff}</style></head><body><div class="c"><h1>Facture introuvable</h1><p>Ce lien de facture n\'est pas valide. Vérifiez le lien reçu par email, ou écrivez à <a href="mailto:contact@tradingbara.uk">contact@tradingbara.uk</a>.</p></div></body></html>');
}
app.get('/facture', (_req, res) => {
  const html = renderFacture(getActiveSlug(), factureExampleValues(), { example: true });
  return html ? res.set('Cache-Control', 'no-store').type('html').send(html) : factureNotFound(res);
});
app.get('/facture/:id', (req, res) => {
  const row = getFactureRow(req.params.id);
  if (!row) return factureNotFound(res);
  const html = renderFacture(row.modele, factureTemplateValues(row), { example: false });
  return html ? res.set('Cache-Control', 'no-store').type('html').send(html) : factureNotFound(res);
});

/* ---------- Fichiers statiques ---------- */
const nm = (p) => path.join(ROOT, 'node_modules', p);
const staticOpts = { maxAge: config.isProd ? '7d' : 0, index: false };
app.use('/vendor/three', express.static(nm('three/build'), staticOpts));
app.use('/vendor/gsap', express.static(nm('gsap'), { ...staticOpts, extensions: ['js'] }));
app.use('/vendor/fonts/geist', express.static(nm('@fontsource-variable/geist/files'), staticOpts));
app.use('/vendor/fonts/geist-mono', express.static(nm('@fontsource-variable/geist-mono/files'), staticOpts));
app.use('/vendor/fonts/unbounded', express.static(nm('@fontsource-variable/unbounded/files'), staticOpts));
app.use('/email-assets', express.static(ASSETS_DIR, staticOpts));
app.use(express.static(path.join(ROOT, 'public'), {
  ...staticOpts,
  setHeaders: (res, file) => { if (/\.(js|css)$/.test(file)) res.set('Cache-Control', 'no-cache'); },
}));
app.use((_req, res) => res.status(404).type('text/plain; charset=utf-8').send('404 — page introuvable'));

/* ---------- Erreurs ---------- */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Requête invalide.');
  if (err.type === 'entity.too.large') err = new HttpError(413, 'Fichier trop volumineux.');
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(`[erreur] ${req.method} ${req.originalUrl}`, err);
  res.status(status).json({
    error: status >= 500 ? 'Une erreur est survenue, réessayez dans un instant.' : err.message,
    ...(err.code ? { code: err.code } : {}),
    ...(err.fields ? { fields: err.fields } : {}),
  });
});

const server = app.listen(config.port, () => {
  console.log(`Trading Bara Mail → ${config.siteUrl}  (${config.isProd ? 'production' : 'développement'})`);
  checkSmtp();
});

// Arrêt propre (Docker)
const stop = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
