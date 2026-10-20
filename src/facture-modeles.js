/**
 * Modèles de factures : designs .html (avec balises {{…}}) que le gérant uploade et gère.
 *  - rangés dans data/factures-modeles/ ; un modèle « par défaut » (★) est choisi par le gérant ;
 *  - 1 modèle Trading Bara est installé au premier démarrage (facture-modeles-defaut/) ;
 *  - à l'affichage de /facture/<id>, le serveur remplit les balises du modèle avec les infos de la facture
 *    (montant, date, client…) + les balises du mail saisies à l'envoi. Le gérant ne re-remplit rien.
 * Balises disponibles : voir FACTURE_BALISES.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { getSetting, setSetting } from './db.js';

export const FMODELES_DIR = path.join(config.dataDir, 'factures-modeles');
const DEFAULTS_DIR = path.join(ROOT, 'facture-modeles-defaut');
export const FEXAMPLE_FILE = path.join(ROOT, 'src', 'facture-modele-exemple.html');
export const FMAX_SIZE = 600 * 1024;
export const FMAX = 50;
const ACTIVE_KEY = 'facture_modele_actif';

/**
 * Balises reconnues dans un modèle de facture. source :
 *   auto  = rempli tout seul (tu ne touches à rien)
 *   saisi = ce que tu tapes dans l'encadré Facture au moment de l'envoi
 *   mail  = balise du mail déjà remplie (reprise telle quelle)
 */
export const FACTURE_BALISES = [
  { nom: 'numero_facture', source: 'auto', desc: 'Numéro généré automatiquement (ex. TB-2026-0001)' },
  { nom: 'emise_le', source: 'auto', desc: 'Date d\'émission = le jour de l\'envoi (automatique)' },
  { nom: 'client_email', source: 'auto', desc: 'Email du client = l\'adresse du destinataire' },
  { nom: 'montant', source: 'saisi', desc: 'Montant réglé, TTC (ex. 49,90 €)' },
  { nom: 'montant_ht', source: 'auto', desc: 'Montant HT = montant ÷ 1,2 (auto, si assujetti TVA)' },
  { nom: 'montant_tva', source: 'auto', desc: 'Montant de la TVA 20 % (auto, si assujetti TVA)' },
  { nom: 'taux_tva', source: 'auto', desc: 'Taux de TVA (20 %)' },
  { nom: 'date_paiement', source: 'saisi', desc: 'Date du paiement (pré-remplie à aujourd\'hui)' },
  { nom: 'heure', source: 'saisi', desc: 'Heure du paiement (facultative)' },
  { nom: 'lieu', source: 'saisi', desc: 'Lieu (ex. En ligne, facultatif)' },
  { nom: 'client_nom', source: 'saisi', desc: 'Nom du client affiché sur la facture' },
  { nom: 'description', source: 'saisi', desc: 'Ce qui est facturé' },
  { nom: 'prenom', source: 'mail', desc: 'Prénom (et toute autre balise du mail que tu as remplie)' },
];

// {{nom}} ou {{type:nom}} (même syntaxe que les modèles de mail ; le préfixe est ignoré ici : les valeurs sont déjà mises en forme)
const TAG_RE = /\{\{\s*(?:\p{L}[\p{L}\p{N}]{0,14}\s*:\s*)?([\p{L}\p{N}_]{1,40})\s*\}\}/gu;
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (e) => ENT[e]);

