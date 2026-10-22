/** Onglet « Historique » : 300 derniers envois, recherche instantanée, sélection et suppression de lignes. */
import { A } from '../api.js';
import { $, $$, esc, debounce, fdatetime, toast, confirmBox, ICON } from '../ui.js';
import { gsap, reduced } from '../fx/motion.js';

const STATUT = {
  envoye: '<span class="chip chip--ok">Envoyé</span>',
  test: '<span class="chip chip--warn" title="Mode test : rien n\'est parti, l\'email est enregistré sur le serveur">Mode test</span>',
  echec: '<span class="chip chip--err">Échec</span>',
};

/** Raccourcis de sélection (appliqués aux lignes affichées, donc après la recherche). */
const PICK = {
  tout: () => true,
  echec: (r) => r.statut === 'echec',
  test: (r) => r.statut === 'test',
  ancien: (r) => Date.now() - new Date(r.date) > 30 * 864e5,
};

export function createHistory(root) {
  const table = $('[data-history]', root);
  const search = $('[data-search]', root);
  const bar = $('[data-hbar]', root);
  const delBtn = $('[data-hdel]', root);
  const countEl = $('[data-hcount]', root);
  let rows = [];
  const selected = new Set();

  const visible = () => {
    const q = search.value.trim().toLowerCase();
    return q ? rows.filter((r) => `${r.destinataire} ${r.objet} ${r.modele} ${r.par}`.toLowerCase().includes(q)) : rows;
  };

  function syncBar() {
    const n = selected.size;
    countEl.textContent = n ? `${n} ligne${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''}` : 'Aucune ligne sélectionnée';
    delBtn.disabled = !n;
    bar.hidden = !rows.length;
    const all = $('[data-hall]', table);
    if (all) {
      const shown = visible();
      const on = shown.filter((r) => selected.has(r.id)).length;
      all.checked = on > 0 && on === shown.length;
      all.indeterminate = on > 0 && on < shown.length;
    }
  }

  function render(animate = false) {
    const q = search.value.trim();
    const shown = visible();
    if (!shown.length) {
      table.innerHTML = `<tbody><tr><td><div class="empty"><img src="/img/logo.webp" alt="">
        <strong>${q ? 'Aucun résultat' : 'Aucun envoi pour l\'instant'}</strong>${q ? 'Essaie une autre recherche.' : 'Les emails envoyés apparaîtront ici.'}</div></td></tr></tbody>`;
      syncBar();
      return;
    }
    table.innerHTML = `<thead><tr><th class="pick"><input type="checkbox" data-hall aria-label="Sélectionner toutes les lignes affichées"></th>
        <th>Date</th><th>Destinataire</th><th>Objet</th><th>Par</th><th>Statut</th></tr></thead>
      <tbody>${shown.map((r) => `<tr class="${selected.has(r.id) ? 'is-picked' : ''}">
        <td class="pick"><input type="checkbox" data-hid="${r.id}" ${selected.has(r.id) ? 'checked' : ''} aria-label="Sélectionner l'envoi à ${esc(r.destinataire)}"></td>
        <td class="date">${esc(fdatetime(r.date))}</td>
        <td class="to">${esc(r.destinataire)}</td>
        <td class="subject">${esc(r.objet)}<span class="sub">${esc(r.modele)}</span></td>
        <td>${esc(r.par)}</td>
        <td>${STATUT[r.statut] || esc(r.statut)}${r.erreur ? `<span class="err">${esc(r.erreur)}</span>` : ''}</td>
      </tr>`).join('')}</tbody>`;
    syncBar();
    if (animate && !reduced) gsap.from(table.querySelectorAll('tbody tr'), { opacity: 0, x: -16, duration: 0.6, stagger: 0.025, ease: 'expo.out', clearProps: 'all' });
  }

  table.addEventListener('change', (e) => {
    const cb = e.target;
    if (cb.matches('[data-hall]')) {
      visible().forEach((r) => (cb.checked ? selected.add(r.id) : selected.delete(r.id)));
      render(false);
    } else if (cb.matches('[data-hid]')) {
      const id = Number(cb.dataset.hid);
      if (cb.checked) selected.add(id); else selected.delete(id);
      cb.closest('tr').classList.toggle('is-picked', cb.checked);
      syncBar();
    }
  });

  $$('[data-hpick]', root).forEach((b) => b.addEventListener('click', () => {
    selected.clear();
    const test = PICK[b.dataset.hpick];
    if (test) visible().filter(test).forEach((r) => selected.add(r.id));
    render(false);
    if (test && !selected.size) toast('Aucune ligne ne correspond.');
  }));

  delBtn.innerHTML = `${ICON.trash}<span>Supprimer</span>`;
  delBtn.addEventListener('click', async () => {
    const ids = [...selected];
    if (!ids.length) return;
    const n = ids.length;
    const ok = await confirmBox(`<p style="margin:0 0 10px;color:var(--ink-2)">Supprimer définitivement <strong>${n} ligne${n > 1 ? 's' : ''}</strong> de l'historique ?</p>
      <p style="margin:0;color:var(--muted);font-size:.88rem">Les emails déjà envoyés et les factures (et leurs liens) ne sont pas touchés. Les compteurs (aujourd'hui, 7 jours, total) baisseront d'autant.</p>`,
    { title: 'Supprimer de l\'historique', ok: 'Supprimer', danger: true, html: true });
    if (!ok) return;
    delBtn.classList.add('is-loading');
    try {
      const { supprimes } = await A.deleteHistorique(ids);
      selected.clear();
      rows = await A.historique();
      render(false);
      toast(`${supprimes} ligne${supprimes > 1 ? 's' : ''} supprimée${supprimes > 1 ? 's' : ''} de l'historique.`);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      delBtn.classList.remove('is-loading');
    }
  });

  search.addEventListener('input', debounce(() => render(false), 120));

  return {
    async load() {
      rows = await A.historique();
      const ids = new Set(rows.map((r) => r.id));
      [...selected].forEach((id) => { if (!ids.has(id)) selected.delete(id); });
      render(true);
    },
  };
}
