# Multi-stage build for the GRVT Grid bot.
#
# Stage 1 (bot-builder): build the bot TypeScript + compile sqlite3 native
# bindings against a glibc base.
# Stage 2 (dashboard-builder): build the React SPA into static assets.
# Stage 3 (runtime): slim runtime image. Copies the bot dist + node_modules
# from stage 1 and the dashboard dist from stage 2, drops everything else.
# Runs as non-root grvtbot (fixed UID 10000) for predictable bind-mount
# ownership on the host.

# ── Stage 1: bot builder ──────────────────────────────────────────────────
FROM node:22-slim AS bot-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Install only the bot package's deps. Copying package.json + lockfile first
# means npm install gets cached on every rebuild that doesn't change deps.
COPY package.json package-lock.json ./
COPY packages/bot/package.json packages/bot/
COPY packages/bot/tsconfig.json packages/bot/

RUN npm ci --workspace=@grvt-grid/bot --include-workspace-root

# Now copy the source and build
COPY packages/bot/src packages/bot/src
COPY packages/bot/tests packages/bot/tests
RUN npm run build --workspace=@grvt-grid/bot

# ── Stage 2: dashboard builder ────────────────────────────────────────────
# Builds the SPA into /build/packages/dashboard/dist. The dashboard uses
# Vite which bakes VITE_* env vars into the bundle at build time, so we
# expose them as ARGs that the host can pass via --build-arg.
FROM node:22-slim AS dashboard-builder

WORKDIR /build

ARG VITE_BASE_PATH=/dashboard/
ARG VITE_API_BASE_URL=
ARG VITE_DASHBOARD_API_KEY=

ENV VITE_BASE_PATH=${VITE_BASE_PATH} \
    VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_DASHBOARD_API_KEY=${VITE_DASHBOARD_API_KEY}

COPY package.json package-lock.json ./
COPY packages/dashboard/package.json packages/dashboard/

RUN npm ci --workspace=@grvt-grid/dashboard --include-workspace-root

COPY packages/dashboard packages/dashboard
RUN npm run build --workspace=@grvt-grid/dashboard

# ── Stage 3: runtime ──────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# Runtime deps — sqlite3 se recompila aquí al primer inicio si el binary
# pré-compilado no es compatible con el glibc del container.
# Los build-tools permiten a node-gyp recompilar native addons in situ.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    ca-certificates \
    tini \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Non-root user with a fixed UID so bind-mounted data/ has predictable owner
# Create data/logs as root with 1777 so any UID can write.
    # The grvtbot user (UID 10000) gets write access via sticky bit.
    # We mkdir explicitly here so the runtime USER section can chown
    # to grvtbot — otherwise an existing empty dir stays root-owned
    # and the recursive mkdir in db.ts does NOT fix perms.
    RUN mkdir -p /app/data /app/logs && chmod 1777 /app/data /app/logs && \
        chown -R grvtbot:grvtbot /app/data /app/logs || true
RUN groupadd -g 10000 grvtbot && \
    useradd -u 10000 -g grvtbot -m -s /usr/sbin/nologin grvtbot

WORKDIR /app

# Copy compiled output + production node_modules from bot-builder.
# npm workspaces hoists everything to the root node_modules (no nested
# packages/bot/node_modules), so a single copy is enough.
COPY --from=bot-builder --chown=grvtbot:grvtbot /build/packages/bot/dist ./dist
COPY --from=bot-builder --chown=grvtbot:grvtbot /build/node_modules ./node_modules
COPY --chown=grvtbot:grvtbot packages/bot/package.json ./package.json

# The dashboard SPA bundle, freshly built in stage 2. The host can override
# with a bind mount to /app/dashboard-dist if needed (e.g. to test a UI
# build without rebuilding the whole image).
COPY --from=dashboard-builder --chown=grvtbot:grvtbot /build/packages/dashboard/dist ./dashboard-dist

# Data dir is a bind-mount target for the SQLite db + WAL files
# Already created above with chmod 1777
VOLUME /app/data

USER grvtbot

# ── Rebuild sqlite3 for container glibc compatibility ──────────────────────
# The pre-compiled binary may require a newer glibc than what the runtime
# container provides. Rebuild from source to generate a compatible binary.
RUN npm rebuild sqlite3 --build-from-source 2>/dev/null || true

EXPOSE 3848

# Healthcheck talks to the legacy /api/health (no auth required)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fs http://127.0.0.1:3848/api/health || exit 1

# Tini handles PID 1 + signal forwarding (SIGTERM → node → graceful shutdown
# preserves GRVT open orders, exactly like the systemd unit on the VPS).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/dashboard/server.js"]
