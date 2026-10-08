/**
 * Modèles d'emails : un fichier .html par modèle, au design entièrement libre.
 *  - rangés dans data/modeles/ (sur le serveur : /opt/tradingbara-mail/data/modeles/), importés depuis
 *    l'interface (onglet Modèles) ou déposés directement dans ce dossier ;
 *  - 3 modèles Trading Bara sont installés au premier démarrage (dossier modeles-defaut/) ;
 *  - objet de l'email = balise <title> ; nom dans la liste = <meta name="modele" content="…">
 *    (sinon le nom du fichier) ; description = <meta name="description" content="…"> ;
 *  - balises à remplir à l'envoi : {{prenom}}, {{date_fin}}, {{lien_paiement}}… (lettres, chiffres, _) :
 *      · balise placée dans un lien (href="{{…}}") → adresse https:// obligatoire ;
 *      · balise nommée message… ou texte… → texte sur plusieurs lignes (retours à la ligne conservés) ;
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

const TAG_RE = /\{\{\s*([\p{L}\p{N}_]{1,30})\s*\}\}/gu;
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

/** Balises d'un texte, dans l'ordre d'apparition, sans doublon (en minuscules). */
function tagsOf(...texts) {
  const out = new Set();
  for (const t of texts) for (const [, n] of String(t || '').matchAll(TAG_RE)) out.add(n.toLowerCase());
  return [...out];
}

/** Balises utilisées dans un lien (href="…{{lien}}…") : une adresse https:// est exigée. */
function linkTagsOf(code) {
  const out = new Set();
  for (const [, , v] of code.matchAll(/\bhref\s*=\s*(["'])([^"']*)\1/gi)) for (const [, n] of v.matchAll(TAG_RE)) out.add(n.toLowerCase());
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
  const balises = tagsOf(objet, code.replace(/<title[^>]*>[\s\S]*?<\/title>/i, '')).map((nom) => ({
    nom, type: liens.has(nom) ? 'lien' : isMultiline(nom) ? 'texte' : 'ligne',
  }));
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

/** Vérifie une valeur de balise selon son type (renvoie le message d'erreur ou null). */
export function valueProblem(balise, value) {
  if (!value) return `Remplissez « {{${balise.nom}}} ».`;
  if (balise.type === 'lien' && !/^(https:\/\/|mailto:)\S+$/i.test(value)) return `« {{${balise.nom}}} » doit être une adresse qui commence par https://`;
  return null;
}

/**
 * Remplit les balises : valeurs protégées dans le HTML (aucun code ne peut être injecté par une valeur),
 * objet en texte brut. Une balise sans valeur reste affichée telle quelle ({{prenom}}) : utile pour l'aperçu.
 * Renvoie aussi une version texte (pour les messageries qui n'affichent pas le HTML).
 * subjectOverride : objet personnalisé (saisi dans l'interface), avec balises {{…}} acceptées ;
 * s'il est vide, c'est la balise <title> du modèle qui sert d'objet.
 */
export function fillModele(t, values, subjectOverride) {
  const get = (n) => values[n.toLowerCase()];
  const html = t.html.replace(COMMENT_RE, '').replace(TAG_RE, (all, n) => {
    const v = get(n);
    if (v === undefined || v === '') return all;
    return isMultiline(n.toLowerCase()) ? escHtml(v).replace(/\r?\n/g, '<br>') : escHtml(v);
  });
  const subjectSrc = (typeof subjectOverride === 'string' && subjectOverride.trim()) ? subjectOverride : t.objet;
  const subject = subjectSrc.replace(TAG_RE, (all, n) => (get(n) ? get(n).replace(/\s+/g, ' ') : all)).trim();
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
