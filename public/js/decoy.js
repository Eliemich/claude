/**
 * Écran de maintenance (décor) servi sur « / ».
 *  - Séquence secrète : clic point ROUGE → clic point BLEU → clic point NOIR.
 *  - Clic ailleurs, ou mauvais ordre → la séquence se réinitialise.
 *  - Séquence réussie → disparition animée, puis navigation vers /connexion.
 * Le vrai outil n'est PAS présent sur cette page : il est chargé seulement après la
 * séquence, par la navigation. (La vraie protection reste la connexion côté serveur.)
 */
(function () {
  'use strict';

  // Habillage « page vivante » : identifiant et horodatage d'aspect réaliste.
  var ref = document.querySelector('[data-ref]');
  if (ref) ref.textContent = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).toUpperCase();
  var ts = document.querySelector('[data-ts]');
  if (ts) ts.textContent = new Date().toUTCString().replace('GMT', 'UTC');

  var SEQ = ['red', 'blue', 'black'];
  var step = 0;
  var blue = document.querySelector('[data-dot="blue"]');
  var black = document.querySelector('[data-dot="black"]');

  function reset() {
    step = 0;
    if (blue) blue.hidden = true;
    if (black) black.hidden = true;
  }

  function reveal() {
    document.body.classList.add('is-leaving');
    window.setTimeout(function () { window.location.href = '/connexion'; }, 1500);
  }

  document.addEventListener('click', function (e) {
    if (document.body.classList.contains('is-leaving')) return;
    var dot = e.target && e.target.closest ? e.target.closest('[data-dot]') : null;
    if (!dot) { reset(); return; }                 // clic ailleurs → réinitialise
    if (dot.getAttribute('data-dot') === SEQ[step]) {
      step += 1;
      if (step === 1) blue.hidden = false;
      else if (step === 2) black.hidden = false;
      else if (step === 3) reveal();
    } else {
      reset();                                     // mauvais ordre → réinitialise
    }
  });
})();
