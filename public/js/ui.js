/** Petits outils d'interface : échappement, formats, notifications, fenêtres, icônes. */
import { gsap, reduced } from './fx/motion.js';

export const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Crée un élément à partir de HTML (données déjà échappées avec esc). */
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const fdatetime = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const fdateLong = (d = new Date()) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
export const kb = (n) => `${Math.max(1, Math.round(n / 1024))} Ko`;

/* ---------- Notifications ---------- */
export function toast(msg, type = 'ok') {
  let box = $('.toasts');
  if (!box) { box = h('<div class="toasts" role="status" aria-live="polite"></div>'); document.body.append(box); }
  const el = h(`<div class="toast toast--${type}">${esc(msg)}</div>`);
  box.append(el);
  if (!reduced) gsap.from(el, { x: 60, opacity: 0, scale: 0.92, duration: 0.6, ease: 'expo.out' });
  setTimeout(() => (reduced ? el.remove() : gsap.to(el, { x: 40, opacity: 0, duration: 0.4, ease: 'power2.in', onComplete: () => el.remove() })), type === 'err' ? 6500 : 3800);
}

/* ---------- Fenêtres ---------- */
/**
 * Ouvre une fenêtre. actions : [{ label, cls, onClick(close, body) }] — onClick peut être async ;
 * s'il lève une erreur, elle s'affiche dans la fenêtre (qui reste ouverte).
 */
export function modal({ title, body = '', actions = [], width = 560 }) {
  const dlg = h(`<dialog class="modal" style="width:min(${width}px,calc(100vw - 32px))">
    <div class="modal__box glass">
      <div class="modal__head"><h3>${esc(title)}</h3><button class="modal__close" type="button" aria-label="Fermer">${ICON.close}</button></div>
      <div class="modal__body"></div>
      <p class="form-error modal__error" data-modal-error></p>
      <div class="modal__foot"></div>
    </div>
  </dialog>`);
  const bodyEl = $('.modal__body', dlg);
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.append(body);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    const done = () => { dlg.close(); dlg.remove(); };
    if (reduced) done(); else gsap.to($('.modal__box', dlg), { opacity: 0, y: 16, scale: 0.97, duration: 0.25, ease: 'power2.in', onComplete: done });
  };
  $('.modal__close', dlg).addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  const errEl = $('[data-modal-error]', dlg);
  actions.forEach((a) => {
    const b = h(`<button type="button" class="btn ${a.cls || 'btn--ghost'}">${a.icon || ''}<span>${esc(a.label)}</span></button>`);
    b.addEventListener('click', async () => {
      errEl.textContent = '';
      b.classList.add('is-loading');
      try { await a.onClick?.(close, bodyEl); } catch (e) { errEl.textContent = e.message; } finally { b.classList.remove('is-loading'); }
    });
    $('.modal__foot', dlg).append(b);
  });
  document.body.append(dlg);
  dlg.showModal();
  if (!reduced) gsap.from($('.modal__box', dlg), { opacity: 0, y: 30, rotationX: 10, scale: 0.96, transformPerspective: 900, duration: 0.6, ease: 'expo.out' });
  dlg.addEventListener('close', () => { closed = true; });
  return { el: dlg, body: bodyEl, close, onClose: (fn) => dlg.addEventListener('close', fn) };
}

export function confirmBox(text, { title = 'Confirmation', ok = 'Confirmer', danger = false, html = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const m = modal({
      title,
      body: html ? text : `<p style="margin:0;color:var(--ink-2)">${esc(text)}</p>`,
      actions: [
        { label: 'Annuler', onClick: (close) => { answered = true; close(); resolve(false); } },
        { label: ok, cls: danger ? 'btn--danger' : 'btn--primary', onClick: (close) => { answered = true; close(); resolve(true); } },
      ],
    });
    m.onClose(() => { if (!answered) resolve(false); });
  });
}

/** Icônes (traits fins, héritent de la couleur du texte). */
const svg = (d, w = 1.7) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  send: svg('<path d="M21.5 2.5 10.6 13.4"/><path d="m21.5 2.5-7 19-3.9-8.1-8.1-3.9 19-7Z"/>'),
  plane: svg('<path d="m21.5 2.5-7 19-3.9-8.1-8.1-3.9 19-7Z"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>'),
  quote: svg('<path d="M4 7h16M4 12h11M4 17h16"/>'),
  layers: svg('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>'),
  receipt: svg('<path d="M5 3v18l2.2-1.4L9.4 21l2.2-1.4L13.8 21l2.2-1.4L18.2 21 19 3z"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>'),
  star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
  starFill: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  logout: svg('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', 2),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 2),
  upload: svg('<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>'),
  download: svg('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  expand: svg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
  desktop: svg('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  phone: svg('<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  sparkle: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>', 2.2),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  shield: svg('<path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>'),
};
