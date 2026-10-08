/**
 * Comptes de l'équipe — en ligne de commande uniquement (aucune création de compte sur le site).
 *   npm run create-user                          créer un compte (questions interactives)
 *   npm run create-user -- --list                lister les comptes
 *   npm run create-user -- --password email      changer le mot de passe (ferme ses connexions ouvertes)
 *   npm run create-user -- --reset-2fa email     réinitialiser la double authentification
 *   npm run create-user -- --delete email        supprimer un compte
 * Sur le serveur : docker compose exec app node scripts/create-user.js [options]
 */
import readline from 'node:readline';
import { config } from '../src/config.js';
import { db, now } from '../src/db.js';
import { hashPassword, passwordProblem, findByEmail } from '../src/users.js';

function ask(question, hidden = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : '*'.repeat(s.length ? 1 : 0));
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); }));
}

async function askPassword() {
  const pw = await ask('Mot de passe (10 caractères minimum, avec majuscule, minuscule et chiffre) : ', true);
  const problem = passwordProblem(pw);
  if (problem) throw new Error(problem);
  if (pw !== await ask('Confirmation : ', true)) throw new Error('Les mots de passe ne correspondent pas.');
  return hashPassword(pw);
}

const [option, arg = ''] = process.argv.slice(2);
const email = arg.trim().toLowerCase();
const existing = () => {
  const u = findByEmail(email);
  if (!u) throw new Error(`Aucun compte avec l'email « ${email} ».`);
  return u;
};

try {
  switch (option) {
    case '--list': {
      const users = db.prepare('SELECT email, nom, created_at, last_login_at, totp_secret FROM users ORDER BY email').all();
      if (!users.length) console.log('Aucun compte. Créez-en un : npm run create-user');
      for (const u of users) console.log(`- ${u.email} (${u.nom}) · créé le ${u.created_at.slice(0, 10)} · dernière connexion : ${u.last_login_at?.slice(0, 16).replace('T', ' ') || 'jamais'}${u.totp_secret ? ' · 2FA ✓' : ''}`);
      break;
    }
    case '--password': {
      const u = existing();
      const hash = await askPassword();
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, now(), u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      console.log('\n✓ Mot de passe changé (ses connexions ouvertes sont fermées).');
      break;
    }
    case '--reset-2fa': {
      const u = existing();
      db.prepare('UPDATE users SET totp_secret = NULL, totp_last_step = NULL, updated_at = ? WHERE id = ?').run(now(), u.id);
      console.log('✓ Double authentification réinitialisée : elle sera reconfigurée à la prochaine connexion.');
      break;
    }
    case '--delete': {
      const u = existing();
      const ok = await ask(`Supprimer le compte ${u.email} (${u.nom}) ? (oui/non) `);
      if (!/^o(ui)?$/i.test(ok)) { console.log('Annulé.'); break; }
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
      console.log('✓ Compte supprimé (l\'historique de ses envois est conservé).');
      break;
    }
    case undefined: {
      console.log('\n=== Nouveau compte — Trading Bara Mail ===\n');
      const mail = (await ask('Email (identifiant de connexion) : ')).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(mail)) throw new Error('Email invalide.');
      if (findByEmail(mail)) throw new Error('Ce compte existe déjà (pour changer son mot de passe : --password email).');
      const nom = await ask('Nom affiché (ex. Bara) : ');
      if (!nom) throw new Error('Nom requis.');
      const hash = await askPassword();
      const ts = now();
      db.prepare('INSERT INTO users (email, nom, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(mail, nom.slice(0, 60), hash, ts, ts);
      console.log(`\n✓ Compte créé. Connexion : ${config.siteUrl}/`);
      if (config.login2fa) console.log('  La double authentification sera configurée à la première connexion.');
      break;
    }
    default:
      console.log('Options : --list | --password email | --reset-2fa email | --delete email');
  }
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
