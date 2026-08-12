FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── Build ────────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# better-sqlite3（Web 共有の SQLite）のネイティブビルド用。musl(alpine) 向け
# プリビルドが無い場合にソースからビルドされる — runner へは成果物だけ渡る
RUN apk add --no-cache python3 make g++

# Workspace manifests only (cache layer)
COPY tsconfig.json ./
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

# shamefully-hoist puts all packages in /app/node_modules (no symlinks)
# so TypeScript and sub-packages can find deps without pnpm's resolution
RUN pnpm install --frozen-lockfile --shamefully-hoist

# Source
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server

# Compile server — call tsc via workspace root bin to avoid pnpm symlink issues
WORKDIR /app/apps/server
RUN /app/node_modules/.bin/tsc -p tsconfig.build.json
WORKDIR /app

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
