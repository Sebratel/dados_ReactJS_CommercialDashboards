# ---------- 1) build do front (Vite/React) ----------
FROM node:20-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- 2) dependências do servidor ----------
FROM node:20-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# ---------- 3) imagem final ----------
FROM node:20-alpine
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    PORT=8080

RUN apk add --no-cache tzdata wget && \
    addgroup -S app && adduser -S app -G app

WORKDIR /app
COPY --from=deps /app/server/node_modules ./node_modules
COPY server/package.json ./package.json
COPY server/src ./src
COPY --from=web /app/web/dist ./public

# papéis e permissões por tela (montar volume aqui para persistir)
RUN mkdir -p /app/data && chown -R app:app /app/data
ENV ACCESS_PATH=/app/data/access.json

USER app
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1

CMD ["node", "src/index.js"]
