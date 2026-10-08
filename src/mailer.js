/**
 * Envoi des emails.
 *  - Production : SMTP Zoho (variables SMTP_* du .env) — l'expéditeur MAIL_FROM doit être la boîte Zoho
 *    utilisée pour la connexion (ou un de ses alias), sinon Zoho refuse l'envoi.
 *  - Mode test (pas de SMTP_HOST) : rien ne part ; l'email est enregistré dans data/outbox/
 *    (fichier .html à ouvrir dans le navigateur).
 */
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { config } from './config.js';
import { embedImages } from './modeles.js';

const transport = config.mail.host
  ? nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  })
  : null;

export const OUTBOX = path.join(config.dataDir, 'outbox');
export const mailMode = transport ? 'smtp' : 'test';
/** Adresse affichée dans l'interface (« Trading Bara <contact@…> » → contact@…). */
export const fromAddress = config.mail.from.match(/<([^>]+)>/)?.[1] || config.mail.from;

/** Vérifie la connexion au serveur SMTP au démarrage (identifiants, port) : résultat dans les journaux. */
export async function checkSmtp() {
  if (!transport) {
    console.log('[email] Mode test : aucun SMTP configuré, les emails sont enregistrés dans data/outbox/');
    return;
  }
  try {
    await transport.verify();
    console.log(`[email] SMTP ${config.mail.host} : connexion OK (envoi depuis ${fromAddress})`);
  } catch (e) {
    console.error(`[email] SMTP ${config.mail.host} : connexion IMPOSSIBLE — ${e.message}`);
  }
}

/** Traduit les erreurs SMTP les plus courantes en message clair. */
function explain(e) {
  const msg = String(e.response || e.message || e);
  if (e.code === 'EAUTH' || /535|auth/i.test(msg)) return 'Zoho refuse la connexion : vérifiez SMTP_USER et le mot de passe d\'application (SMTP_PASS).';
  if (/553|relay|not allowed to send|sender address/i.test(msg)) return 'Zoho refuse l\'expéditeur : MAIL_FROM doit être l\'adresse de la boîte Zoho (ou un de ses alias).';
  if (/550|554|mailbox|recipient|user unknown/i.test(msg)) return `Adresse refusée par le serveur : ${msg.slice(0, 160)}`;
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS'].includes(e.code)) return 'Serveur d\'envoi injoignable pour le moment : réessayez dans un instant.';
  return `Envoi impossible : ${msg.slice(0, 160)}`;
}

/**
 * Envoie un email. Renvoie { ok, mode, error } — error : message lisible si l'envoi a échoué.
 */
export async function sendMail({ to, subject, html, text, attachments = [] }) {
  if (transport) {
    try {
      await transport.sendMail({
        from: config.mail.from, to, subject, html, text, attachments,
        ...(config.mail.replyTo ? { replyTo: config.mail.replyTo } : {}),
      });
      return { ok: true, mode: 'smtp' };
    } catch (e) {
      console.error(`[email] échec « ${subject} » → ${to} : ${e.message}`);
      return { ok: false, mode: 'smtp', error: explain(e) };
    }
  }
  fs.mkdirSync(OUTBOX, { recursive: true });
  const file = path.join(OUTBOX, `${Date.now()}-${to.replace(/[^a-z0-9@._-]/gi, '_')}.html`);
  fs.writeFileSync(file, `<!-- À : ${to} | Objet : ${subject} -->\n${embedImages(html)}`);
  console.log(`[email] (mode test) « ${subject} » → ${to}\n        fichier : ${file}`);
  return { ok: true, mode: 'test' };
}
