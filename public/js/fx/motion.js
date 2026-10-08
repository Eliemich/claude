/**
 * Effets de mouvement (GSAP) partagés par la connexion et l'interface :
 *  tilt()      inclinaison 3D d'un élément sous la souris (avec reflet)
 *  spotlight() halo lumineux qui suit la souris dans les panneaux .spot
 *  magnetic()  bouton légèrement attiré par le curseur
 *  splitIn()   titre révélé lettre par lettre (SplitText)
 *  revealIn()  apparition en cascade des éléments [data-reveal] d'un conteneur
 *  countTo()   compteur animé
 * Tout est désactivé si « réduire les animations » est activé, et l'inclinaison sur écran tactile.
 */
import gsap from '/vendor/gsap/index.js';
import { SplitText } from '/vendor/gsap/SplitText.js';

gsap.registerPlugin(SplitText);
export { gsap };

export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * Inclinaison 3D : l'élément pivote vers le curseur (max en degrés), autour d'une inclinaison de repos
 * (base, en degrés). Renvoie une fonction d'arrêt.
 */
export function tilt(el, { max = 6, lift = 0, glare = false, base = { x: 0, y: 0 }, perspective = 1100 } = {}) {
  if (reduced || !finePointer || !el) return () => {};
  gsap.set(el, { transformPerspective: perspective, transformStyle: 'preserve-3d', rotationX: base.x, rotationY: base.y });
  const rx = gsap.quickTo(el, 'rotationX', { duration: 0.7, ease: 'power3.out' });
  const ry = gsap.quickTo(el, 'rotationY', { duration: 0.7, ease: 'power3.out' });
  const z = gsap.quickTo(el, 'z', { duration: 0.7, ease: 'power3.out' });
  let shine = null;
  if (glare) {
    shine = document.createElement('span');
    shine.className = 'glare';
    el.append(shine);
  }
  const move = (e) => {
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    ry(base.y + px * max * 2);
    rx(base.x - py * max * 2);
    z(lift);
    if (shine) gsap.to(shine, { opacity: 1, x: px * r.width * 0.6, y: py * r.height * 0.6, duration: 0.6, ease: 'power3.out' });
  };
  const leave = () => {
    rx(base.x); ry(base.y); z(0);
    if (shine) gsap.to(shine, { opacity: 0, duration: 0.6 });
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerleave', leave);
  return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); leave(); };
}

/** Halo sous le curseur : une seule écoute pour toute la page (variables CSS --mx / --my du panneau survolé). */
export function spotlight() {
  if (!finePointer) return;
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('.spot');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

/** Bouton « magnétique » : suit un peu le curseur quand il passe dessus. */
export function magnetic(el, strength = 0.28) {
  if (reduced || !finePointer || !el) return;
  const x = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'elastic.out(1, 0.5)' });
  const y = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'elastic.out(1, 0.5)' });
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    x((e.clientX - r.left - r.width / 2) * strength);
    y((e.clientY - r.top - r.height / 2) * strength);
  });
  el.addEventListener('pointerleave', () => { x(0); y(0); });
}

/** Titre révélé lettre par lettre, avec un léger effet de profondeur. */
export function splitIn(el, { delay = 0, stagger = 0.022 } = {}) {
  if (!el) return null;
  if (reduced) { gsap.set(el, { opacity: 1 }); return null; }
  gsap.set(el, { opacity: 1 });
  const split = SplitText.create(el, { type: 'words,chars', mask: 'words', wordsClass: 'split-word' });
  return gsap.from(split.chars, {
    yPercent: 120, rotationX: -70, opacity: 0, transformOrigin: '50% 100% -20px',
    duration: 1.1, ease: 'expo.out', stagger, delay,
    onComplete: () => split.revert(),
  });
}

/** Apparition en cascade des éléments [data-reveal] (montée + flou qui s'efface). */
export function revealIn(root, { delay = 0 } = {}) {
  const items = [...root.querySelectorAll('[data-reveal]')].filter((el) => !el.closest('[hidden]'));
  if (!items.length) return null;
  if (reduced) { gsap.set(items, { opacity: 1, clearProps: 'transform,filter' }); return null; }
  return gsap.fromTo(items,
    { opacity: 0, y: 34, rotationX: 8, filter: 'blur(8px)', transformPerspective: 1000 },
    { opacity: 1, y: 0, rotationX: 0, filter: 'blur(0px)', duration: 1, ease: 'expo.out', stagger: 0.07, delay, clearProps: 'filter,transform' });
}

/** Compteur animé jusqu'à une valeur. */
export function countTo(el, value, { duration = 1.4, delay = 0 } = {}) {
  if (!el) return;
  const from = Number(el.dataset.value || 0);
  el.dataset.value = value;
  if (reduced) { el.textContent = value.toLocaleString('fr-FR'); return; }
  const o = { v: from };
  gsap.to(o, { v: value, duration, delay, ease: 'power3.out', onUpdate: () => { el.textContent = Math.round(o.v).toLocaleString('fr-FR'); } });
}
