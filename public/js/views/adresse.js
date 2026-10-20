/**
 * Champs {{adresse:…}} : suggestions d'adresses françaises (API Base Adresse Nationale, gratuite, sans clé).
 *  - recherche après 3 caractères, 300 ms après la dernière frappe ; une recherche dépassée est annulée ;
 *  - 5 suggestions sous le champ, au clic ou au clavier (↑ ↓ Entrée, Échap pour fermer) ;
 *  - au choix : le champ reçoit l'adresse complète, et onPick reçoit aussi le code postal et la ville
 *    (pour remplir d'éventuelles balises {{code_postal}} et {{ville}}).
 * Les champs sont recréés à chaque changement de modèle : tout passe par des écouteurs posés sur le conteneur.
 * Si l'API ne répond plus, l'adresse se tape simplement à la main.
 */
import { $, $$, esc, debounce } from '../ui.js';

// Ancienne adresse de l'API. Son nouvel hébergement (même format de réponse) : https://data.geopf.fr/geocodage/search
export const BAN_URL = 'https://api-adresse.data.gouv.fr/search/';
const MIN_CHARS = 3;
const DELAY_MS = 300;
const LIMIT = 5;

/**
 * container : élément qui contient les champs ; chaque champ adresse est rendu par adresseField().
 * onPick(nom, { label, postcode, city }) : appelé quand une suggestion est choisie.
 */
export function attachAdresse(container, { onPick }) {
  const state = new WeakMap(); // input → { items, active, ctrl }
  const st = (input) => { if (!state.has(input)) state.set(input, { items: [], active: -1, ctrl: null }); return state.get(input); };
  const listOf = (input) => $(`#${CSS.escape(input.getAttribute('aria-controls'))}`, container);

  function close(input) {
    const s = st(input);
    s.items = [];
    s.active = -1;
    const list = listOf(input);
    if (list) { list.hidden = true; list.innerHTML = ''; }
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function render(input) {
    const s = st(input);
    const list = listOf(input);
    if (!list) return;
    if (!s.items.length) { close(input); return; }
    list.innerHTML = s.items.map((f, i) => `
      <li role="option" id="${list.id}-${i}" data-i="${i}" class="addr__opt${i === s.active ? ' is-active' : ''}" aria-selected="${i === s.active}">
        <span class="addr__main">${esc(f.properties.name || f.properties.label)}</span>
        <span class="addr__sub">${esc([f.properties.postcode, f.properties.city].filter(Boolean).join(' '))}</span>
      </li>`).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (s.active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${s.active}`);
    else input.removeAttribute('aria-activedescendant');
  }

  async function search(input) {
    const q = input.value.trim();
    const s = st(input);
    s.ctrl?.abort(); // une frappe plus récente remplace la recherche en cours
    if (q.length < MIN_CHARS) { close(input); return; }
    s.ctrl = new AbortController();
    try {
      const res = await fetch(`${BAN_URL}?q=${encodeURIComponent(q)}&limit=${LIMIT}`, { signal: s.ctrl.signal });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (input.value.trim() !== q || document.activeElement !== input) return; // réponse arrivée trop tard
      s.items = (data.features || []).filter((f) => f?.properties?.label);
      s.active = -1;
      render(input);
    } catch (e) {
      if (e.name !== 'AbortError') close(input); // API injoignable : saisie libre
    }
  }

  function pick(input, i) {
    const f = st(input).items[i];
    if (!f) return;
    const { label, postcode = '', city = '' } = f.properties;
    input.value = label;
    close(input);
    onPick(input.dataset.var, { label, postcode, city });
  }

  // Un délai de 300 ms par champ (deux champs adresse ne se gênent pas)
  const timers = new WeakMap();
  const searchSoon = (input) => {
    if (!timers.has(input)) timers.set(input, debounce(() => search(input), DELAY_MS));
    timers.get(input)();
  };

  container.addEventListener('input', (e) => {
    if (e.target.matches('[data-addr-input]')) searchSoon(e.target);
  });

  container.addEventListener('keydown', (e) => {
    const input = e.target;
    if (!input.matches('[data-addr-input]')) return;
    const s = st(input);
    if (!s.items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = s.items.length;
      s.active = e.key === 'ArrowDown' ? (s.active + 1) % n : (s.active - 1 + n) % n;
      render(input);
    } else if (e.key === 'Enter' && s.active >= 0) {
      e.preventDefault();
      pick(input, s.active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(input);
    }
  });

  // pointerdown (avant la perte du focus du champ) : la liste ne se ferme pas avant le clic
  container.addEventListener('pointerdown', (e) => {
    const opt = e.target.closest('.addr__opt');
    if (!opt) return;
    e.preventDefault();
    const input = $('[data-addr-input]', opt.closest('[data-addr]'));
    pick(input, Number(opt.dataset.i));
  });

  container.addEventListener('focusout', (e) => {
    if (e.target.matches('[data-addr-input]')) close(e.target);
  });

  return { closeAll: () => $$('[data-addr-input]', container).forEach(close) };
}

/** HTML d'un champ adresse (attrs : id, data-var, placeholder… déjà échappés). */
export function adresseField(nom, attrs, value) {
  const listId = `addr-${nom}`;
  return `<div class="addr" data-addr>
      <input class="input" type="text" ${attrs} value="${esc(value)}" data-addr-input autocomplete="off" spellcheck="false"
        role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${esc(listId)}">
      <ul class="addr__list" id="${esc(listId)}" role="listbox" hidden></ul>
    </div>`;
}
