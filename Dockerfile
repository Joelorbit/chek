# ---- base (with pnpm) ----
FROM ghcr.io/railwayapp/nixpacks:ubuntu-1745885067 AS base
WORKDIR /app

# Avoid baking secrets into the image. Use Coolify env panel instead.
# (Remove ARG/ENV for secrets from the Dockerfile.)

# System deps you need (puppeteer/chromium libs etc.)
RUN sudo apt-get update && sudo apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgbm1 libasound2t64 \
    libpangocairo-1.0-0 libxss1 libgtk-3-0 libxshmfence1 libglu1 chromium curl wget \
    && sudo rm -rf /var/lib/apt/lists/*

COPY pnpm-lock.yaml package.json pnpm-workspace.yaml* ./
COPY prisma ./prisma

# ---- deps (install devDeps) ----
FROM base AS deps
# Force-install devDependencies regardless of NODE_ENV
RUN --mount=type=cache,target=/root/.local/share/pnpm/store/v3 \
    pnpm install --frozen-lockfile --prod=false

# ---- build ----
FROM deps AS build
COPY . .
# Generate client & compile TS
RUN pnpm prisma generate && pnpm build
# Optionally prune to prod-only for runtime
RUN pnpm prune --prod

# ---- runtime ----
FROM ghcr.io/railwayapp/nixpacks:ubuntu-1745885067 AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Same system libs as base
RUN sudo apt-get update && sudo apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgbm1 libasound2t64 \
    libpangocairo-1.0-0 libxss1 libgtk-3-0 libxshmfence1 libglu1 chromium curl wget \
    && sudo rm -rf /var/lib/apt/lists/*

# Copy only what we need to run
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma

# If you run migrations at startup:
# CMD ["sh", "-c", "pnpm prisma migrate deploy && node dist/index.js"]
CMD ["node", "dist/index.js"]
