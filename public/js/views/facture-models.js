/**
 * Sous-onglet « Modèles → Factures » : designs .html de la page facture.
 * Upload (glisser-déposer / bouton), aperçu rempli avec des valeurs d'exemple, « par défaut » (★),
 * téléchargement, suppression. Les balises se remplissent toutes seules à l'affichage d'une vraie facture.
 */
import { A } from '../api.js';
import { $, $$, esc, toast, modal, confirmBox, ICON, kb } from '../ui.js';
import { gsap, reduced, tilt } from '../fx/motion.js';
import { withBase } from './compose.js';

const MAX = 600 * 1024;
const slugify = (name) => name.replace(/\.html?$/i, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function download(name, text) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/html' })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function createFactureModels(root) {
  const lib = $('[data-flib]', root);
  const drop = $('[data-fdrop]', root);
  const fileInput = $('[data-ffile]', root);
  const balisesRef = $('[data-balises-ref]', root);
  let list = [];
  let actif = '';
  const cache = new Map();

  async function full(t) {
    const hit = cache.get(t.slug);
    if (hit && hit.modifie === t.modifie) return hit;
    const f = await A.factureModele(t.slug);
    cache.set(t.slug, f);
    return f;
  }

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
      lib.innerHTML = '<div class="panel glass empty" style="grid-column:1/-1"><img src="/img/logo.webp" alt=""><strong>Aucun modèle de facture</strong>Importe ton premier design .html, ou pars de l\'exemple commenté.</div>';
      return;
    }
    lib.innerHTML = list.map((t) => `
      <article class="card glass spot" data-card="${esc(t.slug)}">
        <div class="card__thumb" data-thumb="${esc(t.slug)}">
          <div class="card__page"><iframe title="Vignette ${esc(t.nom)}" sandbox="allow-same-origin" tabindex="-1" loading="lazy" style="opacity:0"></iframe></div>
          ${t.actif ? `<span class="fcard__star" title="Modèle par défaut">${ICON.starFill}</span>` : ''}
        </div>
        <div class="card__body">
          <h3 class="card__name">${esc(t.nom)}${t.actif ? ' <span class="chip chip--ok">★ par défaut</span>' : ''}</h3>
          ${t.description ? `<p class="card__desc">${esc(t.description)}</p>` : ''}
          <div class="card__tags">${t.balises.map((b) => `<span class="tag">{{${esc(b)}}}</span>`).join('') || '<span class="card__meta">aucune balise</span>'}</div>
          <p class="card__meta">${esc(t.slug)}.html · ${kb(t.taille)}</p>
          <div class="card__actions">
            ${t.actif
              ? '<button class="btn btn--ghost btn--sm" type="button" disabled>★ Modèle par défaut</button>'
              : `<button class="btn btn--primary btn--sm" type="button" data-default>${ICON.star}<span>Par défaut</span></button>`}
            <button class="btn btn--ghost btn--sm btn--icon" type="button" data-show title="Aperçu" aria-label="Aperçu">${ICON.expand}</button>
            <button class="btn btn--ghost btn--sm btn--icon" type="button" data-dl title="Télécharger" aria-label="Télécharger">${ICON.download}</button>
            <button class="btn btn--danger btn--sm btn--icon" type="button" data-del title="Supprimer" aria-label="Supprimer">${ICON.trash}</button>
          </div>
        </div>
      </article>`).join('');

    $$('[data-card]', lib).forEach((card) => {
      const t = list.find((x) => x.slug === card.dataset.card);
      io.observe($('[data-thumb]', card));
      tilt(card, { max: 2.5 });
      const page = $('.card__page', card);
      card.addEventListener('pointerenter', () => !reduced && gsap.to(page, { y: () => -Math.max(0, 1200 * 0.52 - 250), duration: 5, ease: 'power1.inOut' }));
      card.addEventListener('pointerleave', () => gsap.to(page, { y: 0, duration: 1.2, ease: 'power3.out' }));
      $('[data-default]', card)?.addEventListener('click', async () => {
        try { await A.setFactureActive(t.slug); toast(`« ${t.nom} » est maintenant le modèle de facture par défaut.`); await load(); }
        catch (e) { toast(e.message, 'err'); }
      });
      $('[data-show]', card).addEventListener('click', async () => {
        const f = await full(t);
        const m = modal({
          title: t.nom, width: 1040,
          body: '<div class="big-preview"><iframe title="Aperçu de la facture" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe></div>',
          actions: [{ label: 'Fermer', onClick: (close) => close() }, ...(t.actif ? [] : [{ label: 'Définir par défaut', cls: 'btn--primary', onClick: async (close) => { await A.setFactureActive(t.slug); close(); toast('Modèle par défaut mis à jour.'); load(); } }])],
        });
        $('iframe', m.body).srcdoc = withBase(f.apercu);
      });
      $('[data-dl]', card).addEventListener('click', async () => download(`${t.slug}.html`, (await full(t)).html));
      $('[data-del]', card).addEventListener('click', async () => {
        if (list.length <= 1) { toast('Garde au moins un modèle de facture.', 'err'); return; }
        if (!(await confirmBox(`Supprimer le modèle de facture « ${t.nom} » ? Pense à garder une copie du fichier.`, { ok: 'Supprimer', danger: true }))) return;
        try {
          await A.deleteFactureModele(t.slug);
          cache.delete(t.slug);
          toast('Modèle supprimé.');
          if (!reduced) await gsap.to(card, { opacity: 0, scale: 0.92, rotationX: -12, duration: 0.45, ease: 'power2.in' });
          await load();
        } catch (e) { toast(e.message, 'err'); }
      });
    });
    if (!reduced) gsap.from($$('.card', lib), { opacity: 0, y: 40, rotationX: 10, transformPerspective: 1000, duration: 1, stagger: 0.07, ease: 'expo.out', clearProps: 'opacity,transform' });
  }

  async function load() {
    const r = await A.factureModeles();
    list = r.modeles;
    actif = r.actif;
    if (balisesRef && !balisesRef.childElementCount) {
      const label = { auto: 'Automatique', saisi: 'Saisi à l\'envoi', mail: 'Du mail' };
      balisesRef.innerHTML = `<p class="balises-legend">
          <span class="bsrc bsrc--auto">Automatique</span> rempli tout seul ·
          <span class="bsrc bsrc--saisi">Saisi à l'envoi</span> tu le tapes ·
          <span class="bsrc bsrc--mail">Du mail</span> repris du mail
        </p>` + r.balises.map((b) => `<div class="balise-item">
          <span class="tag">{{${esc(b.nom)}}}</span>
          <span class="bsrc bsrc--${esc(b.source || 'auto')}">${esc(label[b.source] || 'Auto')}</span>
          <span class="balise-item__desc">${esc(b.desc)}</span></div>`).join('');
    }
    render();
    return list;
  }

  async function importFile(file) {
    if (!file) return;
    try {
      if (!/\.html?$/i.test(file.name)) throw new Error('Choisis un fichier .html');
      if (file.size > MAX) throw new Error(`Fichier trop lourd (${kb(file.size)}, 600 Ko maximum).`);
      const slug = slugify(file.name);
      if (list.some((t) => t.slug === slug)
        && !(await confirmBox(`Un modèle « ${slug}.html » existe déjà. Le remplacer ?`, { ok: 'Remplacer' }))) return;
      const t = await A.importFactureModele(file.name, await file.text());
      cache.delete(t.slug);
      toast(`Modèle de facture « ${t.nom} » importé.`);
      await load();
      const card = $(`[data-card="${CSS.escape(t.slug)}"]`, lib);
      card?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  $('[data-fimport]', root).addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { importFile(fileInput.files[0]); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => importFile(e.dataTransfer.files[0]));

  return { load };
}
