/**
 * Interface d'envoi : barre du haut, onglets (Envoyer / Modèles / Historique), statistiques.
 * Chaque onglet est géré par son module (views/). L'adresse #modeles ou #historique ouvre l'onglet.
 */
import { A } from './api.js';
import { $, $$, toast, ICON } from './ui.js';
import { gsap, reduced, spotlight, magnetic, splitIn, revealIn, countTo } from './fx/motion.js';
import { createScene } from './fx/scene.js';
import { createCompose } from './views/compose.js';
import { createModels } from './views/models.js';
import { createFactureModels } from './views/facture-models.js';
import { createHistory } from './views/history.js';

const fx = createScene($('#scene'), { mode: 'app' });
const fillIcons = (root = document) => $$('[data-icon]', root).forEach((el) => { if (ICON[el.dataset.icon]) el.innerHTML = ICON[el.dataset.icon]; });
fillIcons();
spotlight();
magnetic($('[data-magnetic]'), 0.2);

/* ---------- Compte et mode d'envoi ---------- */
let status = { mode: 'test', from: '' };
const VIEWS = ['envoyer', 'modeles', 'historique'];
const view = (name) => $(`[data-view="${name}"]`);

function showStatus() {
  const el = $('[data-status]');
  el.className = `status status--${status.mode}`;
  $('[data-status-text]').textContent = status.mode === 'smtp' ? `Zoho · ${status.from}` : 'Mode test';
  el.title = status.mode === 'smtp'
    ? `Envoi réel depuis ${status.from}`
    : 'Mode test : aucun serveur d\'envoi configuré, rien ne part. Les emails sont enregistrés dans data/outbox/ sur le serveur.';
  $('[data-user-name]').textContent = status.user?.nom || '';
  $('[data-avatar]').textContent = (status.user?.nom || '?').trim()[0]?.toUpperCase() || '?';
}

/* ---------- Statistiques + courbe ---------- */
function sparkline(svg, data) {
  const w = 160;
  const hgt = 38;
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => [(i * w) / (data.length - 1), hgt - 4 - (v / max) * (hgt - 10)]);
  const d = `M${pts.map((p) => p.map((n) => n.toFixed(1)).join(' ')).join(' L')}`;
  const [lx, ly] = pts[pts.length - 1];
  svg.innerHTML = `<defs><linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5aa9ff" stop-opacity=".42"/><stop offset="1" stop-color="#5aa9ff" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${w} ${hgt} L0 ${hgt} Z" fill="url(#spark-fill)"/>
    <path d="${d}" fill="none" stroke="#8cc8ff" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" data-line/>
    <circle cx="${lx}" cy="${ly}" r="2.8" fill="#fff"/><circle cx="${lx}" cy="${ly}" r="6" fill="#5aa9ff" opacity=".35"/>`;
  if (!reduced) {
    const line = $('[data-line]', svg);
    const len = line.getTotalLength();
    gsap.fromTo(line, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.6, ease: 'power2.inOut', delay: 0.3 });
  }
}

async function loadStats(delay = 0) {
  try {
    const s = await A.stats();
    countTo($('[data-stat="aujourdhui"]'), s.aujourdhui, { delay });
    countTo($('[data-stat="semaine"]'), s.semaine, { delay: delay + 0.08 });
    countTo($('[data-stat="total"]'), s.total, { delay: delay + 0.16 });
    sparkline($('[data-spark]'), s.parJour);
  } catch { /* statistiques indisponibles : rien de bloquant */ }
}
const showModelCount = (n) => { $('[data-stat-models]').textContent = n; };

/* ---------- Onglets ---------- */
const compose = createCompose(view('envoyer'), {
  fx,
  getStatus: () => status,
  onSent: () => loadStats(),
});
const models = createModels(view('modeles'), {
  onUse: (slug) => { compose.select(slug); location.hash = '#envoyer'; },
  onChange: async (slug) => { const list = await compose.load(slug); showModelCount(list.length); },
});
const factureModels = createFactureModels(view('modeles'));
const history = createHistory(view('historique'));