export function slugify(name) {
  return String(name).replace(/\.html?$/i, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
export const validSlug = (s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length <= 60;
const fileOf = (slug) => path.join(FMODELES_DIR, `${slug}.html`);

function tagsOf(html) {
  const out = new Set();
  for (const [, n] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(TAG_RE)) out.add(n.toLowerCase());
  return [...out];
}

function describe(slug, html, stat) {
  const code = html.replace(/<!--[\s\S]*?-->/g, '');
  const meta = (name) => decode(code.match(new RegExp(`<meta\\s+name=["']${name}["']\\s+content=(["'])([\\s\\S]*?)\\1`, 'i'))?.[2] || '').trim();
  return {
    slug,
    nom: meta('modele') || slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    description: meta('description'),
    balises: tagsOf(code),
    taille: stat?.size ?? Buffer.byteLength(html),
    modifie: stat?.mtime?.toISOString() ?? null,
  };
}

/** Premier démarrage : installe le(s) modèle(s) de facture Trading Bara et fixe le modèle par défaut. */
export function installFactureDefaults() {
  const fresh = !fs.existsSync(FMODELES_DIR);
  fs.mkdirSync(FMODELES_DIR, { recursive: true });
  if (fresh && fs.existsSync(DEFAULTS_DIR)) {
    for (const f of fs.readdirSync(DEFAULTS_DIR).filter((f) => /\.html$/i.test(f))) {
      fs.copyFileSync(path.join(DEFAULTS_DIR, f), path.join(FMODELES_DIR, f));
    }
  }
  // S'assurer qu'un modèle par défaut valide existe
  const list = listFactureModeles();
  if (list.length && !list.some((t) => t.slug === getActiveSlug())) setActiveSlug(list[0].slug);
  return list.length;
}

export function listFactureModeles() {
  if (!fs.existsSync(FMODELES_DIR)) return [];
  const active = getActiveSlug();
  return fs.readdirSync(FMODELES_DIR).filter((f) => /\.html$/i.test(f)).map((f) => {
    const slug = f.replace(/\.html$/i, '');
    if (!validSlug(slug)) return null;
    const file = path.join(FMODELES_DIR, f);
    return { ...describe(slug, fs.readFileSync(file, 'utf8'), fs.statSync(file)), actif: slug === active };
  }).filter(Boolean).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

export function readFactureModele(slug) {
  if (!validSlug(slug) || !fs.existsSync(fileOf(slug))) return null;
  const html = fs.readFileSync(fileOf(slug), 'utf8');
  return { ...describe(slug, html, fs.statSync(fileOf(slug))), html, actif: slug === getActiveSlug() };
}

export function saveFactureModele(name, html) {
  const slug = slugify(name);
  if (!slug) throw new Error('Nom de fichier invalide.');
  fs.mkdirSync(FMODELES_DIR, { recursive: true });
  const existed = fs.existsSync(fileOf(slug));
  fs.writeFileSync(fileOf(slug), html, 'utf8');
  if (!getActiveSlug()) setActiveSlug(slug); // premier modèle → devient le défaut
  return { ...describe(slug, html, fs.statSync(fileOf(slug))), replaced: existed, actif: slug === getActiveSlug() };
}

export function deleteFactureModele(slug) {
  if (!validSlug(slug) || !fs.existsSync(fileOf(slug))) return false;
  fs.unlinkSync(fileOf(slug));
  if (getActiveSlug() === slug) { // le défaut a été supprimé → on en reprend un autre
    const list = listFactureModeles();
    setActiveSlug(list[0]?.slug || '');
  }
  return true;
}

export const getActiveSlug = () => getSetting(ACTIVE_KEY) || '';
export function setActiveSlug(slug) {
  if (slug && !validSlug(slug)) throw new Error('Modèle invalide.');
  if (slug && !fs.existsSync(fileOf(slug))) throw new Error('Ce modèle n\'existe pas.');
  setSetting(ACTIVE_KEY, slug || '');
  return slug;
}

/**
 * Remplit un modèle de facture : valeurs échappées (aucun code injecté), balises vides → vide.
 * example : true garde le bloc <!--SAMPLE-->…<!--/SAMPLE--> (aperçu) ; false le retire (vraie facture).
 */
export function fillFactureTemplate(html, values, { example = false } = {}) {
  const get = (n) => values[n.toLowerCase()];
  html = example ? html.replace(/<!--\/?SAMPLE-->/g, '') : html.replace(/<!--SAMPLE-->[\s\S]*?<!--\/SAMPLE-->/g, '');
  return html.replace(/<!--(?!\[if)[\s\S]*?-->/g, '').replace(TAG_RE, (all, n) => {
    const v = get(n);
    return v === undefined || v === null || v === '' ? '' : escHtml(v);
  });
}

/**
 * HTML final d'une facture : modèle choisi (slug) rempli avec values. Repli sur le modèle par défaut,
 * puis sur le 1er disponible. Renvoie null si aucun modèle n'existe.
 */
export function renderFacture(slug, values, opts = {}) {
  const first = listFactureModeles()[0];
  const t = (slug && readFactureModele(slug)) || (getActiveSlug() && readFactureModele(getActiveSlug())) || (first && readFactureModele(first.slug));
  if (!t) return null;
  return fillFactureTemplate(t.html, values, opts);
}
