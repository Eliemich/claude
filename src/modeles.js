/**
 * Modèles d'emails : un fichier .html par modèle, au design entièrement libre.
 *  - rangés dans data/modeles/ (sur le serveur : /opt/tradingbara-mail/data/modeles/), importés depuis
 *    l'interface (onglet Modèles) ou déposés directement dans ce dossier ;
 *  - 3 modèles Trading Bara sont installés au premier démarrage (dossier modeles-defaut/) ;
 *  - objet de l'email = balise <title> ; nom dans la liste = <meta name="modele" content="…">
 *    (sinon le nom du fichier) ; description = <meta name="description" content="…"> ;
 *  - balises à remplir à l'envoi : {{prenom}}, {{date_fin}}, {{lien_paiement}}… (lettres, chiffres, _) :
 *      · préfixe de type facultatif {{type:nom}} (espaces tolérés : {{ date : date_recup }}) :
 *          {{date:…}} → date (case calendrier, écrite « 20 octobre 2026 » dans l'email),
 *          {{time:…}} → heure entre 08:00 et 20:00, {{adresse:…}} → adresse avec suggestions,
 *          {{code6:…}} → exactement 6 chiffres ({{code5:…}} → 5 chiffres… de 1 à 20),
 *          {{civilite:…}} (ou {{civ:…}}) → choix Homme / Femme, écrit « M. » ou « Mme »,
 *          {{civilitelong:…}} (ou {{civlong:…}}) → même choix, écrit « Monsieur » ou « Madame » ;
 *        le nom de la balise reste « nom » : {{date:date_recup}} et {{date_recup}} désignent la même valeur ;
 *      · balise placée dans un lien (href="{{…}}") → adresse https:// obligatoire ;
 *      · balise nommée message… ou texte… → texte sur plusieurs lignes (retours à la ligne conservés) ;
 *      · sinon (dont les anciennes balises sans préfixe) → texte sur une ligne ;
 *  - images : adresse https://… ou cid:logo (logo Trading Bara joint à l'email, voir email-assets/).
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';

export const MODELES_DIR = path.join(config.dataDir, 'modeles');
const DEFAULTS_DIR = path.join(ROOT, 'modeles-defaut');
export const ASSETS_DIR = path.join(ROOT, 'email-assets');
export const EXAMPLE_FILE = path.join(ROOT, 'src', 'modele-exemple.html');
export const MAX_SIZE = 500 * 1024; // 500 Ko par fichier
export const MAX_MODELES = 100;

// {{nom}} ou {{type:nom}} — espaces tolérés partout : {{ date : date_recup }}. Groupes : 1 = type (facultatif), 2 = nom.
const TAG_RE = /\{\{\s*(?:(\p{L}[\p{L}\p{N}]{0,14})\s*:\s*)?([\p{L}\p{N}_]{1,30})\s*\}\}/gu;
// Préfixes reconnus → type de champ. Un préfixe inconnu ({{abc:nom}}) donne un simple texte.
const PREFIX_TYPES = {
  date: 'date', time: 'time', heure: 'time', adresse: 'adresse',
  civilite: 'civilite', civ: 'civilite', civilitelong: 'civilite', civlong: 'civilite',
};
// {{civilite:…}} : valeurs possibles (choisies à l'envoi). valeur = forme courte insérée dans l'email,
// long = forme écrite par {{civilitelong:…}}. Un seul choix sert aux deux formes (même nom de balise).
export const CIVILITES = [{ valeur: 'M.', long: 'Monsieur', label: 'Homme' }, { valeur: 'Mme', long: 'Madame', label: 'Femme' }];
const LONG_PREFIXES = new Set(['civilitelong', 'civlong']);
/** {{civilitelong:…}} : « M. » → « Monsieur », « Mme » → « Madame » ; toute autre balise inchangée. */
const formFor = (prefix, v) => (LONG_PREFIXES.has(prefix?.toLowerCase()) ? CIVILITES.find((c) => c.valeur === v)?.long ?? v : v);
export const CODE_MAX = 20; // {{code1:…}} à {{code20:…}}

