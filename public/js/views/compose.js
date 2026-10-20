/**
 * Onglet « Envoyer » : choix du modèle, destinataire, balises, aperçu en direct sur l'écran 3D, envoi.
 *  - les valeurs saisies sont gardées quand on change de modèle (même nom de balise = même valeur) ;
 *  - {{email}} est rempli avec l'adresse du destinataire, {{date_du_jour}} avec la date du jour ;
 *  - l'aperçu est demandé au serveur (même remplissage qu'à l'envoi) ; les balises vides restent visibles.
 *  - une case par balise, générée d'après le modèle (le serveur scanne le HTML, voir src/modeles.js) ;
 *    son type vient du préfixe facultatif {{type:nom}} :
 *      {{date:…}} → calendrier + bouton « Auj. »,  {{time:…}} → heure entre 08:00 et 20:00
 *      (et heure_debut < heure_fin),  {{adresse:…}} → suggestions d'adresses (voir adresse.js),
 *      sans préfixe → texte (ou lien / texte multiligne, comme avant) ;
 *  - libellés des cases : balise-labels.js.
 */
import { A } from '../api.js';
import { $, $$, esc, debounce, toast, modal, confirmBox, ICON, fdateLong } from '../ui.js';
import { gsap, reduced, tilt } from '../fx/motion.js';
import { labelOf } from './balise-labels.js';
import { attachAdresse, adresseField } from './adresse.js';

const EMAIL_RE = /^[^\s@<>,;"'()]+@[^\s@<>,;"'()]+\.[a-z]{2,}$/i;
const LINK_RE = /^(https:\/\/|mailto:)\S+$/i;
// Balises d'un modèle « facture » remplies par l'encadré Facture (pas demandées comme simples cases).
const FACTURE_TAGS = ['lien_facture', 'numero_facture', 'montant', 'date_paiement', 'heure', 'lieu', 'description', 'client_nom'];
const todayISO = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ (heure locale)
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Plage des heures : envoyée par le serveur avec chaque balise « time » (b.min / b.max) ; valeurs de secours :
const TIME_MIN = '08:00';
const TIME_MAX = '20:00';

/** Exemple affiché dans une case, d'après le nom de la balise. */
function placeholderFor(b) {
  const n = b.nom;
  if (b.type === 'lien') return 'https://…';
  if (b.type === 'texte') return 'Ton message… (les retours à la ligne sont conservés)';
  if (b.type === 'adresse') return 'Ex. 8 boulevard du Port, Amiens';
  if (/prenom/.test(n)) return 'Ex. Alex';
  if (/^nom/.test(n)) return 'Ex. Martin';
  if (/date/.test(n)) return `Ex. ${fdateLong(new Date(Date.now() + 30 * 864e5))}`;
  if (/montant|prix|total/.test(n)) return 'Ex. 49 €';
  if (/email/.test(n)) return 'adresse@exemple.com';
  return '';
}

/** Problème d'une valeur selon le type de sa balise (null = valeur correcte). Même règles que le serveur. */
function problemOf(b, v) {
  if (!v) return 'à remplir';
  if (b.type === 'lien' && !LINK_RE.test(v)) return 'adresse https:// attendue';
  if (b.type === 'date' && !ISO_DATE_RE.test(v)) return 'date invalide';
  if (b.type === 'time') {
    if (!TIME_RE.test(v)) return 'heure invalide';
    const min = b.min || TIME_MIN;
    const max = b.max || TIME_MAX;
    if (v < min || v > max) return `entre ${min} et ${max}`; // HH:MM : la comparaison de textes suffit
  }
  return null;
}
const valid = (b, v) => !problemOf(b, v);

/** Aperçu : les liens s'ouvrent dans un nouvel onglet. */
export const withBase = (html) => (/<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, '<head$1><base target="_blank">') : `<base target="_blank">${html}`);

