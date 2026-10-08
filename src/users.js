/** Comptes de l'équipe : mots de passe hachés (argon2id), jamais renvoyés au navigateur. */
import argon2 from 'argon2';
import { db } from './db.js';

// Paramètres argon2id (recommandations OWASP)
const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (pw) => argon2.hash(pw, ARGON);
export const verifyPassword = (hash, pw) => argon2.verify(hash, pw).catch(() => false);

// Empreinte factice : même durée de calcul que le compte existe ou non (évite de deviner les comptes)
let dummyHash = null;
export async function fakeVerify(pw) {
  dummyHash ??= await hashPassword('mot-de-passe-factice-123');
  await verifyPassword(dummyHash, pw);
  return false;
}

export const findByEmail = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email);
export const findById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
export const publicUser = (u) => (u ? { id: u.id, email: u.email, nom: u.nom } : null);

/** Règle des mots de passe (création et changement en ligne de commande). */
export function passwordProblem(pw) {
  if (pw.length < 10) return '10 caractères minimum.';
  if (!/[A-ZÀ-Ý]/.test(pw) || !/[a-zà-ÿ]/.test(pw) || !/\d/.test(pw)) return 'Il faut au moins une majuscule, une minuscule et un chiffre.';
  return null;
}
