/**
 * Libellés affichés au-dessus des cases de l'onglet « Envoyer » : { nom_de_balise: 'Libellé affiché' }.
 *  - purement visuel : le nom technique de la balise (celui écrit dans le modèle) ne change pas ;
 *  - la clé est le nom SANS le préfixe de type : {{date:date_recup}} → clé « date_recup » ;
 *  - une balise absente de ce dictionnaire affiche son nom, « _ » remplacés par des espaces
 *    (« lieu_livraison » → « Lieu livraison »).
 * Ajoutez ici une ligne par balise de vos modèles.
 */
export const LABELS = {
  prenom: 'Prénom',
  nom: 'Nom',
  email: 'Email',
  date_du_jour: 'Date du jour',
  date_fin: 'Date de fin',
  coursier: 'Coursier',
  numero_commande: 'N° de commande',
  date_recup: 'Date de récupération',
  heure_debut: 'Heure de début',
  heure_fin: 'Heure de fin',
  lieu_recup: 'Lieu de récupération',
  lieu_livraison: 'Lieu de livraison',
  code_postal: 'Code postal',
  ville: 'Ville',
  lien_paiement: 'Lien de paiement',
  lien_telegram: 'Lien Telegram',
};

/** Libellé d'une balise : dictionnaire, sinon le nom avec les « _ » remplacés par des espaces. */
export const labelOf = (nom) => LABELS[nom] || nom.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
