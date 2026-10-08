# Mise en ligne — Trading Bara Mail

Procédure à dérouler **ensemble, commande par commande** (même méthode que pour ME Recovery) : chaque commande
est expliquée et n'est lancée qu'après ton accord.

## Règles (rappel)
- Le VPS héberge le **bot Telegram** (et ME Recovery) : on ne lit, ne modifie, n'arrête ni ne redémarre **rien**
  qui les concerne (fichiers, nginx, services, conteneurs).
- Tout vit dans **`/opt/tradingbara-mail`**, dans des conteneurs préfixés `tradingbara-mail-`, sur leur propre réseau.
- **Aucun port ouvert** : l'interface passe par un **tunnel Cloudflare** (le conteneur `tunnel` se connecte vers
  Cloudflare). Les ports 80 (nginx du bot) et 443 (ME Recovery) ne sont pas touchés, le pare-feu non plus.
- Les secrets (`.env`, mot de passe Zoho, jeton du tunnel) ne sont **jamais affichés** ni envoyés dans une conversation :
  on les saisit directement dans le fichier sur le serveur.
- ⚠ Commandes **interdites** sur ce VPS : `docker system prune`, `docker volume prune`, `docker image prune -a`,
  `docker rm -f $(docker ps -aq)`, `docker compose down` lancé ailleurs que dans `/opt/tradingbara-mail`,
  `rm -rf` hors de `/opt/tradingbara-mail`.

## 0. À préparer avant (toi, dans les tableaux de bord)

### Zoho Mail — l'adresse d'envoi
1. Choisir l'adresse qui enverra les emails (ex. `contact@tradingbara.uk`) : une **boîte** Zoho ou un **alias** d'une boîte.
2. Vérifier que ton offre Zoho permet l'envoi depuis une application (SMTP) : sur l'offre gratuite « Forever Free »,
   l'accès SMTP/IMAP n'est pas garanti. Test simple : **étape 1 ci-dessous, en local**. Si Zoho refuse, l'offre
   **Mail Lite** (environ 1 € / utilisateur / mois) le permet.
3. Créer un **mot de passe d'application** : https://accounts.zoho.eu → *Sécurité* → *Mots de passe d'application*
   → *Générer* (nom : « Trading Bara Mail »). Le garder pour l'étape 4, ne l'envoyer à personne.

### Cloudflare — le tunnel
1. https://one.dash.cloudflare.com → *Networks* → *Tunnels* → *Create a tunnel* → **Cloudflared**.
   (Première fois : Cloudflare demande de créer une organisation Zero Trust, offre **Free**.)
2. Nom : `tradingbara-mail`. Environnement : **Docker**. Dans la commande affichée, copier **uniquement le jeton**
   (la longue suite après `--token`) → pour l'étape 4.
3. *Public hostname* : sous-domaine **`mail`**, domaine **`tradingbara.uk`**, type **HTTP**, URL **`app:8090`**.
   Cloudflare crée lui-même l'enregistrement DNS. (Si `mail` est déjà pris, choisir un autre nom et mettre la même
   adresse dans `SITE_URL` à l'étape 4.)
