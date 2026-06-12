# `deploy/` — the container + Kubernetes parcel (DEPLOY ONLY)

> **You do not need anything in this folder to develop DF Cerebe.**
> Local dev is native Bun — see the root [`README.md`](../README.md) and
> [`docs/getting-started.md`](../docs/getting-started.md). This folder is a
> self-contained, opt-in deployment path. Deleting it would not affect dev.

This is the deliberate separation you asked for: **dev never touches Docker or
k8s; deployment is a fully-working, isolated step you graduate into when you're
ready to ship.**

## What's here

```
deploy/
├── docker/
│   ├── backend.Dockerfile     # Bun runtime image for the Hono+LangGraph backend
│   ├── frontend.Dockerfile    # builds the Svelte SPA → static files → nginx
│   └── nginx.conf             # SPA-fallback config for the static frontend
└── k8s/
    └── base/                  # kustomize base: Deployments, Services, Ingress
```

(The optional Dark Factory docker-build evidence shim lives at
[`../scripts/check-dockerfile.sh`](../scripts/check-dockerfile.sh) — see below.)

## The graduation path (when you're ready to deploy — not before)

All commands run from the **repo root** (the Docker build context needs the
workspace + `shared/`).

### 1. Prereqs (only now do you need these)

- Docker
- `kubectl` + a cluster (managed: GKE/EKS/AKS; or local k3d/kind/minikube for a dry run)
- A container registry you can push to

### 2. Build the images

```bash
bun run docker:build:backend     # → df-cerebe-backend:local
bun run docker:build:frontend \  # → df-cerebe-frontend:local
  --build-arg VITE_API_BASE_URL=https://api.df-cerebe.example \
  --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
```

> ⚠️ **NOTE(verify):** `VITE_*` vars are inlined into the frontend bundle at
> **build** time, not runtime. Pass them as `--build-arg` here. Getting this
> wrong means the SPA points at the wrong API origin.

### 3. Push to your registry, then point the manifests at the pushed tags

Edit `k8s/base/kustomization.yaml` → `images:` `newTag` (and add a registry
prefix to the names). This is the one spot that maps local image names to your
real registry.

### 4. Create the secret (NEVER commit it)

```bash
kubectl create namespace df-cerebe
kubectl create secret generic df-cerebe-secrets -n df-cerebe \
  --from-literal=CEREBE_API_KEY=... \
  --from-literal=CLERK_SECRET_KEY=...
```

Or, to keep Doppler as the single source of truth in prod too, install the
**Doppler Kubernetes operator** and let it sync `df-cerebe-secrets`. (docs/notes.md)

### 5. Apply

```bash
bun run k8s:apply        # = kubectl apply -k deploy/k8s/base
kubectl get pods -n df-cerebe -w
```

### 6. Point DNS / Ingress

Set the real `host:` in `k8s/base/ingress.yaml` and adjust the controller-specific
annotations for your cluster.

## Dark Factory + Dockerfiles (optional)

The Dark Factory critics can't run `docker build` (no Docker socket in their
sandbox), so commits that touch these Dockerfiles get a `requiresHumanJudgment`
finding by default — harmless, since you review this folder deliberately.

If you want clean critic signal on Dockerfile changes, wire the evidence shim at
[`../scripts/check-dockerfile.sh`](../scripts/check-dockerfile.sh) into
`.husky/pre-push`. It's a skeleton for now; see the contract in that file and in
`CONSUMER-ADOPTION.md §5.5`. **Not required to deploy.**

## Why kustomize, not Helm

Lighter, no templating language to learn, manifests read as plain YAML. If your
target cluster's tooling expects Helm, converting `k8s/base/` to a chart is
mechanical — tracked as a decision in [`../docs/notes.md`](../docs/notes.md).
