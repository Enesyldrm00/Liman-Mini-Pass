# Development image shared by api, worker, web and migrate.
# Dependencies are installed inside the image (Linux binaries); source changes are
# synced in by `docker compose watch`, so no bind mounts are needed on Windows/macOS.
FROM node:26.12.1-alpine

RUN npm install -g pnpm@12.19.0 \
  && mkdir /repo \
  && chown node:node /repo

# Run as the unprivileged "node" user; it owns /repo so tools like Vite can write temp files.
USER node
WORKDIR /repo

# Install dependencies first so this layer is cached until a manifest changes.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=node:node apps/api/package.json apps/api/
COPY --chown=node:node apps/worker/package.json apps/worker/
COPY --chown=node:node apps/web/package.json apps/web/
COPY --chown=node:node packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .
