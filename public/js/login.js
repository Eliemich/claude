/**
 * Connexion : identifiants → (si la double authentification est activée : configuration puis code).
 * Entrée animée (logo qui pivote et dont les yeux s'allument, nom, carte), logo et carte inclinés en 3D,
 * puis « saut » dans la scène vers l'interface.
 */
import { A } from './api.js';
import { $, $$, ICON } from './ui.js';
import { gsap, reduced, tilt, spotlight, magnetic, splitIn } from './fx/motion.js';
import { createScene } from './fx/scene.js';

const fx = createScene($('#scene'), { mode: 'login' });
const card = $('[data-card]');
const err = $('[data-error]');
$$('[data-icon]').forEach((el) => { el.innerHTML = ICON[el.dataset.icon] || ''; });

/* ---------- Entrée ---------- */
spotlight();
tilt(card, { max: 4.5, glare: true });
tilt($('[data-emblem]'), { max: 11, lift: 30, perspective: 700 });
magnetic($('[data-magnetic]'), 0.18);

if (reduced) {
  document.documentElement.classList.remove('js-intro');
  gsap.set('.emblem__eye', { opacity: 0.85 });
} else {
  gsap.set('[data-word]', { opacity: 0 });
  gsap.set('.emblem__shine', { x: 0, xPercent: -120, rotation: 18 });
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' }, onStart: () => document.documentElement.classList.remove('js-intro') });
  tl.fromTo('[data-orb]', { opacity: 0, scale: 0.55, rotationY: -70, rotationX: 20, filter: 'blur(14px) brightness(0.3)' },
    { opacity: 1, scale: 1, rotationY: 0, rotationX: 0, filter: 'blur(0px) brightness(1)', duration: 1.6, clearProps: 'filter' }, 0.1)
    // Les yeux s'allument (vacillement, puis pleine lueur)
    .to('.emblem__eye', { keyframes: { opacity: [0, 0.9, 0.2, 1, 0.55, 1] }, scale: 1.15, duration: 0.9, ease: 'none', stagger: 0.08 }, 0.95)
    .to('.emblem__eye', { scale: 1, duration: 0.6, ease: 'power2.out' }, '>')
    .to('.emblem__shine', { xPercent: 120, duration: 1.2, ease: 'power2.inOut' }, 1.15)
    .add(() => splitIn($('[data-word]'), { stagger: 0.035 }), 0.35)
    .fromTo('[data-tag]', { opacity: 0, letterSpacing: '0.6em' }, { opacity: 1, letterSpacing: '0.32em', duration: 1.4 }, 0.6)
    .fromTo(card, { opacity: 0, y: 70, rotationX: 18, z: -160, filter: 'blur(10px)' },
      { opacity: 1, y: 0, rotationX: 0, z: 0, filter: 'blur(0px)', duration: 1.5, clearProps: 'filter' }, 0.5)
    .from('[data-step="login"] > *, .login-card__foot', { opacity: 0, y: 16, duration: 0.9, stagger: 0.06 }, 0.85);

  // Ensuite : les yeux palpitent doucement, un reflet traverse l'icône de temps en temps
  gsap.to('.emblem__eye', { opacity: 0.55, scale: 0.92, duration: 1.8, ease: 'sine.inOut', repeat: -1, yoyo: true, stagger: 0.25, delay: 3 });
  gsap.timeline({ repeat: -1, repeatDelay: 5.5, delay: 6 })
    .fromTo('.emblem__shine', { xPercent: -120 }, { xPercent: 120, duration: 1.3, ease: 'power2.inOut' });
}

/* ---------- Mot de passe visible / masqué ---------- */
const pass = $('#l-pass');
const toggle = $('[data-toggle-pass]');
toggle.innerHTML = ICON.eye;
toggle.addEventListener('click', () => {
  const show = pass.type === 'password';
  pass.type = show ? 'text' : 'password';
  toggle.innerHTML = show ? ICON.eyeOff : ICON.eye;
  toggle.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
});

/* ---------- Étapes ---------- */
function show(step) {
  const next = $(`form[data-step="${step}"]`);
  $$('form[data-step]').forEach((f) => (f.hidden = f !== next));
  err.textContent = '';
  if (!reduced) gsap.from(next.children, { opacity: 0, y: 18, duration: 0.7, stagger: 0.05, ease: 'expo.out' });
  next.querySelector('input')?.focus();
}
const busy = (form, on) => form.querySelector('button[type="submit"]').classList.toggle('is-loading', on);

function fail(message, field) {
  err.textContent = message;
  $$('.field', card).forEach((f) => f.classList.remove('is-invalid'));
  field?.closest('.field')?.classList.add('is-invalid');
  if (!reduced) gsap.fromTo(card, { x: 0 }, { keyframes: { x: [-12, 10, -7, 5, -2, 0] }, duration: 0.55, ease: 'power2.out' });
}

/** Connexion réussie : la carte s'envole, la scène accélère, puis l'interface s'ouvre. */
async function success(button) {
  button.classList.remove('is-loading');
  button.innerHTML = `${ICON.check}<span>Bienvenue</span>`;
  if (reduced) { location.replace('/envoi'); return; }
  gsap.timeline()
    .to(card, { z: 420, rotationX: -10, opacity: 0, filter: 'blur(14px)', duration: 0.9, ease: 'power3.in' }, 0.15)
    .to('.login__brand', { y: -60, opacity: 0, filter: 'blur(10px)', duration: 0.8, ease: 'power3.in' }, 0.1)
    .to('.login-legal', { opacity: 0, duration: 0.4 }, 0);
  await fx.warp(1.2);
  location.replace('/envoi');
}

$('form[data-step="login"]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const email = f.email.value.trim();
  if (!email || !f.password.value) return fail('Saisis ton email et ton mot de passe.', !email ? f.email : f.password);
  busy(f, true);
  try {
    const r = await A.login(email, f.password.value);
    if (r.step === 'done') return success(f.querySelector('button[type="submit"]'));
    if (r.step === 'setup') {
      $('[data-qr]').src = r.qr;
      $('[data-secret]').textContent = r.secret.replace(/(.{4})/g, '$1 ').trim();
    }
    busy(f, false);
    show(r.step);
  } catch (ex) {
    busy(f, false);
    fail(ex.message, f.password);
    f.password.select();
  }
});

$$('form[data-step="setup"], form[data-step="totp"]').forEach((form) => {
  const input = form.querySelector('input[name="code"]');
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    if (input.value.length === 6) form.requestSubmit();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(input.value)) return fail('Le code contient 6 chiffres.', input);
    busy(form, true);
    try {
      await A.totp(input.value);
      await success(form.querySelector('button[type="submit"]'));
    } catch (ex) {
      busy(form, false);
      fail(ex.code === 'AUTH_REQUIRED' ? 'Session expirée : reconnecte-toi.' : ex.message, input);
      if (ex.code === 'AUTH_REQUIRED') show('login');
      input.select();
    }
  });
});