export function createCompose(root, { fx, getStatus, onSent }) {
  const grid = $('[data-tpl-grid]', root);
  const varsEl = $('[data-vars]', root);
  const factureEl = $('[data-facture]', root);
  const toInput = $('[name="to"]', root);
  const subjectInput = $('[name="subject"]', root);
  const subjectReset = $('[data-subject-reset]', root);
  let subjectTouched = false; // l'objet a été modifié à la main → on l'envoie tel quel (sinon : objet du modèle)
  const frame = $('[data-frame]', root);
  const screen = $('[data-screen]', root);
  const loading = $('[data-loading]', root);
  const sendBtn = $('[data-send]', root);
  const device = $('[data-device]', root);
  let modeles = [];
  let current = null;
  const values = {};           // valeurs saisies, gardées d'un modèle à l'autre
  const fvalues = {};          // champs de l'encadré Facture (f_montant, f_date, f_heure, f_lieu, f_client, f_description)
  const isManaged = (nom) => Boolean(current?.facture) && FACTURE_TAGS.includes(nom);
  const hasTag = (nom) => Boolean(current?.balises.some((b) => b.nom === nom && !isManaged(nom)));

  /**
   * Heure de début avant heure de fin : heure_debut / heure_fin (et toute paire …debut… / …fin…).
   * Renvoie [{ nom: balise de fin, debut: balise de début }].
   */
  function crossProblems() {
    const times = new Set((current?.balises || []).filter((b) => b.type === 'time' && !isManaged(b.nom)).map((b) => b.nom));
    const out = [];
    for (const debut of times) {
      if (!debut.includes('debut')) continue;
      const fin = debut.replace('debut', 'fin');
      const a = values[debut] || '';
      const b = values[fin] || '';
      if (times.has(fin) && TIME_RE.test(a) && TIME_RE.test(b) && a >= b) out.push({ nom: fin, debut });
    }
    return out;
  }
  let emailEdited = false;     // {{email}} modifié à la main : n'est plus recopié depuis le destinataire
  let last = null;             // dernier aperçu reçu du serveur
  let lastHtml = '';

  /* ---------- Écran 3D : inclinaison au survol (grands écrans) ---------- */
  if (matchMedia('(min-width: 981px)').matches) tilt(device, { max: 2.6, base: { x: 2, y: -5 }, perspective: 2200 });

  /* ---------- Choix du modèle ---------- */
  function renderPicker() {
    if (!modeles.length) {
      grid.innerHTML = '<p class="tpl-empty">Aucun modèle. Importe un fichier .html dans l\'onglet Modèles.</p>';
      return;
    }
    grid.innerHTML = modeles.map((t) => `
      <button type="button" class="tpl" data-slug="${esc(t.slug)}" aria-pressed="false">
        <span class="tpl__check">${ICON.check}</span>
        <span class="tpl__top"><span class="tpl__mono">${esc(t.nom.trim()[0]?.toUpperCase() || '?')}</span><span class="tpl__name">${esc(t.nom)}</span></span>
        <span class="tpl__desc">${esc(t.description || t.objet || 'Sans description')}</span>
        <span class="tpl__foot"><span class="tag">${t.balises.length} balise${t.balises.length > 1 ? 's' : ''}</span>${t.facture ? '<span class="tpl__badge">● Facture</span>' : ''}${t.objet ? '' : '<span class="chip chip--warn">sans objet</span>'}</span>
      </button>`).join('');
    $$('.tpl', grid).forEach((b) => b.addEventListener('click', () => select(b.dataset.slug)));
  }

  function select(slug, { animate = true } = {}) {
    current = modeles.find((t) => t.slug === slug) || modeles[0] || null;
    $$('.tpl', grid).forEach((b) => {
      const on = b.dataset.slug === current?.slug;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    subjectTouched = false;            // l'objet repart de celui du nouveau modèle
    subjectReset.hidden = true;
    renderVars(animate);
    refresh();
  }

  /* ---------- Encadré Facture (modèles « facture ») ---------- */
  function renderFacture() {
    if (!current?.facture) { factureEl.hidden = true; factureEl.innerHTML = ''; return; }
    factureEl.hidden = false;
    if (fvalues.f_date === undefined) fvalues.f_date = todayISO();
    if (!fvalues.f_client) fvalues.f_client = values.prenom || '';
    const f = (name, label, attrs, wide) => `<div class="field${wide ? ' field--wide' : ''}" data-f-field="${name}">
      <label>${label}</label><input class="input" data-f="${name}" ${attrs} value="${esc(fvalues['f_' + name] || '')}"></div>`;
    factureEl.innerHTML = `
      <div class="facture-box">
        <p class="facture-box__head">${ICON.layers}<span>Facture — à renseigner avant l'envoi</span></p>
        <div class="facture-grid">
          ${f('montant', 'Montant réglé (€) *', 'inputmode="decimal" placeholder="Ex. 49"')}
          ${f('date', 'Date du paiement', 'type="date"')}
          ${f('heure', 'Heure', 'type="time"')}
          ${f('lieu', 'Lieu', 'placeholder="Ex. En ligne"')}
          ${f('client', 'Nom du client', 'placeholder="Ex. Alex Martin"')}
          ${f('description', 'Description', 'placeholder="Abonnement canal privé Trading Bara"', true)}
        </div>
        <p class="facture-box__note">${ICON.link} Un lien unique vers la facture est créé et inséré dans <span class="tag">{{lien_facture}}</span> à l'envoi.</p>
      </div>`;
  }

  /* ---------- Balises ---------- */
  function renderVars(animate) {
    renderFacture();
    const list = (current?.balises || []).filter((b) => !isManaged(b.nom)); // les balises « facture » sont dans l'encadré
    const sub = $('[data-vars-sub]', root);
    if (current?.facture) sub.textContent = list.length ? `Complète l'encadré Facture, puis ${list.length} balise${list.length > 1 ? 's' : ''} du message.` : 'Complète l\'encadré Facture ci-dessus.';
    else sub.textContent = list.length ? `${list.length} information${list.length > 1 ? 's' : ''} à insérer dans « ${current.nom} ».` : 'Ce modèle n\'a aucune balise : il est envoyé tel quel.';
    if (!list.length) {
      varsEl.innerHTML = current && !current.facture ? `<p class="vars-empty">${current ? 'Rien à remplir pour ce modèle.' : 'Choisis d\'abord un modèle.'}</p>` : '';
      markDone();
      return;
    }
    // Valeurs automatiques (modifiables). {{date_du_jour}} : AAAA-MM-JJ pour une case date, en toutes lettres sinon.
    const dateDuJour = list.find((b) => b.nom === 'date_du_jour');
    if (dateDuJour?.type === 'date') { if (!ISO_DATE_RE.test(values.date_du_jour || '')) values.date_du_jour = todayISO(); }
    else if (values.date_du_jour === undefined || ISO_DATE_RE.test(values.date_du_jour)) values.date_du_jour = fdateLong();
    if (!emailEdited) values.email = toInput.value.trim();

    varsEl.innerHTML = list.map((b) => {
      const id = `v-${b.nom}`;
      const value = values[b.nom] || '';
      const common = `id="${id}" data-var="${esc(b.nom)}" placeholder="${esc(placeholderFor(b))}" maxlength="${b.type === 'texte' ? 2000 : 500}"`;
      const plain = `id="${id}" data-var="${esc(b.nom)}"`; // date / heure : le navigateur affiche son propre sélecteur
      let input;
      let hint = '';
      if (b.type === 'texte') {
        input = `<textarea class="input" rows="5" ${common}>${esc(value)}</textarea>`;
      } else if (b.type === 'date') {
        input = `<div class="input-row">
            <input class="input" type="date" ${plain} value="${esc(value)}">
            <button type="button" class="btn btn--ghost btn--sm" data-today="${esc(b.nom)}" title="Date du jour">Auj.</button>
          </div>`;
      } else if (b.type === 'time') {
        const min = b.min || TIME_MIN;
        const max = b.max || TIME_MAX;
        input = `<input class="input" type="time" ${plain} min="${esc(min)}" max="${esc(max)}" step="60" value="${esc(value)}">`;
        hint = `<span class="hint" data-var-hint>Entre ${esc(min)} et ${esc(max)}</span>`;
      } else if (b.type === 'adresse') {
        input = `<div class="input-icon"><span data-icon>${ICON.search}</span>${adresseField(b.nom, common, value)}</div>`;
        const fills = [`code_postal_${b.nom}`, 'code_postal', `ville_${b.nom}`, 'ville'].filter(hasTag);
        hint = `<span class="hint">Tape 3 lettres puis choisis une suggestion${fills.length ? ` (remplit aussi ${fills.map((n) => `{{${esc(n)}}}`).join(', ')})` : ''}</span>`;
      } else {
        input = `<div class="input-icon"><span data-icon>${b.type === 'lien' ? ICON.link : ICON.sparkle}</span>
            <input class="input" type="${b.type === 'lien' ? 'url' : 'text'}" ${common} value="${esc(value)}" autocomplete="off" spellcheck="${b.type === 'ligne'}"></div>`;
        if (b.type === 'lien') hint = '<span class="hint">Adresse complète, commençant par https://</span>';
      }
      return `<div class="field${b.type === 'texte' ? ' field--wide' : ''}" data-var-field="${esc(b.nom)}">
        <label class="var-label" for="${id}"><span>${esc(labelOf(b.nom))}</span><span class="tag">{{${esc(b.nom)}}}</span></label>
        ${input}
        ${hint}
      </div>`;
    }).join('');
    markDone();
    if (animate && !reduced) gsap.from(varsEl.children, { opacity: 0, y: 14, duration: 0.6, stagger: 0.04, ease: 'expo.out' });
  }

  function markDone() {
    const cross = crossProblems();
    for (const b of current?.balises || []) {
      if (isManaged(b.nom)) continue;
      const f = $(`[data-var-field="${CSS.escape(b.nom)}"]`, varsEl);
      const c = cross.find((x) => x.nom === b.nom);
      f?.classList.toggle('is-done', valid(b, values[b.nom]) && !c);
      f?.classList.toggle('is-invalid', Boolean(c)); // heure de fin avant le début : signalé tout de suite
      // Heures : la remarque sous la case dit ce qui ne va pas (plage, ordre début / fin)
      const hint = b.type === 'time' && f ? $('[data-var-hint]', f) : null;
      if (hint) {
        const p = values[b.nom] ? problemOf(b, values[b.nom]) : null;
        hint.textContent = c ? `Doit être après ${labelOf(c.debut).toLowerCase()}` : p ? `Heure ${p}` : `Entre ${b.min || TIME_MIN} et ${b.max || TIME_MAX}`;
        hint.classList.toggle('hint--err', Boolean(c || p));
        if (p) f.classList.add('is-invalid');
      }
    }
    if (current?.facture) {
      const mf = $('[data-f-field="montant"]', factureEl);
      mf?.classList.toggle('is-done', Boolean(String(fvalues.f_montant || '').trim()));
      mf?.classList.remove('is-invalid');
    }
    $('[data-field="to"]', root).classList.toggle('is-done', EMAIL_RE.test(toInput.value.trim()));
    const subj = subjectTouched ? subjectInput.value.trim() : (current?.objet || '').trim();
    $('[data-field="subject"]', root).classList.toggle('is-done', Boolean(subj));
    $('[data-field="subject"]', root).classList.remove('is-invalid');
    updateReady();
  }

  /* ---------- Prêt à envoyer ? ---------- */
  function problems() {
    const out = [];
    if (!current) out.push('un modèle');
    if (!EMAIL_RE.test(toInput.value.trim())) out.push('l\'adresse du destinataire');
    const subj = subjectTouched ? subjectInput.value.trim() : (current?.objet || '').trim();
    if (current && !subj) out.push('l\'objet de l\'email');
    for (const b of current?.balises || []) {
      if (isManaged(b.nom)) continue;
      const p = problemOf(b, values[b.nom]);
      if (p) out.push(values[b.nom] ? `{{${b.nom}}} (${p})` : `{{${b.nom}}}`);
    }
    for (const c of crossProblems()) out.push(`{{${c.nom}}} après {{${c.debut}}}`);
    if (current?.facture && !String(fvalues.f_montant || '').trim()) out.push('le montant de la facture');
    return out;
  }
  function updateReady() {
    const p = problems();
    const state = $('[data-ready]', root);
    const detail = $('[data-ready-detail]', root);
    state.classList.toggle('is-ready', !p.length);
    state.textContent = p.length ? 'Il manque des informations' : 'Prêt à partir';
    detail.textContent = p.length ? `À compléter : ${p.slice(0, 4).join(', ')}${p.length > 4 ? '…' : ''}` : `À ${toInput.value.trim()} · ${last?.subject || current?.objet || ''}`;
    sendBtn.setAttribute('aria-disabled', String(p.length > 0));
  }

  /* ---------- Aperçu en direct ---------- */
  const payload = () => {
    const p = { modele: current?.slug, to: toInput.value.trim(),
      subject: subjectTouched ? subjectInput.value : '', // vide = objet du modèle (<title>)
      vars: Object.fromEntries((current?.balises || []).filter((b) => !isManaged(b.nom)).map((b) => [b.nom, values[b.nom] || ''])) };
    if (current?.facture) for (const k of ['montant', 'date', 'heure', 'lieu', 'client', 'description']) p[`f_${k}`] = fvalues[`f_${k}`] || '';
    return p;
  };

  let seq = 0;
  async function refresh() {
    if (!current) { frame.srcdoc = ''; return; }
    const n = ++seq;
    loading.classList.add('is-on');
    try {
      const p = await A.apercu(payload());
      if (n !== seq) return;
      last = p;
      if (!subjectTouched) subjectInput.value = p.subject || ''; // l'objet affiché suit le modèle tant qu'on n'y touche pas
      $('[data-p-subject]', root).textContent = p.subject || '— aucun objet : écris-en un ci-contre —';
      $('[data-p-from]', root).textContent = `<${p.from}>`;
      $('[data-p-to]', root).textContent = p.to || '—';
      const miss = $('[data-missing]', root);
      miss.hidden = !p.missing.length;
      miss.innerHTML = `<span>À remplir :</span>${p.missing.map((m) => `<span class="tag">{{${esc(m)}}}</span>`).join('')}`;
      if (p.html !== lastHtml) {
        lastHtml = p.html;
        let y = 0;
        try { y = frame.contentWindow?.scrollY || 0; } catch { /* aperçu pas encore chargé */ }
        frame.onload = () => { try { frame.contentWindow.scrollTo(0, y); } catch { /* rien */ } };
        frame.srcdoc = withBase(p.html);
      }
      updateReady();
    } catch (e) {
      if (n === seq) toast(e.message, 'err');
    } finally {
      if (n === seq) loading.classList.remove('is-on');
    }
  }
  const refreshSoon = debounce(refresh, 280);

  /* ---------- Saisie ---------- */
  varsEl.addEventListener('input', (e) => {
    const name = e.target.dataset.var;
    if (!name) return;
    values[name] = e.target.value;
    if (name === 'email') emailEdited = e.target.value.trim() !== toInput.value.trim();
    markDone();
    refreshSoon();
  });
  // Bouton « Auj. » des champs date
  varsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-today]');
    if (!btn) return;
    const name = btn.dataset.today;
    const input = $(`[data-var="${CSS.escape(name)}"]`, varsEl);
    values[name] = todayISO();
    if (input) input.value = values[name];
    markDone();
    refreshSoon();
  });

  // Champs adresse : une suggestion choisie remplit le champ, et {{code_postal}} / {{ville}} s'ils existent.
  // Avec plusieurs adresses, {{code_postal_<balise>}} / {{ville_<balise>}} (ex. {{ville_lieu_recup}}) sont prioritaires.
  attachAdresse(varsEl, {
    onPick(name, { label, postcode, city }) {
      values[name] = label;
      for (const [key, val] of [['code_postal', postcode], ['ville', city]]) {
        const target = hasTag(`${key}_${name}`) ? `${key}_${name}` : key;
        values[target] = val; // gardé même sans balise : resservira si un autre modèle en a une
        const el = $(`[data-var="${CSS.escape(target)}"]`, varsEl);
        if (el) el.value = val;
      }
      markDone();
      refreshSoon();
    },
  });

  factureEl.addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    fvalues[`f_${f}`] = e.target.value;
    markDone();
    refreshSoon();
  });
  toInput.addEventListener('input', () => {
    if (!emailEdited && current?.balises.some((b) => b.nom === 'email')) {
      values.email = toInput.value.trim();
      const f = $('[data-var="email"]', varsEl);
      if (f) f.value = values.email;
    }
    markDone();
    refreshSoon();
  });
  subjectInput.addEventListener('input', () => {
    subjectTouched = true;            // objet personnalisé : on l'envoie tel quel
    subjectReset.hidden = false;
    markDone();
    refreshSoon();
  });
  subjectReset.addEventListener('click', () => {
    subjectTouched = false;           // revenir à l'objet du modèle
    subjectReset.hidden = true;
    refresh();                        // repeuple l'objet depuis le modèle
  });
  $('[data-clear]', root).addEventListener('click', () => {
    for (const k of Object.keys(values)) delete values[k];
    for (const k of Object.keys(fvalues)) delete fvalues[k];
    emailEdited = false;
    subjectTouched = false;
    subjectReset.hidden = true;
    toInput.value = '';
    renderVars(true);
    refresh();
  });

  /* ---------- Largeur de l'aperçu, plein écran ---------- */
  $$('[data-width]', root).forEach((b) => b.addEventListener('click', () => {
    $$('[data-width]', root).forEach((x) => x.classList.toggle('is-on', x === b));
    screen.classList.toggle('is-mobile', b.dataset.width === 'mobile');
  }));
  $('[data-expand]', root).addEventListener('click', () => {
    if (!lastHtml) return;
    const m = modal({
      title: last?.subject || 'Aperçu',
      width: 980,
      body: '<div class="big-preview"><iframe title="Aperçu agrandi" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe></div>',
      actions: [{ label: 'Fermer', onClick: (close) => close() }],
    });
    $('iframe', m.body).srcdoc = withBase(lastHtml);
  });

  /* ---------- Envoi ---------- */
  function flagProblems() {
    if (!EMAIL_RE.test(toInput.value.trim())) $('[data-field="to"]', root).classList.add('is-invalid');
    const subj = subjectTouched ? subjectInput.value.trim() : (current?.objet || '').trim();
    if (!subj) $('[data-field="subject"]', root).classList.add('is-invalid');
    for (const b of current?.balises || []) {
      if (isManaged(b.nom)) continue;
      if (!valid(b, values[b.nom])) $(`[data-var-field="${CSS.escape(b.nom)}"]`, varsEl)?.classList.add('is-invalid');
    }
    for (const c of crossProblems()) $(`[data-var-field="${CSS.escape(c.nom)}"]`, varsEl)?.classList.add('is-invalid');
    if (current?.facture && !String(fvalues.f_montant || '').trim()) $('[data-f-field="montant"]', factureEl)?.classList.add('is-invalid');
    if (!reduced) gsap.fromTo('.sendbar', { x: 0 }, { keyframes: { x: [-10, 9, -6, 4, 0] }, duration: 0.5 });
    const first = $('.is-invalid .input', root);
    first?.focus({ preventScroll: true });
    first?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  }

  async function send() {
    const p = problems();
    if (p.length) {
      flagProblems();
      toast(`À compléter ou corriger : ${p.join(', ')}`, 'err');
      return;
    }
    await refresh();
    const test = getStatus().mode === 'test';
    const ok = await confirmBox(`
      <dl class="recap">
        <div><dt>À</dt><dd>${esc(toInput.value.trim())}</dd></div>
        <div><dt>Objet</dt><dd>${esc(last?.subject || '')}</dd></div>
        <div><dt>Modèle</dt><dd>${esc(current.nom)}</dd></div>
        ${current.facture ? `<div><dt>Montant</dt><dd>${esc(fvalues.f_montant || '')} €</dd></div>` : ''}
        <div><dt>De</dt><dd>${esc(last?.from || '')}</dd></div>
      </dl>
      ${current.facture ? '<p class="recap-note recap-note--info">Une facture avec un lien unique sera créée et jointe à l\'email.</p>' : ''}
      ${test ? '<p class="recap-note">Mode test : rien ne partira vraiment, l\'email sera enregistré sur le serveur.</p>' : ''}`,
    { title: current.facture ? 'Créer la facture et envoyer ?' : 'Envoyer cet email ?', ok: 'Envoyer maintenant', html: true });
    if (!ok) return;

    sendBtn.classList.add('is-loading');
    try {
      const r = await A.envoi(payload());
      celebrate();
      fx.pulse();
      toast(r.mode === 'test' ? `Mode test : email enregistré pour ${r.to} (rien n'est parti).` : `Email envoyé à ${r.to}.`);
      if (r.facture) {
        navigator.clipboard?.writeText(r.facture.url).catch(() => {});
        toast(`Facture ${r.facture.numero} créée — lien copié : ${r.facture.url}`);
      }
      toInput.value = '';
      if (!emailEdited) values.email = '';
      for (const k of Object.keys(fvalues)) delete fvalues[k]; // montant/date/… remis à zéro pour la prochaine facture
      subjectTouched = false; // l'objet revient à celui du modèle
      subjectReset.hidden = true;
      renderVars(false);
      refresh();
      onSent?.();
    } catch (e) {
      for (const k of Object.keys(e.fields || {})) {
        const el = k === 'to' || k === 'subject' ? $(`[data-field="${k}"]`, root)
          : k.startsWith('f_') ? $(`[data-f-field="${CSS.escape(k.slice(2))}"]`, factureEl)
            : $(`[data-var-field="${CSS.escape(k.replace(/^var_/, ''))}"]`, varsEl);
        el?.classList.add('is-invalid');
      }
      toast(e.message, 'err');
    } finally {
      sendBtn.classList.remove('is-loading');
    }
  }
  sendBtn.addEventListener('click', send);

  /** Avion en papier qui s'envole vers l'écran + étincelles. */
  function celebrate() {
    if (reduced) return;
    const from = sendBtn.getBoundingClientRect();
    const to = device.getBoundingClientRect();
    const cx = from.left + from.width / 2;
    const cy = from.top + from.height / 2;
    const plane = document.createElement('div');
    plane.className = 'fly';
    plane.innerHTML = ICON.plane;
    document.body.append(plane);
    gsap.set(plane, { left: cx - 17, top: cy - 17, scale: 0.6, rotation: -10 });
    const dx = (to.right - 60) - cx;
    const dy = (to.top + 40) - cy;
    gsap.timeline({ onComplete: () => plane.remove() })
      .to(plane, { scale: 1.3, duration: 0.25, ease: 'back.out(3)' })
      .to(plane, { keyframes: { x: [dx * 0.25, dx * 0.6, dx], y: [-60, dy * 0.6, dy] }, rotation: 25, duration: 1.1, ease: 'power2.inOut' })
      .to(plane, { scale: 0.2, opacity: 0, duration: 0.3, ease: 'power2.in' }, '-=0.3');
    for (let i = 0; i < 18; i++) {
      const s = document.createElement('span');
      s.className = 'spark-dot';
      document.body.append(s);
      const a = (i / 18) * Math.PI * 2;
      const d = 50 + Math.random() * 70;
      gsap.set(s, { left: cx - 3, top: cy - 3 });
      gsap.to(s, { x: Math.cos(a) * d, y: Math.sin(a) * d, opacity: 0, scale: 0.2, duration: 0.9 + Math.random() * 0.4, ease: 'expo.out', onComplete: () => s.remove() });
    }
    gsap.delayedCall(1.1, () => {
      device.classList.add('is-flash');
      gsap.delayedCall(0.7, () => device.classList.remove('is-flash'));
    });
  }

  return {
    /** Recharge la liste des modèles (et choisit slug s'il est donné). */
    async load(slug) {
      modeles = await A.modeles();
      renderPicker();
      select(slug || (modeles.some((t) => t.slug === current?.slug) ? current.slug : modeles[0]?.slug), { animate: false });
      return modeles;
    },
    select: (slug) => select(slug),
    count: () => modeles.length,
  };
}
