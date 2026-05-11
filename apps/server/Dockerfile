FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── Build ────────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Workspace manifests only (cache layer)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

RUN pnpm install --frozen-lockfile

# Source
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server

# Compile server (paths alias resolves shared/src directly)
RUN pnpm --filter server build

# Create a pruned production-only deployment folder
RUN pnpm --filter server --prod deploy /deploy

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /deploy/node_modules ./node_modules
COPY --from=builder /deploy/package.json ./
COPY --from=builder /app/apps/server/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
