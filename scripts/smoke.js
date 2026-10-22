/**
 * Test de bout en bout :  npm test
 * Lance une copie du serveur sur une base temporaire (la base de développement n'est pas touchée),
 * en mode test (aucun email ne part), et vérifie : pages protégées, CSRF, connexion, modèles,
 * aperçu, envoi, protections des balises, import / suppression de modèle, historique (et suppression), déconnexion.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tbm-test-'));
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, DATA_DIR: DATA, PORT: String(PORT), NODE_ENV: 'development', SMTP_HOST: '', RATE_LIMIT_FACTOR: '20', SESSION_SECRET: 'test-secret-0123456789-0123456789-0123456789' };
Object.assign(process.env, env);

// Compte de test créé directement dans la base temporaire
const { db, now } = await import('../src/db.js');
const { hashPassword } = await import('../src/users.js');
db.prepare('INSERT INTO users (email, nom, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
  .run('equipe@example.com', 'Équipe', await hashPassword('Test-Bara-2026'), now(), now());
db.close();

const server = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
server.stdout.on('data', (d) => { logs += d; });
server.stderr.on('data', (d) => { logs += d; });

let passed = 0;
const check = (cond, label) => {
  if (!cond) throw new Error(`ÉCHEC : ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
};

/* ---------- Client HTTP avec cookie de session ---------- */
let cookie = '';
let csrf = '';
async function call(method, url, body, { raw = false, redirect = 'follow' } = {}) {
  const headers = { Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
  const res = await fetch(BASE + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (data.csrf) csrf = data.csrf;
  return { status: res.status, data };
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Le serveur ne démarre pas :\n${logs}`);
}

try {
  await waitReady();
  console.log('\nPages et protections');
  const home = await call('GET', '/', undefined, { raw: true });
  const homeText = await home.text();
  check(home.status === 200 && /503|indisponible/i.test(homeText), 'page d\'accueil = écran de maintenance (décor)');
  check(!/Connexion|data-step="login"/.test(homeText), 'le vrai contenu n\'est pas dans la page d\'accueil');
  check((await call('GET', '/connexion', undefined, { raw: true })).status === 200, 'login servi sur /connexion');
  const envoiRedir = await call('GET', '/envoi', undefined, { raw: true, redirect: 'manual' });
  check(envoiRedir.status === 302 && (envoiRedir.headers.get('location') || '').includes('/connexion'), '/envoi sans connexion → /connexion');
  check((await call('GET', '/api/modeles')).status === 401, 'API refusée sans connexion');
  check((await call('POST', '/api/auth/login', { email: 'equipe@example.com', password: 'Test-Bara-2026' })).status === 403, 'connexion refusée sans jeton CSRF');
  const head = await call('GET', '/', undefined, { raw: true });
  check(/frame-ancestors 'none'/.test(head.headers.get('content-security-policy') || ''), 'en-têtes de sécurité (CSP) présents');

  console.log('\nConnexion');
  csrf = (await call('GET', '/api/auth/csrf')).data.token;
  check((await call('POST', '/api/auth/login', { email: 'equipe@example.com', password: 'mauvais' })).status === 401, 'mauvais mot de passe refusé');
  check((await call('POST', '/api/auth/login', { email: 'inconnu@example.com', password: 'Test-Bara-2026' })).status === 401, 'compte inconnu refusé (même message)');
  const login = await call('POST', '/api/auth/login', { email: 'EQUIPE@example.com', password: 'Test-Bara-2026' });
  check(login.status === 200 && login.data.step === 'done', 'connexion réussie (email insensible à la casse)');
  check((await call('GET', '/envoi', undefined, { raw: true, redirect: 'manual' })).status === 200, '/envoi accessible une fois connecté');
  const st = await call('GET', '/api/status');
  check(st.data.mode === 'test' && st.data.user.nom === 'Équipe', 'statut : mode test + compte connecté');

  console.log('\nModèles');
  const list = (await call('GET', '/api/modeles')).data;
  check(list.length === 4, '4 modèles Trading Bara installés au premier démarrage');
  check(list.find((t) => t.slug === 'facture')?.facture === true, 'modèle « facture » détecté (contient {{lien_facture}})');
  check(list.find((t) => t.slug === 'bienvenue')?.facture === false, 'modèle sans {{lien_facture}} = non-facture');
  const bienvenue = list.find((t) => t.slug === 'bienvenue');
  check(bienvenue?.nom === 'Bienvenue — accès au canal', 'nom lu dans <meta name="modele">');
  check(list.find((t) => t.slug === 'test')?.nom === 'Test d\'envoi', 'apostrophe dans le nom conservée');
  check(bienvenue.balises.find((b) => b.nom === 'lien_telegram')?.type === 'lien', 'balise dans un lien détectée comme « lien »');
  check(list.find((t) => t.slug === 'test').balises.find((b) => b.nom === 'message')?.type === 'texte', '{{message}} détecté comme texte multiligne');
  const one = (await call('GET', '/api/modeles/bienvenue')).data;
  check(one.apercu.includes('/email-assets/logo.png') && one.html.includes('cid:logo'), 'logo cid:logo → image locale pour l\'aperçu');
  check((await call('GET', '/email-assets/logo.png', undefined, { raw: true })).status === 200, 'logo des emails servi');
  check((await call('GET', '/api/modeles/..%2F..%2Fsecret')).status === 400, 'nom de modèle invalide refusé');

  console.log('\nAperçu et envoi');
  const ap = (await call('POST', '/api/apercu', { modele: 'bienvenue', to: 'alex@example.com', vars: { prenom: 'Alex' } })).data;
  check(ap.subject === 'Bienvenue chez Trading Bara, Alex 🐾', 'objet rempli avec les balises');
  check(ap.missing.join() === 'date_fin,lien_telegram', 'balises manquantes signalées');
  check(ap.html.includes('{{date_fin}}'), 'balise vide visible dans l\'aperçu');
  const incomplete = await call('POST', '/api/envoi', { modele: 'bienvenue', to: 'alex@example.com', vars: { prenom: 'Alex' } });
  check(incomplete.status === 400 && incomplete.data.fields?.var_date_fin, 'envoi refusé s\'il manque une balise');
  const js = await call('POST', '/api/envoi', { modele: 'bienvenue', to: 'alex@example.com', vars: { prenom: 'Alex', date_fin: '6 nov.', lien_telegram: 'javascript:alert(1)' } });
  check(js.status === 400 && js.data.fields?.var_lien_telegram, 'lien non https:// refusé');
  const badTo = await call('POST', '/api/envoi', { modele: 'test', to: 'pas-une-adresse', vars: { prenom: 'A', message: 'B' } });
  check(badTo.status === 400 && badTo.data.fields?.to, 'adresse du destinataire invalide refusée');
  const sent = await call('POST', '/api/envoi', { modele: 'test', to: 'alex@example.com', vars: { prenom: '<script>alert(1)</script>', message: 'Ligne 1\nLigne 2' } });
  check(sent.status === 200 && sent.data.mode === 'test', 'envoi accepté (mode test)');
  const outbox = fs.readdirSync(path.join(DATA, 'outbox'));
  const mail = fs.readFileSync(path.join(DATA, 'outbox', outbox[0]), 'utf8');
  check(outbox.length === 1, 'email enregistré dans data/outbox/');
  check(!mail.includes('<script>alert') && mail.includes('&lt;script&gt;'), 'valeurs protégées (aucun code injecté)');
  check(mail.includes('Ligne 1<br>Ligne 2'), 'retours à la ligne du message conservés');
  check(mail.includes('data:image/png;base64'), 'logo intégré dans l\'email de test');
  check(fs.readFileSync(path.join(ROOT, 'modeles-defaut/test.html'), 'utf8').includes('<!-- EN-TÊTE') && !mail.includes('EN-TÊTE'), 'commentaires du modèle retirés');

  console.log('\nImport et suppression d\'un modèle');
  const html = '<!DOCTYPE html><html><head><meta name="modele" content="Code promo"><title>Ton code {{code}}</title></head><body><p>Salut {{prenom}}, voici <a href="{{lien}}">ton lien</a>.</p></body></html>';
  const imp = await call('POST', '/api/modeles', { fichier: 'Code Promo.html', html });
  check(imp.status === 201 && imp.data.slug === 'code-promo' && imp.data.balises.map((b) => b.nom).join() === 'code,prenom,lien', 'import : nom de fichier nettoyé, balises détectées');
  check((await call('POST', '/api/modeles', { fichier: 'x.txt', html })).status === 400, 'fichier non .html refusé');
  check((await call('POST', '/api/modeles', { fichier: 'Code Promo.html', html })).status === 200, 'même nom : modèle remplacé');
  check((await call('DELETE', '/api/modeles/code-promo')).status === 200, 'modèle supprimé');

  console.log('\nFactures (modèle « facture »)');
  // Aperçu : pas de facture créée, lien /facture/apercu
  const fap = (await call('POST', '/api/apercu', { modele: 'facture', to: 'cli@example.com', vars: { prenom: 'Léa' }, f_montant: '49' })).data;
  check(fap.facture === true, 'aperçu signale un modèle facture');
  check(fap.html.includes('/facture/apercu') && fap.html.includes('49,00'), 'aperçu : lien /facture/apercu + montant formaté');
  check(!fap.missing.includes('lien_facture') && !fap.missing.includes('montant'), 'balises facture non demandées comme simples cases');
  // Envoi sans montant → refusé
  const noMontant = await call('POST', '/api/envoi', { modele: 'facture', to: 'cli@example.com', vars: { prenom: 'Léa' } });
  check(noMontant.status === 400 && noMontant.data.fields?.f_montant, 'envoi facture refusé sans montant');
  // Envoi complet → facture créée + lien
  const fsent = await call('POST', '/api/envoi', { modele: 'facture', to: 'cli@example.com', vars: { prenom: 'Léa' }, f_montant: '49,90', f_date: '2026-10-08', f_heure: '14:30', f_lieu: 'En ligne', f_client: 'Léa Bernard' });
  check(fsent.status === 200 && fsent.data.facture?.numero?.startsWith('TB-') && /\/facture\/[a-z0-9]{6,}$/.test(fsent.data.facture.url), 'facture créée : numéro TB-… + lien à id');
  const fid = fsent.data.facture.url.split('/').pop();
  // Lecture publique (sans connexion : fetch direct, sans cookie)
  const pub = await fetch(`${BASE}/api/facture/${fid}`).then((r) => r.json());
  check(pub.numero === fsent.data.facture.numero && pub.montant === '49,90 €' && pub.client_nom === 'Léa Bernard', 'facture lisible publiquement par son lien (données correctes)');
  check(pub.date_paiement.includes('octobre') && pub.heure === '14:30' && pub.lieu === 'En ligne', 'date/heure/lieu enregistrés');
  check((await fetch(`${BASE}/api/facture/inexistant999`)).status === 404, 'id inconnu → 404');
  check((await fetch(`${BASE}/facture/${fid}`)).status === 200, 'page /facture/<id> servie');
  check((await fetch(`${BASE}/facture`)).status === 200, 'page /facture (exemple) servie');

  console.log('\nObjet de l\'email (modifiable)');
  const subA = (await call('POST', '/api/apercu', { modele: 'test', to: 'a@b.co', subject: 'Perso {{prenom}} !', vars: { prenom: 'Zoé', message: 'x' } })).data;
  check(subA.subject === 'Perso Zoé !', 'objet personnalisé pris en compte (balises remplies)');
  const subB = (await call('POST', '/api/apercu', { modele: 'test', to: 'a@b.co', subject: '', vars: { prenom: 'Zoé', message: 'x' } })).data;
  check(/Trading Bara/.test(subB.subject), 'objet vide → objet du modèle (<title>)');
  // Modèle sans <title> : l'objet saisi devient obligatoire
  const noTitleHtml = '<!DOCTYPE html><html><head><meta name="modele" content="Sans titre"></head><body><p>Salut {{prenom}}</p></body></html>';
  await call('POST', '/api/modeles', { fichier: 'sans-titre.html', html: noTitleHtml });
  const noSubj = await call('POST', '/api/envoi', { modele: 'sans-titre', to: 'a@b.co', vars: { prenom: 'Zoé' } });
  check(noSubj.status === 400 && noSubj.data.fields?.subject, 'modèle sans <title> et sans objet saisi → refusé');
  const withSubj = await call('POST', '/api/envoi', { modele: 'sans-titre', to: 'a@b.co', subject: 'Mon objet', vars: { prenom: 'Zoé' } });
  check(withSubj.status === 200, 'modèle sans <title> + objet saisi → accepté');
  check((await call('DELETE', '/api/modeles/sans-titre')).status === 200, 'nettoyage du modèle de test');

  check((await call('GET', '/api/modeles')).data.length === 4, 'liste des modèles à jour (4 par défaut)');

  console.log('\nHistorique et statistiques');
  const hist = (await call('GET', '/api/historique')).data;
  check(hist.length === 3 && hist[0].statut === 'test' && hist[0].par === 'Équipe', 'envois notés dans l\'historique');
  const stats = (await call('GET', '/api/stats')).data;
  check(stats.aujourdhui === 3 && stats.total === 3 && stats.parJour.length === 14, 'statistiques à jour');
  check((await call('DELETE', '/api/historique', { ids: [] })).status === 400, 'suppression sans ligne choisie refusée');
  check((await call('DELETE', '/api/historique', { ids: ['1 OR 1=1'] })).status === 400, 'identifiants invalides ignorés');
  const delH = await call('DELETE', '/api/historique', { ids: [hist[0].id, hist[0].id, 999999] });
  check(delH.status === 200 && delH.data.supprimes === 1, 'ligne choisie supprimée de l\'historique (doublons / inconnus ignorés)');
  const hist2 = (await call('GET', '/api/historique')).data;
  check(hist2.length === 2 && !hist2.some((r) => r.id === hist[0].id), 'historique à jour après suppression');
  check((await call('GET', '/api/stats')).data.total === 2, 'statistiques à jour après suppression');
  check((await fetch(`${BASE}/api/facture/${fid}`)).status === 200, 'les factures ne sont pas touchées');

  console.log('\nModèles de factures (designs de la page facture)');
  const fm = (await call('GET', '/api/factures/modeles')).data;
  check(fm.modeles.length === 1 && fm.modeles[0].slug === 'standard' && fm.actif === 'standard', '1 modèle de facture par défaut (standard, actif)');
  check(Array.isArray(fm.balises) && fm.balises.some((b) => b.nom === 'montant'), 'liste des balises de facture fournie');
  // La page facture est rendue depuis le modèle (contient numéro + montant réels)
  const fpage = await (await fetch(`${BASE}/facture/${fid}`)).text();
  check(fpage.includes(fsent.data.facture.numero) && fpage.includes('49,90'), 'page facture rendue avec le modèle (numéro + montant)');
  // Import d'un design perso + mise par défaut
  const designHtml = '<!DOCTYPE html><html><head><meta name="modele" content="Mon design"><title>F {{numero_facture}}</title></head><body><p>PERSO {{client_nom}} TTC {{montant}} HT {{montant_ht}} TVA {{montant_tva}} ({{taux_tva}})</p></body></html>';
  const impF = await call('POST', '/api/factures/modeles', { fichier: 'Mon Design.html', html: designHtml });
  check(impF.status === 201 && impF.data.slug === 'mon-design', 'import d\'un design de facture');
  check((await call('PUT', '/api/factures/modeles/active', { slug: 'mon-design' })).data.actif === 'mon-design', 'design perso mis par défaut (★)');
  // Une NOUVELLE facture utilise le design actif ; l'ancienne garde le sien ; TVA calculée auto (120 TTC → 100 HT + 20 TVA)
  const f2 = await call('POST', '/api/envoi', { modele: 'facture', to: 'cli2@example.com', vars: { prenom: 'Max' }, f_montant: '120', f_client: 'Max Payne' });
  const f2id = f2.data.facture.url.split('/').pop();
  const f2page = await (await fetch(`${BASE}/facture/${f2id}`)).text();
  check(f2page.includes('PERSO Max Payne TTC 120,00'), 'nouvelle facture rendue avec le design perso + ses données');
  check(f2page.includes('HT 100,00 € TVA 20,00 € (20 %)'), 'TVA 20 % calculée automatiquement (HT + TVA)');
  const oldPage = await (await fetch(`${BASE}/facture/${fid}`)).text();
  check(!oldPage.includes('FACTURE PERSO'), 'ancienne facture garde son design d\'origine');
  check((await call('DELETE', '/api/factures/modeles/mon-design')).data.actif === 'standard', 'suppression du design → le défaut repasse à standard');
  check((await call('DELETE', '/api/factures/modeles/standard')).status === 400, 'impossible de supprimer le dernier modèle de facture');

  console.log('\nDéconnexion');
  check((await call('POST', '/api/auth/logout')).status === 200, 'déconnexion');
  check((await call('GET', '/api/modeles')).status === 401, 'API refusée après déconnexion');

  console.log(`\n✓ ${passed} vérifications réussies.\n`);
} catch (e) {
  console.error(`\n✗ ${e.message}\n\n--- journaux du serveur ---\n${logs}`);
  process.exitCode = 1;
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(DATA, { recursive: true, force: true });
}