4. Recommandé — **DMARC** (meilleure arrivée des emails, protège le domaine contre l'usurpation) : *DNS* → *Add record*
   → type `TXT`, nom `_dmarc`, contenu `v=DMARC1; p=none; rua=mailto:contact@tradingbara.uk`.
   (SPF et DKIM Zoho sont **déjà en place** sur tradingbara.uk.)
5. Optionnel — deuxième verrou **Cloudflare Access** : *Access* → *Applications* → *Add* → *Self-hosted*,
   domaine `mail.tradingbara.uk`, règle « Emails » avec les adresses de l'équipe : Cloudflare demande alors un code
   reçu par email **avant même** d'afficher la page de connexion.

## 1. Test de Zoho en local (sur ton PC, avant le VPS)
Dans `tradingbara-mail`, copier `.env.example` en `.env`, remplir `SMTP_HOST=smtp.zoho.eu`, `SMTP_USER`, `SMTP_PASS`,
`MAIL_FROM`, puis :
```bash
npm run dev
```
Le terminal doit afficher `SMTP smtp.zoho.eu : connexion OK`. Se connecter sur http://localhost:8090, envoyer le
modèle « Test d'envoi » à ta propre adresse (Gmail par exemple) : vérifier qu'il arrive **hors spam**, avec le logo.
Ensuite, remettre `SMTP_HOST=` vide dans le `.env` local si tu ne veux pas envoyer de vrais emails en testant.

## 2. Vérifications sur le VPS (lecture seule, ne changent rien)
```bash
docker --version && docker compose version   # Docker et Compose installés ? (déjà utilisés pour ME Recovery)
df -h /opt                                   # place disponible (il faut ~1 Go)
test -e /opt/tradingbara-mail && echo "existe déjà" || echo "libre"
```

## 3. Envoyer l'interface
Sur ton PC, dans `tradingbara-mail` :
```bash
npm run pack
scp dist/tradingbara-mail-AAAA-MM-JJ.tar.gz utilisateur@IP_DU_VPS:/tmp/
```
Sur le VPS :
```bash
sudo mkdir -p /opt/tradingbara-mail && sudo chown "$USER": /opt/tradingbara-mail
tar -xzf /tmp/tradingbara-mail-AAAA-MM-JJ.tar.gz -C /opt/tradingbara-mail
rm /tmp/tradingbara-mail-AAAA-MM-JJ.tar.gz                                  # supprime uniquement notre archive
sudo install -d -m 750 -o 1000 -g 1000 /opt/tradingbara-mail/data            # données (utilisateur du conteneur)
cd /opt/tradingbara-mail
```

## 4. Configuration (secrets saisis directement, jamais affichés)
```bash
cp deploy/env.production.example .env && chmod 600 .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n/+=')|" .env
nano .env          # tu saisis SMTP_PASS et TUNNEL_TOKEN (et tu ajustes SMTP_USER / MAIL_FROM / SITE_URL si besoin)
```

## 5. Démarrage
```bash
docker compose build                 # construit l'image (~2 min)
docker compose up -d                 # démarre l'interface + le tunnel (uniquement ceux de ce dossier)
docker compose ps                    # tradingbara-mail-app (« healthy ») et tradingbara-mail-tunnel « Up »
docker compose logs --tail 20 app    # « SMTP smtp.zoho.eu : connexion OK »
docker compose logs --tail 20 tunnel # « Registered tunnel connection »
```

## 6. Comptes de l'équipe (aucune création de compte sur le site)
```bash
docker compose exec app node scripts/create-user.js
```
Email, nom affiché, mot de passe (10 caractères minimum, majuscule, minuscule, chiffre). Puis connexion sur
https://mail.tradingbara.uk : avec `LOGIN_2FA=on`, un QR code s'affiche à la première connexion, à scanner avec
Google Authenticator (ou Authy…).

## 7. Vérification finale
Envoyer « Test d'envoi » à ta propre adresse depuis https://mail.tradingbara.uk : reçu, hors spam, logo visible,
noté dans l'onglet Historique avec le statut « Envoyé ».

---

## Au quotidien
| Besoin | Commande (dans `/opt/tradingbara-mail`) |
|---|---|
| Voir l'état | `docker compose ps` |
| Journaux | `docker compose logs --tail 100 app` |
| Redémarrer | `docker compose restart app` |
| Ajouter un compte | `docker compose exec app node scripts/create-user.js` |
| Lister les comptes | `docker compose exec app node scripts/create-user.js --list` |
| Changer un mot de passe | `docker compose exec app node scripts/create-user.js --password email@…` |
| Téléphone perdu (2FA) | `docker compose exec app node scripts/create-user.js --reset-2fa email@…` |
| Supprimer un compte | `docker compose exec app node scripts/create-user.js --delete email@…` |

**Mettre à jour l'interface** : sur le PC `npm run pack` puis `scp` comme à l'étape 3 ; sur le VPS
`tar -xzf /tmp/tradingbara-mail-….tar.gz -C /opt/tradingbara-mail` (ne touche ni `.env` ni `data/`), puis
`docker compose up -d --build app`.

**Modèles** : ils sont dans `/opt/tradingbara-mail/data/modeles/` (un fichier `.html` par modèle). Le plus simple est de
les gérer depuis l'onglet *Modèles* de l'interface. Penser à garder une copie des fichiers sur le PC.

**Sauvegarde** (depuis le PC, de temps en temps) :
```bash
scp -r "utilisateur@IP_DU_VPS:/opt/tradingbara-mail/data/modeles" "C:\Sauvegardes Trading Bara\"
```
