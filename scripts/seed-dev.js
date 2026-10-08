/**
 * DÉVELOPPEMENT UNIQUEMENT : crée le compte de démonstration pour tester l'interface en local.
 *   npm run seed-dev   →  demo@tradingbara.test / Demo-Bara-2026
 * Refusé en production (NODE_ENV=production) : là-bas, les comptes se créent avec npm run create-user.
 */
import { config } from '../src/config.js';
import { db, now } from '../src/db.js';
import { hashPassword, findByEmail } from '../src/users.js';

const DEMO = { email: 'demo@tradingbara.test', nom: 'Démo', password: 'Demo-Bara-2026' };

if (config.isProd) {
  console.error('✗ Compte de démonstration refusé en production.');
  process.exit(1);
}
const hash = await hashPassword(DEMO.password);
const existing = findByEmail(DEMO.email);
if (existing) db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, now(), existing.id);
else db.prepare('INSERT INTO users (email, nom, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(DEMO.email, DEMO.nom, hash, now(), now());
console.log(`✓ Compte de démonstration prêt : ${DEMO.email} / ${DEMO.password}  (${config.siteUrl}/)`);
db.close();