/** Préfixe → { type, longueur? } ou null. {{code6:…}} → code de 6 chiffres exactement. */
function prefixInfo(prefix) {
  const p = prefix?.toLowerCase();
  if (PREFIX_TYPES[p]) return { type: PREFIX_TYPES[p] };
  const n = Number(p?.match(/^code(\d{1,2})$/)?.[1]);
  return n >= 1 && n <= CODE_MAX ? { type: 'code', longueur: n } : null;
}
// Plage autorisée pour les champs heure (envoyée à l'interface avec chaque balise « time »).
export const TIME_MIN = '08:00';
export const TIME_MAX = '20:00';
// Commentaires HTML retirés (explications du modèle), sauf les commentaires conditionnels d'Outlook
const COMMENT_RE = /<!--(?!\[if)[\s\S]*?-->/g;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (e) => ENTITIES[e]);
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** « Confirmation de commande.html » → « confirmation-de-commande » (nom de fichier sûr). */
export function slugify(name) {
  return String(name).replace(/\.html?$/i, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
export const validSlug = (s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length <= 60;
const fileOf = (slug) => path.join(MODELES_DIR, `${slug}.html`);

/**
 * Balises d'un texte, dans l'ordre d'apparition, sans doublon (en minuscules) : Map nom → type du préfixe (ou null).
 * Si la même balise apparaît avec et sans préfixe ({{date:date_recup}} puis {{date_recup}}), le préfixe l'emporte.
 */
function tagsOf(...texts) {
  const out = new Map();
  for (const t of texts) {
    for (const [, prefix, n] of String(t || '').matchAll(TAG_RE)) {
      const nom = n.toLowerCase();
      const type = prefixInfo(prefix);
      if (!out.has(nom) || (type && !out.get(nom))) out.set(nom, type);
    }
  }
  return out;
}

/** Balises utilisées dans un lien (href="…{{lien}}…") : une adresse https:// est exigée. */
function linkTagsOf(code) {
  const out = new Set();
  for (const [, , v] of code.matchAll(/\bhref\s*=\s*(["'])([^"']*)\1/gi)) for (const [, , n] of v.matchAll(TAG_RE)) out.add(n.toLowerCase());
  return [...out];
}
const isMultiline = (tag) => /^(message|texte)/.test(tag);

/** Informations d'un modèle : nom, description, objet, balises (et leur type). */
function describe(slug, html, stat) {
  const code = html.replace(COMMENT_RE, '');
  // content="Test d'envoi" : la valeur s'arrête au même guillemet que celui qui l'ouvre
  const meta = (name) => decode(code.match(new RegExp(`<meta\\s+name=["']${name}["']\\s+content=(["'])([\\s\\S]*?)\\1`, 'i'))?.[2] || '').trim();
  const objet = decode((code.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim());
  const liens = new Set(linkTagsOf(code));
  // Type du champ : préfixe {{type:…}} d'abord, sinon déduit comme avant (lien, texte multiligne, ligne).
  const balises = [...tagsOf(objet, code.replace(/<title[^>]*>[\s\S]*?<\/title>/i, ''))].map(([nom, info]) => {
    const type = info?.type || (liens.has(nom) ? 'lien' : isMultiline(nom) ? 'texte' : 'ligne');
    if (type === 'time') return { nom, type, min: TIME_MIN, max: TIME_MAX };
    if (type === 'code') return { nom, type, longueur: info.longueur };
    if (type === 'civilite') return { nom, type, choix: CIVILITES };
    return { nom, type };
  });
  // Modèle « de type facture » : il contient la balise {{lien_facture}} → une facture est créée à l'envoi,
  // et les balises gérées par l'encadré Facture ne sont pas demandées comme simples cases de texte.
  const facture = balises.some((b) => b.nom === 'lien_facture');
  return {
    slug,
    nom: meta('modele') || slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    description: meta('description'),
    objet,
    balises,
    facture,
    taille: stat?.size ?? Buffer.byteLength(html),
    modifie: stat?.mtime?.toISOString() ?? null,
  };
}

/** Premier démarrage : installe les modèles Trading Bara (une seule fois, ensuite le dossier vous appartient). */
export function installDefaults() {
  if (fs.existsSync(MODELES_DIR)) return 0;
  fs.mkdirSync(MODELES_DIR, { recursive: true });
  const files = fs.readdirSync(DEFAULTS_DIR).filter((f) => /\.html$/i.test(f));
  for (const f of files) fs.copyFileSync(path.join(DEFAULTS_DIR, f), path.join(MODELES_DIR, f));
  return files.length;
}

/** Tous les modèles du dossier (triés par nom). */
export function listModeles() {
  if (!fs.existsSync(MODELES_DIR)) return [];
  return fs.readdirSync(MODELES_DIR).filter((f) => /\.html$/i.test(f)).map((f) => {
    const slug = f.replace(/\.html$/i, '');
    if (!validSlug(slug)) return null; // fichier déposé à la main avec un nom non valide : ignoré
    const file = path.join(MODELES_DIR, f);
    return describe(slug, fs.readFileSync(file, 'utf8'), fs.statSync(file));
  }).filter(Boolean).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/** Un modèle avec son contenu HTML (null s'il n'existe pas). */
export function readModele(slug) {
  if (!validSlug(slug) || !fs.existsSync(fileOf(slug))) return null;
  const html = fs.readFileSync(fileOf(slug), 'utf8');
  return { ...describe(slug, html, fs.statSync(fileOf(slug))), html };
}

/** Enregistre (ou remplace) un modèle importé. */
export function saveModele(name, html) {
  const slug = slugify(name);
  if (!slug) throw new Error('Nom de fichier invalide.');
  fs.mkdirSync(MODELES_DIR, { recursive: true });
  const existed = fs.existsSync(fileOf(slug));
  fs.writeFileSync(fileOf(slug), html, 'utf8');
  return { ...describe(slug, html, fs.statSync(fileOf(slug))), replaced: existed };
}

export function deleteModele(slug) {
  if (!validSlug(slug) || !fs.existsSync(fileOf(slug))) return false;
  fs.unlinkSync(fileOf(slug));
  return true;
}

/* ---------- Remplissage ---------- */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const isRealDate = (v) => ISO_DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v); // refuse 2026-02-31

/** Vérifie une valeur de balise selon son type (renvoie le message d'erreur ou null). */
export function valueProblem(balise, value) {
  if (!value) return `Remplissez « {{${balise.nom}}} ».`;
  if (balise.type === 'lien' && !/^(https:\/\/|mailto:)\S+$/i.test(value)) return `« {{${balise.nom}}} » doit être une adresse qui commence par https://`;
  if (balise.type === 'date' && !isRealDate(value)) return `« {{${balise.nom}}} » : date invalide.`;
  if (balise.type === 'civilite' && !CIVILITES.some((c) => c.valeur === value)) return `« {{${balise.nom}}} » : choisissez ${CIVILITES.map((c) => c.valeur).join(' ou ')}.`;
  if (balise.type === 'code' && !new RegExp(`^\\d{${balise.longueur}}$`).test(value)) return `« {{${balise.nom}}} » doit contenir exactement ${balise.longueur} chiffres.`;
  if (balise.type === 'time') {
    if (!TIME_RE.test(value)) return `« {{${balise.nom}}} » : heure invalide (format HH:MM).`;
    // HH:MM sur 2 chiffres : la comparaison de textes suffit
    if (value < TIME_MIN || value > TIME_MAX) return `« {{${balise.nom}}} » doit être entre ${TIME_MIN} et ${TIME_MAX}.`;
  }
  return null;
}

/**
 * Vérifications entre plusieurs balises : une heure de début doit précéder l'heure de fin.
 * Paires reconnues : heure_debut / heure_fin, et plus largement …debut… / …fin… (heure_debut_recup / heure_fin_recup).
 * Renvoie [{ nom, message }] (nom = balise à signaler, celle de fin).
 */
export function crossProblems(balises, values) {
  const out = [];
  const times = new Set(balises.filter((b) => b.type === 'time').map((b) => b.nom));
  for (const debut of times) {
    if (!debut.includes('debut')) continue;
    const fin = debut.replace('debut', 'fin');
    const a = values[debut];
    const b = values[fin];
    if (times.has(fin) && TIME_RE.test(a || '') && TIME_RE.test(b || '') && a >= b) {
      out.push({ nom: fin, message: `« {{${fin}}} » (${b}) doit être après « {{${debut}}} » (${a}).` });
    }
  }
  return out;
}

/** Valeur telle qu'elle apparaît dans l'email : 2026-10-20 → « 20 octobre 2026 » ; le reste tel quel. */
function displayValue(type, v) {
  if (type === 'date' && isRealDate(v)) {
    return new Date(`${v}T00:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return v;
}

/** Toutes les valeurs mises en forme pour l'email (utile aussi pour les balises du modèle de facture). */
export function displayValues(t, values) {
  const typeOf = new Map(t.balises.map((b) => [b.nom, b.type]));
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, displayValue(typeOf.get(k), v)]));
}

/**
 * Remplit les balises : valeurs protégées dans le HTML (aucun code ne peut être injecté par une valeur),
 * objet en texte brut. Une balise sans valeur reste affichée telle quelle ({{prenom}}) : utile pour l'aperçu.
 * Renvoie aussi une version texte (pour les messageries qui n'affichent pas le HTML).
 * subjectOverride : objet personnalisé (saisi dans l'interface), avec balises {{…}} acceptées ;
 * s'il est vide, c'est la balise <title> du modèle qui sert d'objet.
 * { strict: true } (envoi réel) : une balise restée sans valeur est retirée au lieu de rester visible,
 * pour qu'un « {{…}} » n'arrive jamais chez le client (l'envoi exige déjà toutes les balises du modèle :
 * ce filet ne sert que pour une balise tapée dans l'objet personnalisé qui n'existe pas dans le modèle).
 * Les dates {{date:…}} sont écrites en toutes lettres (« 20 octobre 2026 »).
 */
export function fillModele(t, values, subjectOverride, { strict = false } = {}) {
  const shown = displayValues(t, values);
  const get = (n) => shown[n.toLowerCase()];
  const html = t.html.replace(COMMENT_RE, '').replace(TAG_RE, (all, prefix, n) => {
    const v = formFor(prefix, get(n));
    if (v === undefined || v === '') return strict ? '' : all;
    return isMultiline(n.toLowerCase()) ? escHtml(v).replace(/\r?\n/g, '<br>') : escHtml(v);
  });
  const subjectSrc = (typeof subjectOverride === 'string' && subjectOverride.trim()) ? subjectOverride : t.objet;
  const subject = subjectSrc.replace(TAG_RE, (all, prefix, n) => (get(n) ? formFor(prefix, get(n)).replace(/\s+/g, ' ') : (strict ? '' : all)))
    .replace(/\s+/g, ' ').trim();
  const text = decode(html.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<a\b[^>]*href=["'](https?:[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => `${label} (${href})`)
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h\d|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { subject, html, text };
}

/* ---------- Images jointes (cid:logo) ---------- */

const ASSET_RE = /\bsrc\s*=\s*(["'])cid:([a-z0-9-]{1,40})\1/gi;
const assetFile = (name) => ['png', 'jpg', 'gif'].map((ext) => path.join(ASSETS_DIR, `${name}.${ext}`)).find((f) => fs.existsSync(f));

/** Images cid:… du modèle → pièces jointes « en ligne » de l'email (affichées dans le message). */
export function inlineAttachments(html) {
  const names = new Set([...html.matchAll(ASSET_RE)].map((m) => m[2].toLowerCase()));
  return [...names].map((cid) => ({ cid, file: assetFile(cid) })).filter((a) => a.file)
    .map(({ cid, file }) => ({ cid, filename: path.basename(file), path: file, contentDisposition: 'inline' }));
}

/** Aperçu dans le navigateur : cid:logo → /email-assets/logo.png */
export function previewImages(html) {
  return html.replace(ASSET_RE, (all, q, name) => {
    const file = assetFile(name.toLowerCase());
    return file ? `src=${q}/email-assets/${path.basename(file)}${q}` : all;
  });
}

/** Version autonome (emails de test enregistrés sur le disque) : images intégrées au fichier. */
export function embedImages(html) {
  return html.replace(ASSET_RE, (all, q, name) => {
    const file = assetFile(name.toLowerCase());
    if (!file) return all;
    const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif' }[path.extname(file)];
    return `src=${q}data:${type};base64,${fs.readFileSync(file).toString('base64')}${q}`;
  });
}