/* ---------- Sélecteur Emails | Factures (onglet Modèles) ---------- */
const modelesView = view('modeles');
const msegGlow = $('[data-mseg-glow]', modelesView);
let factureLoaded = false;
function moveMseg(btn, instant = false) {
  if (!btn) return;
  const props = { x: btn.offsetLeft, width: btn.offsetWidth };
  if (instant || reduced) gsap.set(msegGlow, props);
  else gsap.to(msegGlow, { ...props, duration: 0.5, ease: 'expo.out' });
}
$$('[data-mseg]', modelesView).forEach((btn) => btn.addEventListener('click', async () => {
  const sub = btn.dataset.mseg;
  $$('[data-mseg]', modelesView).forEach((b) => b.classList.toggle('is-active', b === btn));
  $$('[data-sub]', modelesView).forEach((s) => (s.hidden = s.dataset.sub !== sub));
  moveMseg(btn);
  if (sub === 'factures' && !factureLoaded) {
    factureLoaded = true;
    try { await factureModels.load(); } catch (e) { toast(e.message, 'err'); }
  }
  revealIn($(`[data-sub="${sub}"]`, modelesView), { delay: 0.02 });
}));

const glow = $('[data-tab-glow]');
function moveGlow(name, instant = false) {
  const btn = $(`[data-tab="${name}"]`);
  const props = { x: btn.offsetLeft - 5, width: btn.offsetWidth };
  if (instant || reduced) gsap.set(glow, props);
  else gsap.to(glow, { ...props, duration: 0.7, ease: 'expo.out' });
}

let currentView = null;
const splitDone = new Set();
async function go(name, { instant = false } = {}) {
  if (!VIEWS.includes(name)) name = 'envoyer';
  if (name === currentView) return;
  const prev = currentView ? view(currentView) : null;
  currentView = name;
  $$('[data-tab]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.tab === name);
    b.setAttribute('aria-selected', String(b.dataset.tab === name));
  });
  moveGlow(name, instant);

  if (prev && !reduced) await gsap.to(prev, { opacity: 0, y: 20, filter: 'blur(6px)', duration: 0.28, ease: 'power2.in' });
  if (prev) { prev.hidden = true; gsap.set(prev, { clearProps: 'opacity,transform,filter' }); }
  const next = view(name);
  next.hidden = false;
  scrollTo({ top: 0, behavior: 'instant' });

  const title = $('[data-split]', next);
  if (!splitDone.has(name)) { splitDone.add(name); splitIn(title, { delay: 0.05 }); }
  revealIn(next, { delay: 0.08 });

  try {
    if (name === 'modeles') { await models.load(); moveMseg($('[data-mseg].is-active', next), true); }
    if (name === 'historique') await history.load();
  } catch (e) { toast(e.message, 'err'); }
}

$$('[data-tab]').forEach((b) => b.addEventListener('click', () => { location.hash = `#${b.dataset.tab}`; }));
addEventListener('hashchange', () => go(location.hash.slice(1)));
addEventListener('resize', () => currentView && moveGlow(currentView, true));

/* ---------- Déconnexion ---------- */
$('[data-logout]').addEventListener('click', async () => {
  try { await A.logout(); } catch { /* session déjà fermée */ }
  if (!reduced) await gsap.to('.topbar, .app', { opacity: 0, y: -20, filter: 'blur(8px)', duration: 0.45, ease: 'power2.in', stagger: 0.05 });
  location.replace('/connexion');
});

/* ---------- Démarrage ---------- */
try {
  status = await A.status();
  showStatus();
  const list = await compose.load();
  showModelCount(list.length);
} catch (e) {
  toast(e.message, 'err');
}
document.documentElement.classList.remove('js-intro');
// clearProps : un transform laissé sur la barre retiendrait la barre d'onglets fixe (téléphone)
if (!reduced) gsap.from('[data-topbar]', { y: -40, opacity: 0, filter: 'blur(10px)', duration: 1.1, ease: 'expo.out', clearProps: 'transform,filter,opacity' });
await go(location.hash.slice(1) || 'envoyer', { instant: true });
loadStats(0.5);
if (status.mode === 'test') {
  setTimeout(() => toast('Mode test : aucun email ne part vraiment tant que Zoho n\'est pas configuré sur le serveur.', 'err'), 1600);
}
