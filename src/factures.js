/**
 * Factures : créées à l'envoi d'un email « de type facture » (modèle contenant {{lien_facture}}).
 * Chaque facture a un identifiant de lien non devinable (ex. /facture/bxj7q2hd9ka3) qui sert de
 * « capacité » : seul celui qui a le lien voit cette facture (comme un reçu Stripe/PayPal).
 */
import crypto from 'node:crypto';
import { db, now } from './db.js';
import { config } from './config.js';
import { fieldError } from './errors.js';

const ALPH = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** Identifiant de lien : 12 caractères a-z0-9 tirés au hasard. */
function newId() {
  const b = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPH[b[i] % ALPH.length];
  return s;
}

export const euros = (cents) => `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Taux de TVA (France standard). À changer ici si besoin. */
const TVA_RATE = 0.20;
/**
 * Décompose un montant TTC (ce que le client a payé) en HT + TVA.
 * Renvoie les balises prêtes à l'emploi (vides si aucun montant).
 */
function montantParts(cents) {
  if (cents == null) return { montant: '', montant_ht: '', montantht: '', montant_tva: '', montanttva: '', taux_tva: `${Math.round(TVA_RATE * 100)} %` };
  const ht = Math.round(cents / (1 + TVA_RATE));
  const tva = cents - ht;
  return {
    montant: euros(cents), montant_ht: euros(ht), montantht: euros(ht),
    montant_tva: euros(tva), montanttva: euros(tva), taux_tva: `${Math.round(TVA_RATE * 100)} %`,
  };
}
const parseMontant = (v) => {
  const s = String(v ?? '').replace(',', '.').replace(/[^\d.]/g, '');
  if (!s) return NaN; // vide = non renseigné (et non pas 0)
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
/** « 2026-10-08 » → « 8 octobre 2026 » (laisse le texte tel quel si ce n'est pas une date ISO). */
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Lit et vérifie les champs de l'encadré Facture (préfixe f_). */
export function factureInput(p) {
  const montant = parseMontant(p.f_montant);
  if (!Number.isFinite(montant) || montant < 0) throw fieldError('f_montant', 'Indiquez le montant réglé (ex. 49 ou 49,00).');
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    client_nom: str(p.f_client, 120) || str(p.prenom, 120) || 'Client',
    montant_cents: montant,
    date_paiement: /^\d{4}-\d{2}-\d{2}$/.test(p.f_date) ? p.f_date : '',
    heure: /^\d{1,2}:\d{2}$/.test(p.f_heure) ? p.f_heure : '',
    lieu: str(p.f_lieu, 160),
    description: str(p.f_description, 200) || 'Abonnement canal privé Trading Bara',
  };
}

/** Lecture tolérante pour l'APERÇU (ne lève jamais : le montant peut être vide tant qu'on n'envoie pas). */
export function facturePreviewData(p) {
  const montant = parseMontant(p.f_montant);
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    client_nom: str(p.f_client, 120) || str(p.prenom, 120) || 'Client',
    montant_cents: Number.isFinite(montant) && montant >= 0 ? montant : null,
    date_paiement: /^\d{4}-\d{2}-\d{2}$/.test(p.f_date) ? p.f_date : '',
    heure: /^\d{1,2}:\d{2}$/.test(p.f_heure) ? p.f_heure : '',
    lieu: str(p.f_lieu, 160),
    description: str(p.f_description, 200) || 'Abonnement canal privé Trading Bara',
  };
}

/** Valeurs des balises gérées par l'encadré Facture (pour l'aperçu comme pour l'envoi). */
export function factureVars(data, id) {
  return {
    ...montantParts(data.montant_cents),               // montant, montant_ht, montant_tva, taux_tva
    lien_facture: `${config.siteUrl}/facture/${id}`,
    numero_facture: data.numero || (id === 'apercu' ? 'APERÇU' : ''),
    date_paiement: longDate(data.date_paiement),
    heure: data.heure,
    lieu: data.lieu,
    description: data.description,
    client_nom: data.client_nom,
  };
}

/** Balises remplies automatiquement par l'encadré Facture (donc pas demandées comme simples cases). */
export const FACTURE_TAGS = ['lien_facture', 'numero_facture', 'montant', 'montant_ht', 'montantht', 'montant_tva', 'montanttva', 'taux_tva', 'date_paiement', 'heure', 'lieu', 'description', 'client_nom'];

/** Numéro de facture lisible : TB-AAAA-NNNN (compteur par année). */
function nextNumero() {
  const year = new Date().getFullYear();
  const n = db.prepare('SELECT COUNT(*) AS c FROM factures WHERE numero LIKE ?').get(`TB-${year}-%`).c;
  return `TB-${year}-${String(n + 1).padStart(4, '0')}`;
}

/** Crée et enregistre une facture. modele = modèle de facture utilisé ; vars = balises du mail. Renvoie { id, numero, … }. */
export function createFacture(data, { client_email, user, modele = '', vars = {} }) {
  let id = newId();
  while (db.prepare('SELECT 1 FROM factures WHERE id = ?').get(id)) id = newId();
  const numero = nextNumero();
  db.prepare(`INSERT INTO factures (id, numero, created_at, user_id, user_nom, client_nom, client_email,
      montant_cents, date_paiement, heure, lieu, description, modele, vars)
    VALUES (@id, @numero, @created_at, @user_id, @user_nom, @client_nom, @client_email,
      @montant_cents, @date_paiement, @heure, @lieu, @description, @modele, @vars)`).run({
    id, numero, created_at: now(), user_id: user?.id ?? null, user_nom: user?.nom ?? '',
    client_nom: data.client_nom, client_email,
    montant_cents: data.montant_cents, date_paiement: data.date_paiement,
    heure: data.heure, lieu: data.lieu, description: data.description,
    modele: modele || '', vars: JSON.stringify(vars || {}),
  });
  return { id, numero, ...data };
}

const safeParse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

/** Ligne brute d'une facture (null si absente). */
export function getFactureRow(id) {
  if (!/^[a-z0-9]{6,40}$/.test(id || '')) return null;
  return db.prepare('SELECT * FROM factures WHERE id = ?').get(id) || null;
}

/** Valeurs des balises pour remplir un modèle de facture (balises du mail + infos facture). */
export function factureTemplateValues(row) {
  return {
    ...safeParse(row.vars),                       // balises du mail (prenom, etc.)
    ...montantParts(row.montant_cents),           // montant, montant_ht, montant_tva, taux_tva
    numero_facture: row.numero,
    numero: row.numero,
    date_paiement: longDate(row.date_paiement),
    heure: row.heure || '',
    lieu: row.lieu || '',
    client_nom: row.client_nom,
    client_email: row.client_email,
    description: row.description,
    emise_le: longDate(row.created_at.slice(0, 10)),
  };
}

/** Valeurs d'exemple (page /facture sans identifiant). */
export function factureExampleValues() {
  const today = longDate(new Date().toISOString().slice(0, 10));
  return {
    ...montantParts(4900),
    prenom: 'Alex', numero_facture: 'TB-2026-0000', numero: 'TB-2026-0000',
    date_paiement: today, heure: '14:30', lieu: 'En ligne',
    client_nom: 'Client Exemple', client_email: 'client@exemple.com',
    description: 'Abonnement canal privé Trading Bara', emise_le: today,
  };
}

/** Supprime une facture (annulation si l'email n'est finalement pas parti). */
export function deleteFacture(id) {
  db.prepare('DELETE FROM factures WHERE id = ?').run(id);
}

/** Données publiques d'une facture (affichées sur /facture/<id>), ou null. */
export function publicFacture(id) {
  if (!/^[a-z0-9]{6,40}$/.test(id || '')) return null;
  const f = db.prepare('SELECT * FROM factures WHERE id = ?').get(id);
  if (!f) return null;
  return {
    numero: f.numero,
    emise_le: longDate(f.created_at.slice(0, 10)),
    client_nom: f.client_nom,
    client_email: f.client_email,
    montant: euros(f.montant_cents),
    date_paiement: longDate(f.date_paiement),
    heure: f.heure,
    lieu: f.lieu,
    description: f.description,
  };
}
