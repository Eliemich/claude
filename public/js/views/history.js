/** Onglet « Historique » : 300 derniers envois, recherche instantanée. */
import { A } from '../api.js';
import { $, esc, debounce, fdatetime } from '../ui.js';
import { gsap, reduced } from '../fx/motion.js';

const STATUT = {
  envoye: '<span class="chip chip--ok">Envoyé</span>',
  test: '<span class="chip chip--warn" title="Mode test : rien n\'est parti, l\'email est enregistré sur le serveur">Mode test</span>',
  echec: '<span class="chip chip--err">Échec</span>',
};

export function createHistory(root) {
  const table = $('[data-history]', root);
  const search = $('[data-search]', root);
  let rows = [];

  function render(animate = false) {
    const q = search.value.trim().toLowerCase();
    const shown = q ? rows.filter((r) => `${r.destinataire} ${r.objet} ${r.modele} ${r.par}`.toLowerCase().includes(q)) : rows;
    if (!shown.length) {
      table.innerHTML = `<tbody><tr><td><div class="empty"><img src="/img/logo.webp" alt="">
        <strong>${q ? 'Aucun résultat' : 'Aucun envoi pour l\'instant'}</strong>${q ? 'Essaie une autre recherche.' : 'Les emails envoyés apparaîtront ici.'}</div></td></tr></tbody>`;
      return;
    }
    table.innerHTML = `<thead><tr><th>Date</th><th>Destinataire</th><th>Objet</th><th>Par</th><th>Statut</th></tr></thead>
      <tbody>${shown.map((r) => `<tr>
        <td class="date">${esc(fdatetime(r.date))}</td>
        <td class="to">${esc(r.destinataire)}</td>
        <td class="subject">${esc(r.objet)}<span class="sub">${esc(r.modele)}</span></td>
        <td>${esc(r.par)}</td>
        <td>${STATUT[r.statut] || esc(r.statut)}${r.erreur ? `<span class="err">${esc(r.erreur)}</span>` : ''}</td>
      </tr>`).join('')}</tbody>`;
    if (animate && !reduced) gsap.from(table.querySelectorAll('tbody tr'), { opacity: 0, x: -16, duration: 0.6, stagger: 0.025, ease: 'expo.out', clearProps: 'all' });
  }

  search.addEventListener('input', debounce(() => render(false), 120));

  return {
    async load() {
      rows = await A.historique();
      render(true);
    },
  };
}
