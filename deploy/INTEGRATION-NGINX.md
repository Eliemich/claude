# Intégration sur le VPS (nginx existant + tunnel Cloudflare déjà en place)

Contexte réel : nginx écoute sur le port 80 et sert `tradingbara.uk` ; un tunnel Cloudflare (cloudflared,
systemd) pointe déjà vers ce nginx ; le bot Telegram tourne à côté (gunicorn sur le port 5005). **On ne touche
ni au tunnel, ni au bot, ni au port 5005.** On ajoute seulement deux choses dans nginx :

1. l'outil de mails (app Node) est servi par nginx en proxy sur le port **8090** (local) ;
2. la page `/facture` est servie en fichiers statiques.

⚠️ **Avant tout** : change le mot de passe d'application Zoho (il a été exposé en clair). Mets le nouveau dans
le `.env` du serveur, nulle part ailleurs.

---

## 1. Faire tourner l'app de mails sur 127.0.0.1:8090

L'app ne doit PAS ouvrir son propre tunnel (le tien existe déjà). Deux options :

- **Docker** : dans `docker-compose.yml`, ne lance que le service `app` et publie-le sur localhost uniquement.
  Ajoute sous `app:` :
  ```yaml
      ports:
        - "127.0.0.1:8090:8090"
  ```
  puis `docker compose up -d app` (ne démarre pas le service `tunnel`).

- **Sans Docker** : `node src/server.js` avec `PORT=8090` (via un service systemd à toi).

Vérifie en local sur le VPS : `curl -I http://127.0.0.1:8090/` doit répondre `200` (la page de maintenance),
et `curl -I http://127.0.0.1:8090/facture` doit répondre `200` (la page facture, servie par l'appli).

## 2. (plus de dépôt séparé pour /facture)

La page `/facture` est maintenant **servie par l'appli** (elle a besoin des données vivantes : chaque facture
est créée à l'envoi et lue via son lien unique `/facture/<id>`). Rien à déposer dans `/var/www` : le `location /`
ci-dessous l'envoie à l'appli, comme le reste.

## 3. nginx — fichier complet (constaté sur ton serveur)

Le site `tradingbara.uk` est servi par **`/etc/nginx/sites-enabled/telegram-webhook`**. État actuel :
deux `location` pour le bot (port 5005), et **aucun `location /`** (c'est pour ça que `/` ne montre rien).
Port **8090 libre** ; ME Recovery (Caddy, port 443) n'est pas concerné.

Fichier final (les blocs BOT sont **identiques** à l'existant, on n'ajoute que l'APP) :

```nginx
server {
    listen 80;
    server_name tradingbara.uk;

    # --- BOT (inchangé) ---
    location /webhook/nowpayments {
        proxy_pass http://127.0.0.1:5005;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location /admin/dashboard {
        proxy_pass http://127.0.0.1:5005;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # --- NOUVEAU : tout le reste → l'appli (décor sur /, connexion, envoi, /facture et /facture/<id>) ---
    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        # Cloudflare met déjà X-Forwarded-Proto=https ; on le transmet tel quel
        # (sinon les cookies « secure » de session ne seraient pas posés).
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    }
}
```

Édition : `sudo nano /etc/nginx/sites-enabled/telegram-webhook`
(garde une copie d'abord : `sudo cp /etc/nginx/sites-enabled/telegram-webhook ~/telegram-webhook.bak`).
Puis, toujours sur le VPS :
```bash
sudo nginx -t          # DOIT afficher "syntax is ok" et "test is successful"
sudo systemctl reload nginx
```
Si `nginx -t` échoue, ne recharge pas : corrige d'abord (ou envoie-moi le message d'erreur).

## 4. Vérifier

- `https://tradingbara.uk` → page de maintenance 503. Séquence : point rouge (haut droite) → point bleu →
  point noir → l'écran se dissout et la connexion apparaît.
- `https://tradingbara.uk/facture` → la facture d'exemple.
- `https://tradingbara.uk/facture?id=TEST123` → la même page avec « N° TEST123 ».
- Le bot Telegram continue de tourner (`systemctl status telegram-bot telegram-webhook`), non touché.

## Rappels
- `app.set('trust proxy', …)` est déjà géré par la variable `TRUST_PROXY=1` (derrière nginx) — garde-la dans le `.env`.
- `SITE_URL=https://tradingbara.uk` dans le `.env`, et les cookies passent en `secure` automatiquement en production.
- Aucun `robots.txt` ni sitemap n'est ajouté ; les deux pages portent `noindex, nofollow`.
