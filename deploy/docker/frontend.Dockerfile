# DF Cerebe frontend image — DEPLOY ONLY. Never used in local dev.
# Build the Svelte SPA to static files, then serve them with nginx. No Node at
# runtime — the frontend is just static assets.
# Build context is the REPO ROOT:
#   docker build -f deploy/docker/frontend.Dockerfile -t df-cerebe-frontend:local .
#
# NOTE(verify): VITE_* vars are baked in at BUILD time (Vite inlines them into
# the bundle). Pass them as build args, NOT runtime env. e.g.
#   --build-arg VITE_API_BASE_URL=https://api.df-cerebe.example
#   --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_...

# ---- build ----
FROM oven/bun:1-alpine AS build
WORKDIR /app
ARG VITE_API_BASE_URL
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
COPY package.json bun.lock* ./
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/
RUN bun install --frozen-lockfile
COPY shared/ ./shared/
COPY frontend/ ./frontend/
RUN bun run --cwd frontend build   # outputs frontend/dist

# ---- serve ----
FROM nginx:alpine AS serve
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
