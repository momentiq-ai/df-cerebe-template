# DF Cerebe backend image — DEPLOY ONLY. Never used in local dev.
# Multi-stage: install on the Bun image, then a slim runtime layer.
# Build context is the REPO ROOT (so the workspace + shared/ are available):
#   docker build -f deploy/docker/backend.Dockerfile -t df-cerebe-backend:local .
#
# NOTE(verify): pin a concrete Bun tag (e.g. oven/bun:1.1.34-alpine) before prod
# rather than a floating major — reproducible images. docs/notes.md.

# ---- deps ----
FROM oven/bun:1-alpine AS deps
WORKDIR /app
# Copy only manifests first for layer-cache friendliness.
COPY package.json bun.lock* ./
COPY backend/package.json ./backend/
COPY shared/package.json ./shared/
# --frozen-lockfile = fail if lockfile is stale (reproducible). TODO: ensure the
# lockfile is committed (see .gitignore note) for this to work.
RUN bun install --frozen-lockfile

# ---- runtime ----
FROM oven/bun:1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock* ./
COPY shared/ ./shared/
COPY backend/ ./backend/
EXPOSE 8787
# Secrets (CEREBE_API_KEY, CLERK_SECRET_KEY, …) are injected by the runtime
# (k8s Secret / Doppler), NOT baked into the image.
CMD ["bun", "backend/src/index.ts"]
