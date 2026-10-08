/**
 * Base SQLite (un seul fichier : data/tradingbara-mail.db).
 *  users     comptes de l'équipe (créés en ligne de commande : npm run create-user)
 *  sessions  connexions ouvertes
 *  envois    historique des emails envoyés
 */
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

export const DB_FILE = path.join(config.dataDir, 'tradingbara-mail.db');

export const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nom            TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    totp_secret    TEXT,
    totp_last_step INTEGER,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    last_login_at  TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    sess    TEXT NOT NULL,
    expires INTEGER NOT NULL,
    user_id INTEGER
  );
  CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires);
  CREATE TABLE IF NOT EXISTS envois (
    id           INTEGER PRIMARY KEY,
    created_at   TEXT NOT NULL,
    user_id      INTEGER,
    user_nom     TEXT NOT NULL,
    destinataire TEXT NOT NULL,
    modele       TEXT NOT NULL,
    objet        TEXT NOT NULL,
    statut       TEXT NOT NULL,   -- envoye | test (mode test, rien n'est parti) | echec
    erreur       TEXT
  );
  CREATE INDEX IF NOT EXISTS envois_date ON envois (created_at);
  CREATE TABLE IF NOT EXISTS factures (
    id            TEXT PRIMARY KEY,   -- identifiant du lien (non devinable), ex. /facture/<id>
    numero        TEXT NOT NULL,      -- numéro affiché, ex. TB-2026-0001
    created_at    TEXT NOT NULL,
    user_id       INTEGER,
    user_nom      TEXT,
    client_nom    TEXT NOT NULL,
    client_email  TEXT NOT NULL,
    montant_cents INTEGER NOT NULL,
    date_paiement TEXT,               -- ISO (AAAA-MM-JJ)
    heure         TEXT,               -- HH:MM
    lieu          TEXT,
    description   TEXT
  );
  CREATE INDEX IF NOT EXISTS factures_date ON factures (created_at);
  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Colonnes ajoutées après coup (bases déjà créées) : modèle utilisé + copie des balises du mail
for (const col of ['modele TEXT', 'vars TEXT']) {
  try { db.exec(`ALTER TABLE factures ADD COLUMN ${col}`); } catch { /* colonne déjà présente */ }
}

/** Réglage simple clé→valeur (ex. modèle de facture par défaut). */
export const getSetting = (key) => db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
export const setSetting = (key, value) => db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);

/** Date courante au format ISO (stockage des dates en texte). */
export const now = () => new Date().toISOString();
