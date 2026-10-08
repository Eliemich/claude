/**
 * Onglet « Modèles » : bibliothèque des fichiers .html (vignette qui défile au survol), import par
 * glisser-déposer ou bouton, aperçu agrandi, téléchargement, suppression.
 */
import { A } from '../api.js';
import { $, $$, esc, toast, modal, confirmBox, ICON, kb } from '../ui.js';
import { gsap, reduced, tilt } from '../fx/motion.js';
import { withBase } from './compose.js';

const MAX = 500 * 1024;
/** Même règle que le serveur : « Confirmation de commande.html » → « confirmation-de-commande ». */
const slugify = (name) => name.replace(/\.html?$/i, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function download(name, text) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/html' })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function createModels(root, { onUse, onChange }) {
  const lib = $('[data-lib]', root);
  const drop = $('[data-drop]', root);
  const fileInput = $('[data-file]', root);
  let list = [];
  const cache = new Map(); // slug → { modifie, apercu, html }

  async function full(t) {
    const hit = cache.get(t.slug);
    if (hit && hit.modifie === t.modifie) return hit;
    const f = await A.modele(t.slug);
    cache.set(t.slug, f);
    return f;
  }

  /* ---------- Vignettes chargées quand elles deviennent visibles ---------- */
  const io = new IntersectionObserver((entries) => entries.forEach(async (e) => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    const t = list.find((x) => x.slug === e.target.dataset.thumb);
    if (!t) return;
    try {
      const f = await full(t);
      const frame = $('iframe', e.target);
      frame.srcdoc = withBase(f.apercu);
      frame.onload = () => gsap.to(frame, { opacity: 1, duration: 0.6 });
    } catch { /* vignette indisponible */ }
  }), { rootMargin: '200px' });

  function render() {
    if (!list.length) {
      lib.innerHTML = '<div class="panel glass empty" style="grid-column:1/-1"><img src="/img/logo.webp" alt=""><strong>Aucun modèle pour l\'instant</strong>Importe ton premier fichier .html, ou pars de l\'exemple commenté.</div>';
      return;
    }
    lib.innerHTML = list.map((t) => `
      <article class="card glass spot" data-card="${esc(t.slug)}">
        <div class="card__thumb" data-thumb="${esc(t.slug)}"><div class="card__page"><iframe title="Vignette ${esc(t.nom)}" sandbox="allow-same-origin" tabindex="-1" loading="lazy" style="opacity:0"></iframe></div></div>
        <div class="card__body">
          <h3 class="card__name">${esc(t.nom)}</h3>
          ${t.description ? `<p class="card__desc">${esc(t.description)}</p>` : ''}
          <p class="card__subject">${t.objet ? esc(t.objet) : '<span class="chip chip--warn">sans objet : ajoute une balise &lt;title&gt;</span>'}</p>
          <div class="card__tags">${t.balises.map((b) => `<span class="tag" title="${b.type === 'lien' ? 'Lien (https://)' : b.type === 'texte' ? 'Texte sur plusieurs lignes' : 'Texte'}">{{${esc(b.nom)}}}</span>`).join('') || '<span class="card__meta">aucune balise</span>'}</div>
          <p class="card__meta">${esc(t.slug)}.html · ${kb(t.taille)}</p>
          <div class="card__actions">
            <button class="btn btn--primary btn--sm" type="button" data-use>${ICON.send}<span>Utiliser</span></button>
            <button class="btn btn--ghost btn--sm btn--icon" type="button" data-show title="Aperçu agrandi" aria-label="Aperçu agrandi">${ICON.expand}</button>
            <button class="btn btn--ghost btn--sm btn--icon" type="button" data-dl title="Télécharger le fichier" aria-label="Télécharger">${ICON.download}</button>
            <button class="btn btn--danger btn--sm btn--icon" type="button" data-del title="Supprimer" aria-label="Supprimer">${ICON.trash}</button>
          </div>
        </div>
      </article>`).join('');

    $$('[data-card]', lib).forEach((card) => {
      const t = list.find((x) => x.slug === card.dataset.card);
      io.observe($('[data-thumb]', card));
      tilt(card, { max: 2.5 });
      // Au survol, la vignette défile pour montrer tout l'email
      const page = $('.card__page', card);
      card.addEventListener('pointerenter', () => !reduced && gsap.to(page, { y: () => -Math.max(0, 1200 * 0.52 - 250), duration: 5, ease: 'power1.inOut' }));
      card.addEventListener('pointerleave', () => gsap.to(page, { y: 0, duration: 1.2, ease: 'power3.out' }));
      $('[data-use]', card).addEventListener('click', () => onUse(t.slug));
      $('[data-show]', card).addEventListener('click', async () => {
        const f = await full(t);
        const m = modal({
          title: t.nom, width: 980,
          body: '<div class="big-preview"><iframe title="Aperçu du modèle" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe></div>',
          actions: [{ label: 'Fermer', onClick: (close) => close() }, { label: 'Utiliser ce modèle', cls: 'btn--primary', onClick: (close) => { close(); onUse(t.slug); } }],
        });
        $('iframe', m.body).srcdoc = withBase(f.apercu);
      });
      $('[data-dl]', card).addEventListener('click', async () => download(`${t.slug}.html`, (await full(t)).html));
      $('[data-del]', card).addEventListener('click', async () => {
        if (!(await confirmBox(`Supprimer le modèle « ${t.nom} » (${t.slug}.html) ? Pense à garder une copie du fichier (bouton Télécharger).`, { ok: 'Supprimer', danger: true }))) return;
        try {
          await A.deleteModele(t.slug);
          cache.delete(t.slug);
          toast('Modèle supprimé.');
          if (!reduced) await gsap.to(card, { opacity: 0, scale: 0.92, rotationX: -12, duration: 0.45, ease: 'power2.in' });
          await load();
          onChange?.();
        } catch (e) { toast(e.message, 'err'); }
      });
    });
    if (!reduced) gsap.from($$('.card', lib), { opacity: 0, y: 40, rotationX: 10, transformPerspective: 1000, duration: 1, stagger: 0.07, ease: 'expo.out', clearProps: 'opacity,transform' });
  }

  async function load() {
    list = await A.modeles();
    render();
    return list;
  }

  /* ---------- Import ---------- */
  async function importFile(file) {
    if (!file) return;
    try {
      if (!/\.html?$/i.test(file.name)) throw new Error('Choisis un fichier .html');
      if (file.size > MAX) throw new Error(`Fichier trop lourd (${kb(file.size)}, 500 Ko maximum) : mets les images en ligne et utilise leur adresse https://…`);
      const slug = slugify(file.name);
      if (list.some((t) => t.slug === slug)
        && !(await confirmBox(`Un modèle « ${slug}.html » existe déjà. Le remplacer par ce fichier ?`, { ok: 'Remplacer' }))) return;
      const t = await A.importModele(file.name, await file.text());
      cache.delete(t.slug);
      toast(t.objet ? `Modèle « ${t.nom} » importé : ${t.balises.length} balise${t.balises.length > 1 ? 's' : ''} détectée${t.balises.length > 1 ? 's' : ''}.`
        : `Modèle « ${t.nom} » importé, mais sans objet : ajoute une balise <title> dans le fichier.`, t.objet ? 'ok' : 'err');
      await load();
      onChange?.(t.slug);
      const card = $(`[data-card="${CSS.escape(t.slug)}"]`, lib);
      card?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      if (card && !reduced) gsap.fromTo(card, { boxShadow: '0 0 0 2px rgba(157,210,255,.9), 0 0 60px rgba(47,123,255,.8)' }, { boxShadow: '0 0 0 0px rgba(157,210,255,0), 0 0 0px rgba(47,123,255,0)', duration: 2, delay: 0.4, clearProps: 'boxShadow' });
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  $('[data-import]', root).addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { importFile(fileInput.files[0]); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => importFile(e.dataTransfer.files[0]));
  // Un fichier lâché ailleurs sur la page ne doit pas l'ouvrir dans l'onglet
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => e.preventDefault());

  return { load };
}
