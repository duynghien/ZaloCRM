# Every install uses the canonical workspace lockfile.
FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY backend/prisma ./backend/prisma/
COPY backend/prisma.config.ts ./backend/prisma.config.ts
RUN npm ci

FROM dependencies AS frontend-builder
COPY frontend/ ./frontend/
RUN npm run build --workspace=frontend

FROM dependencies AS backend-builder
COPY backend/ ./backend/
RUN npm run build --workspace=backend

# Copy only the installed local Prisma CLI dependency closure for migration.
FROM dependencies AS migration-dependencies
RUN node --input-type=module <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const seen = new Set();
const inventory = [];
function collect(directory) {
  if (seen.has(directory)) return;
  seen.add(directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
  inventory.push({ name: manifest.name, version: manifest.version, path: path.relative('/app', directory) });
  fs.cpSync(directory, path.join('/migration', path.relative('/app', directory)), { recursive: true, filter: source => source === directory || path.basename(source) !== 'node_modules' });
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
    let ancestor = directory;
    let resolved;
    while (ancestor !== '/') {
      const candidate = path.join(ancestor, 'node_modules', name);
      if (fs.existsSync(path.join(candidate, 'package.json'))) { resolved = candidate; break; }
      ancestor = path.dirname(ancestor);
    }
    if (resolved) collect(resolved);
    else if (!manifest.optionalDependencies?.[name]) throw new Error(`Missing migration dependency ${name}`);
  }
}
collect('/app/node_modules/prisma');
fs.writeFileSync('/migration/inventory.json', JSON.stringify(inventory, null, 2));
JS

FROM node:24-alpine AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
# Optional Prisma CLI peers pull in a build toolchain. They are not required by
# the generated client. Generation already ran in dependencies; runtime install
# deliberately skips root prepare, which requires that absent CLI.
RUN npm ci --workspace=backend --omit=dev --omit=peer --ignore-scripts && mkdir -p backend/node_modules
RUN node --input-type=module <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const seen = new Set();
const inventory = [];
function collect(directory) {
  if (seen.has(directory)) return;
  seen.add(directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
  inventory.push({ name: manifest.name, version: manifest.version, path: path.relative('/app', directory) });
  fs.cpSync(directory, path.join('/runtime', path.relative('/app', directory)), { recursive: true, filter: source => source === directory || path.basename(source) !== 'node_modules' });
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
    let ancestor = directory;
    let resolved;
    while (ancestor !== '/') {
      const candidate = path.join(ancestor, 'node_modules', name);
      if (fs.existsSync(path.join(candidate, 'package.json'))) { resolved = candidate; break; }
      ancestor = path.dirname(ancestor);
    }
    if (resolved) collect(resolved);
    else if (!manifest.optionalDependencies?.[name]) throw new Error(`Missing runtime dependency ${name}`);
  }
}
const backend = JSON.parse(fs.readFileSync('/app/backend/package.json'));
for (const name of Object.keys(backend.dependencies)) {
  const local = path.join('/app/backend/node_modules', name);
  collect(fs.existsSync(path.join(local, 'package.json')) ? local : path.join('/app/node_modules', name));
}
fs.mkdirSync('/runtime/backend/node_modules', { recursive: true });
fs.writeFileSync('/runtime/inventory.json', JSON.stringify(inventory, null, 2));
JS
COPY --from=dependencies /app/node_modules/.prisma /runtime/node_modules/.prisma

FROM node:24-alpine AS base
RUN apk add --no-cache tini tzdata
ENV TZ=Asia/Ho_Chi_Minh
WORKDIR /app
RUN mkdir -p /var/lib/zalo-crm/files /app/static && chown -R node:node /var/lib/zalo-crm/files /app
ENTRYPOINT ["/sbin/tini", "--"]

# The migration job uses the local locked CLI; startup never invokes npx.
FROM base AS migrator
COPY --chown=node:node --from=migration-dependencies /migration/node_modules ./node_modules
COPY --chown=node:node --from=migration-dependencies /migration/inventory.json ./migrator-dependencies.json
COPY --chown=node:node --from=dependencies /app/backend/package.json ./backend/package.json
COPY --chown=node:node backend/prisma ./backend/prisma
COPY --chown=node:node backend/prisma.config.ts ./backend/prisma.config.ts
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "backend/prisma.config.ts"]

FROM base AS runtime
ENV NODE_ENV=production
COPY --chown=node:node --from=production-dependencies /runtime/inventory.json ./runtime-dependencies.json
COPY --chown=node:node --from=production-dependencies /runtime/node_modules ./node_modules
COPY --chown=node:node --from=production-dependencies /runtime/backend/node_modules ./backend/node_modules
COPY --chown=node:node --from=backend-builder /app/backend/dist ./backend/dist
COPY --chown=node:node --from=backend-builder /app/backend/package.json ./backend/package.json
COPY --chown=node:node --from=backend-builder /app/backend/prisma/migrations ./backend/prisma/migrations
COPY --chown=node:node --from=backend-builder /app/backend/assets ./backend/assets
COPY --chown=node:node --from=frontend-builder /app/frontend/dist ./backend/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/dist/app.js"]
