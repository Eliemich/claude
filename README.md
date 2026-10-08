# Trading Bara Mail — interface d'envoi d'emails

Interface privée pour envoyer, à la main, des emails Trading Bara depuis l'adresse Zoho du domaine `tradingbara.uk` :
connexion (pas de création de compte), modèles `.html` avec balises `{{…}}`, aperçu en direct, historique.

| Page | Contenu |
|---|---|
| `/` | **Écran de maintenance (décor)** servi à tout le monde. Séquence secrète de clics (point rouge → bleu → noir, en haut à droite) → dissolution → `/connexion`. Clic ailleurs ou mauvais ordre → réinitialisation. Le vrai contenu n'est pas sur cette page : il est chargé seulement après la séquence. |
| `/connexion` | Connexion (email + mot de passe, double authentification en option) |
| `/envoi` → **Envoyer** | Choix du modèle, destinataire, balises à remplir, aperçu en direct (ordinateur / téléphone), envoi avec confirmation |
| `/envoi#modeles` | Bibliothèque : vignettes, import par glisser-déposer, aperçu agrandi, téléchargement, suppression, exemple commenté |
| `/envoi#historique` | 300 derniers envois (date, destinataire, objet, modèle, auteur, statut), recherche |

**Factures** (servies sur `tradingbara.uk/facture`, sans lien visible vers l'outil) :
- Un modèle d'email devient « **de type facture** » dès qu'il contient la balise `{{lien_facture}}`. À l'envoi, un encadré
  demande **montant, date, heure, lieu** (+ nom du client, description) ; le serveur **crée une facture** (id de lien non
  devinable), remplit `{{lien_facture}}` & co., puis envoie. L'id joue le rôle de clé (comme un reçu Stripe) : seul celui
  qui a le lien voit cette facture-là ; rien n'est énumérable.
- **Modèles de factures** (onglet Modèles → sélecteur **Factures**) : designs `.html` uploadés, gérés comme les emails,
  avec un modèle **par défaut (★)**. Les balises se remplissent **automatiquement** à l'affichage (pas de re-saisie) :
  `{{numero_facture}}`, `{{montant}}`, `{{date_paiement}}`, `{{heure}}`, `{{lieu}}`, `{{client_nom}}`, `{{client_email}}`,
  `{{description}}`, `{{emise_le}}`, + les balises du mail (`{{prenom}}`…). Modèle par défaut : `facture-modeles-defaut/standard.html` ;
  exemple commenté : `src/facture-modele-exemple.html`. Chaque facture **garde le design** avec lequel elle a été créée.
- Rendu **côté serveur** : `/facture` (aperçu d'exemple) et `/facture/<id>` (facture d'un client) renvoient directement
  le HTML du modèle rempli. (`GET /api/facture/<id>` renvoie aussi les données en JSON.)
- Config nginx : [`deploy/INTEGRATION-NGINX.md`](deploy/INTEGRATION-NGINX.md). Décor (`/`) : le vrai contenu n'est chargé
  qu'après la séquence, et les actions sensibles restent protégées par la connexion côté serveur.

## Lancer en local
Prérequis : [Node.js](https://nodejs.org) 20.12 ou plus récent.
```bash
cd tradingbara-mail
npm install
npm run seed-dev     # compte de démonstration local : demo@tradingbara.test / Demo-Bara-2026
npm run dev          # → http://localhost:8090
```
Sans configuration, l'interface est en **mode test** : rien ne part, chaque email est enregistré dans
`data/outbox/` (fichier `.html` à ouvrir dans le navigateur) et le badge « Mode test » est affiché en haut.
Pour envoyer pour de vrai : copier `.env.example` en `.env` et remplir la partie Zoho.

```bash
npm test             # 39 vérifications de bout en bout (base temporaire, rien n'est envoyé)
npm run create-user  # créer un vrai compte (options : --list, --password, --reset-2fa, --delete)
```

## Les modèles
Un modèle = un fichier `.html` (design libre) rangé dans `data/modeles/`. Trois modèles sont installés au premier
démarrage (dossier `modeles-defaut/`) : **Test d'envoi**, **Bienvenue — accès au canal**, **Rappel — fin d'abonnement**.

| Dans le fichier | Rôle |
|---|---|
| `<title>…</title>` | **Objet** par défaut de l'email (balises acceptées) — **modifiable à l'envoi** dans le champ « Objet de l'email » (panneau Destinataire & objet) ; un modèle sans `<title>` oblige à saisir l'objet |
| `<meta name="modele" content="…">` | Nom dans la liste |
| `<meta name="description" content="…">` | Description sous le nom |
| `{{prenom}}`, `{{date_fin}}`… | Balises : une case à remplir apparaît pour chacune (lettres, chiffres, `_`) |
| `href="{{lien_paiement}}"` | Balise dans un lien → adresse `https://` exigée |
| `{{message…}}`, `{{texte…}}` | Texte sur plusieurs lignes (retours à la ligne conservés) |
| `{{email}}`, `{{date_du_jour}}` | Remplies toutes seules (adresse du destinataire, date du jour), modifiables |
| `<img src="cid:logo">` | Logo du chat, **joint à l'email** (aucun hébergement d'image nécessaire) |

L'exemple commenté se télécharge depuis l'onglet Modèles (`src/modele-exemple.html`). Les commentaires `<!-- … -->`
sont retirés à l'envoi (sauf ceux pour Outlook `<!--[if mso]>`). Images autres que le logo : adresse `https://…`.

## Sécurité
Mots de passe hachés (argon2id), comptes créés uniquement en ligne de commande, session en cookie httpOnly
(`SameSite=Strict`, 12 h sans prolongation), jeton CSRF sur toutes les actions, limites de tentatives (connexion,
code 2FA, 60 envois par heure et par compte), double authentification TOTP (`LOGIN_2FA=on`, activée dans le modèle de
production), en-têtes stricts (CSP sans script en ligne), valeurs des balises échappées (aucun code injectable),
aperçu dans un cadre isolé sans script. En production, aucun port ouvert : tunnel Cloudflare.

## Technique
- **Serveur** : Node.js, Express 5, SQLite (better-sqlite3), Nodemailer (SMTP Zoho `smtp.zoho.eu:465`).
- **Interface** : HTML / CSS / JS sans étape de build, modules ES.
  - **Three.js** (`public/js/fx/scene.js`) : scène 3D de fond — grille en perspective, graphique en bougies sur
    l'horizon et allées de bougies, courbe de prix parcourue par une comète, poussière de données, caméra qui suit
    la souris, onde lumineuse après chaque envoi, « saut » vers l'interface après la connexion.
  - **GSAP** + SplitText (`public/js/fx/motion.js`) : titres lettre par lettre, cartes inclinées en 3D,
    halo sous le curseur, boutons magnétiques, compteurs, avion en papier à l'envoi.
  - Polices auto-hébergées : Unbounded (titres), Geist et Geist Mono.
  - Bibliothèques servies par le serveur lui-même (dossier `node_modules`, route `/vendor/`) : aucun CDN.
- `prefers-reduced-motion` respecté (scène fixe, pas d'animation) ; sans WebGL, fond en dégradé ; téléphone :
  onglets en barre fixe en bas.
- Logo : fichier d'origine `assets-src/logo-source.webp`, recalé sur les couleurs du site (teinte −12°, luminosité +20 %,
  saturation +12 %) par `npm run logo` → `public/img/logo.webp`, `favicon.png`, `apple-touch-icon.png` et
  `email-assets/logo.png` (joint aux emails). Pour changer de logo : remplacer le fichier source et relancer `npm run logo`.

## Structure
```
tradingbara-mail/
├── src/                 server.js, config.js, db.js (SQLite), security.js, users.js, totp.js,
│   │                    mailer.js (Zoho / mode test), modeles.js (lecture, balises, remplissage)
│   ├── routes/          auth.js (connexion, 2FA), mail.js (modèles, aperçu, envoi, historique, stats)
│   └── modele-exemple.html
├── views/               connexion.html, envoi.html (servies seulement selon la connexion)
├── public/              css/ (base, login, app), js/ (api, ui, login, app, views/, fx/), img/
├── modeles-defaut/      les 3 modèles installés au premier démarrage
├── email-assets/        logo.png (joint aux emails : cid:logo)
├── scripts/             create-user.js, seed-dev.js, smoke.js (npm test)
├── tools/               build-logo.mjs, pack-deploy.mjs
├── Dockerfile, docker-compose.yml (app + tunnel Cloudflare)
└── deploy/              DEPLOIEMENT.md (procédure VPS), env.production.example
```

## Mise en ligne
Docker Compose + tunnel Cloudflare dans `/opt/tradingbara-mail`, isolé du bot Telegram et de ME Recovery
(réseau et conteneurs dédiés, aucun port ouvert). Procédure complète : **[`deploy/DEPLOIEMENT.md`](deploy/DEPLOIEMENT.md)**.
