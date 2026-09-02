# ── Stage 1: Install the root workspace graph ─────────────────────────────────
FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY backend/prisma ./backend/prisma/
RUN npm ci

# ── Stage 2: Build frontend ──────────────────────────────────────────────────
FROM dependencies AS frontend-builder
COPY frontend/ ./frontend/
RUN npm run build --workspace=frontend

# ── Stage 3: Build backend ───────────────────────────────────────────────────
FROM dependencies AS backend-builder
COPY backend/ ./backend/
RUN npm run prisma:generate --workspace=backend
RUN npm run build --workspace=backend

# ── Stage 4: Production image ────────────────────────────────────────────────
FROM node:24-alpine
RUN apk add --no-cache tini
WORKDIR /app

# Setup file storage directory owned by 'node' user
RUN mkdir -p /var/lib/zalo-crm/files /app/static && chown -R node:node /var/lib/zalo-crm/files /app

# Copy the root dependency graph and built artefacts with correct ownership.
COPY --chown=node:node --from=backend-builder /app/node_modules /app/node_modules
COPY --chown=node:node --from=backend-builder /app/backend/dist /app/dist
COPY --chown=node:node --from=backend-builder /app/backend/prisma /app/prisma
COPY --chown=node:node --from=backend-builder /app/backend/prisma.config.ts /app/prisma.config.ts
COPY --chown=node:node --from=backend-builder /app/backend/package.json /app/package.json
COPY --chown=node:node --from=frontend-builder /app/frontend/dist /app/static

USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
# A migration failure prevents the application from starting.
CMD ["sh", "-c", "npx prisma migrate deploy --config prisma.config.ts && node dist/app.js"]
