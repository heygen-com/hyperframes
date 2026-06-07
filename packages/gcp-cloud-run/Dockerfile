# HyperFrames distributed render — Cloud Run image.
#
# One container image, three roles (plan / renderChunk / assemble). Cloud
# Workflows POSTs a JSON body with an `Action` field; `dist/server.js`
# dispatches to the matching `@hyperframes/producer/distributed` primitive.
#
# Build context is the REPOSITORY ROOT (not this package dir) because the
# package depends on the `@hyperframes/producer` workspace and renders with
# the same chrome-headless-shell + fonts + ffmpeg the production renderer
# uses. The example smoke script and `hyperframes cloudrun deploy` both
# build with the repo root as context:
#
#   docker build -f packages/gcp-cloud-run/Dockerfile -t <image> .
#
# NOTE: this Dockerfile only builds from a full hyperframes monorepo checkout
# — it COPYs sibling workspace packages (core/engine/producer). It is NOT
# buildable from the published npm tarball alone; install the repo (or use
# `hyperframes cloudrun deploy`, which builds from your checkout via Cloud
# Build) to produce the image.
#
# Unlike the AWS Lambda adapter there is no ZIP-size ceiling and no runtime
# Chrome decompression step — the binary lives in the image at a fixed path.

FROM node:22-bookworm-slim

# ── System dependencies (identical set to the producer's render image) ───────
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    unzip \
    ffmpeg \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libcups2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libxshmfence1 \
    libgtk-3-0 \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    fonts-noto-core \
    fonts-noto-extra \
    fonts-noto-ui-core \
    fonts-freefont-ttf \
    fonts-dejavu-core \
    fontconfig \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean \
    && fc-cache -fv

# ── chrome-headless-shell (deterministic BeginFrame capture) ─────────────────
# Pinned to the SAME build the producer regression baselines were generated
# against so distributed renders are pixel-comparable. Bump together with the
# producer's Dockerfile.test pin and a baseline regen.
RUN npx --yes @puppeteer/browsers install chrome-headless-shell@148.0.7778.167 \
      --path /opt/puppeteer \
    && CHS="$(find /opt/puppeteer/chrome-headless-shell -name chrome-headless-shell -type f | head -n1)" \
    && mkdir -p /opt/chrome \
    && ln -s "$CHS" /opt/chrome/chrome-headless-shell \
    && /opt/chrome/chrome-headless-shell --version

# The chromium.ts resolver reads this first; pointing the engine straight at
# the symlinked binary avoids the runtime cache scan.
ENV HYPERFRAMES_CHROME_PATH=/opt/chrome/chrome-headless-shell
ENV PRODUCER_HEADLESS_SHELL_PATH=/opt/chrome/chrome-headless-shell
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CONTAINER=true

WORKDIR /app

# Install bun (the repo's package manager / build driver). Pin the version:
# the container runs `bun dist/server.js` and relies on bun's ESM `require`
# interop to load the producer bundle, so a future bun release changing that
# behaviour shouldn't silently break the next image rebuild. Bump deliberately.
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.9"
ENV PATH="/root/.bun/bin:$PATH"

# Install workspace dependencies. Copy manifests first for layer caching.
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/player/package.json packages/player/package.json
COPY packages/producer/package.json packages/producer/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/studio/package.json packages/studio/package.json
COPY packages/shader-transitions/package.json packages/shader-transitions/package.json
COPY packages/aws-lambda/package.json packages/aws-lambda/package.json
COPY packages/gcp-cloud-run/package.json packages/gcp-cloud-run/package.json
RUN bun install --frozen-lockfile

# Copy source for the packages the render path needs.
COPY packages/core/ packages/core/
COPY packages/engine/ packages/engine/
COPY packages/producer/ packages/producer/
COPY packages/gcp-cloud-run/ packages/gcp-cloud-run/

# Build core runtime artifacts (needed by the renderer) + producer, then the
# adapter. Generate embedded font data so glyph layout matches production.
RUN bun run --filter @hyperframes/core build:hyperframes-runtime:modular \
    && (cd packages/producer && bunx tsx scripts/generate-font-data.ts) \
    && bun run --cwd packages/producer build \
    && bun run --cwd packages/gcp-cloud-run build

# Cloud Run injects PORT (default 8080). The server reads it.
ENV PORT=8080
EXPOSE 8080

WORKDIR /app/packages/gcp-cloud-run
# Run under bun, not node. The repo is bun-native and `@hyperframes/producer`'s
# bundled `distributed.js` relies on a `require` being available at runtime
# (its esbuild interop shim); bun provides one in ESM, bare `node` does not.
CMD ["bun", "dist/server.js"]
