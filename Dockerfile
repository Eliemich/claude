# ============================================================
#  TRADING BARA MAIL — image Docker (serveur Node + interface)
#  Construite et lancée par docker-compose.yml (voir deploy/DEPLOIEMENT.md).
#  Les données (base SQLite, modèles, emails de test) vivent dans le volume /app/data.
# ============================================================

# --- Dépendances (modules natifs argon2 / better-sqlite3 compilés pour Linux) ---
FROM node:24-bookworm-slim AS deps
# Outils de compilation : seulement pour cette étape, l'image finale ne les contient pas
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# --- Image finale ---
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=8090 \
    DATA_DIR=/app/data \
    TRUST_PROXY=1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY views ./views
COPY public ./public
COPY modeles-defaut ./modeles-defaut
COPY facture-modeles-defaut ./facture-modeles-defaut
COPY email-assets ./email-assets
# Le serveur tourne avec l'utilisateur non privilégié « node » (jamais root)
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8090/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
