/**
 * Double authentification par code à 6 chiffres (TOTP, RFC 6238),
 * compatible Google Authenticator, Authy, Microsoft Authenticator, 1Password…
 */
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30; // secondes

export function generateSecret(bytes = 20) {
  const buf = crypto.randomBytes(bytes);
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s) {
  const clean = s.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = '';
  for (const c of clean) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new Error('Secret invalide');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

/**
 * Vérifie un code (tolérance ±1 période pour le décalage d'horloge).
 * Renvoie la période utilisée (pour interdire sa réutilisation) ou null.
 */
export function verifyCode(secret, code, lastStep = null, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ''))) return null;
  const current = Math.floor(now / 1000 / STEP);
  for (const s of [current, current - 1, current + 1]) {
    if (lastStep != null && s <= lastStep) continue; // code déjà utilisé
    const expected = codeAt(secret, s);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(code)))) return s;
  }
  return null;
}

export function otpauthUrl(secret, account, issuer = 'Trading Bara Mail') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
}
