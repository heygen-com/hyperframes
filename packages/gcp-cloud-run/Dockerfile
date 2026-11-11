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

FROM node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS beginframe-contract

# ── System dependencies (identical set to the producer's render image) ───────
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    unzip \
    xz-utils \
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

# ── FFmpeg (pinned) ──────────────────────────────────────────────────────────
# One pinned static build (BtbN n8.0.1) instead of Debian's apt ffmpeg, so
# regression baselines and the shipped images use the same FFmpeg version.
# Bump the URL and sha256 together, and keep in sync with the other Dockerfiles
# and .github/actions/install-ffmpeg-linux/action.yml.
ARG TARGETARCH
ARG FFMPEG_RELEASE=https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-02-28-12-59
ARG FFMPEG_BUILD=ffmpeg-n8.0.1-66-g27b8d1a017
ARG FFMPEG_SHA256_AMD64=26d2ecd0cefba99f9d1ea92252a3a4f743a58df4c1c3cf9f8bbaaa40b1fca5b0
ARG FFMPEG_SHA256_ARM64=d72cc324cb65dd92a9ffe699cc95ccbacfef4def8d3ad9fe2b5164a6a71b9595
RUN case "$TARGETARCH" in \
      amd64) FF_ARCH=linux64; FF_SHA256="$FFMPEG_SHA256_AMD64" ;; \
      arm64) FF_ARCH=linuxarm64; FF_SHA256="$FFMPEG_SHA256_ARM64" ;; \
      *) echo "unsupported TARGETARCH '$TARGETARCH'" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/ffmpeg.tar.xz "$FFMPEG_RELEASE/$FFMPEG_BUILD-$FF_ARCH-gpl-8.0.tar.xz" \
    && echo "$FF_SHA256  /tmp/ffmpeg.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /usr/local/bin --strip-components=2 --wildcards '*/bin/ffmpeg' '*/bin/ffprobe' \
    && rm /tmp/ffmpeg.tar.xz \
    && ffmpeg -version | grep -F "ffmpeg version ${FFMPEG_BUILD#ffmpeg-}" \
    && ffprobe -version | grep -F "ffprobe version ${FFMPEG_BUILD#ffmpeg-}"

# ── chrome-headless-shell (deterministic BeginFrame capture) ─────────────────
# Pinned deliberately. The build-stage contract probe below launches this
# exact executable and requires a renderer-ready warm-up plus a PNG-returning
# HeadlessExperimental.beginFrame before the image can build. Chrome for Testing
# publishes no linux arm64 headless shell and no checksums, so the sha256 below
# was taken from the archive itself; bump the version and hash together.
ARG CHROME_HEADLESS_SHELL_VERSION=152.0.7977.30
ARG CHROME_HEADLESS_SHELL_SHA256_AMD64=1b150320178ecabe39726bcf3198ebb896ba2b7a07d870db1710914c42d55221
RUN case "$TARGETARCH" in \
      amd64) CHS_SHA256="$CHROME_HEADLESS_SHELL_SHA256_AMD64" ;; \
      *) echo "no pinned chrome-headless-shell for TARGETARCH '$TARGETARCH'" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/chs.zip "https://storage.googleapis.com/chrome-for-testing-public/$CHROME_HEADLESS_SHELL_VERSION/linux64/chrome-headless-shell-linux64.zip" \
    && echo "$CHS_SHA256  /tmp/chs.zip" | sha256sum -c - \
    && unzip -q /tmp/chs.zip -d /opt \
    && rm /tmp/chs.zip \
    && mkdir -p /opt/chrome \
    && ln -s /opt/chrome-headless-shell-linux64/chrome-headless-shell /opt/chrome/chrome-headless-shell \
    && /opt/chrome/chrome-headless-shell --version | grep -F "$CHROME_HEADLESS_SHELL_VERSION"

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
# behaviour shouldn't silently break the next image rebuild. The sha256s are
# from the release's SHASUMS256.txt; bump the version and both hashes together.
ARG BUN_VERSION=1.4.4
ARG BUN_SHA256_AMD64=bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c
ARG BUN_SHA256_ARM64=baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e
RUN case "$TARGETARCH" in \
      amd64) BUN_ARCH=x64; BUN_SHA256="$BUN_SHA256_AMD64" ;; \
      arm64) BUN_ARCH=aarch64; BUN_SHA256="$BUN_SHA256_ARM64" ;; \
      *) echo "unsupported TARGETARCH '$TARGETARCH'" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-$BUN_ARCH.zip" \
    && echo "$BUN_SHA256  /tmp/bun.zip" | sha256sum -c - \
    && mkdir -p /root/.bun/bin \
    && unzip -q -j /tmp/bun.zip "bun-linux-$BUN_ARCH/bun" -d /root/.bun/bin \
    && rm /tmp/bun.zip \
    && /root/.bun/bin/bun --version | grep -Fx "$BUN_VERSION"
ENV PATH="/root/.bun/bin:$PATH"

# Install workspace dependencies. Copy manifests first for layer caching.
COPY package.json bun.lock ./
COPY packages/share/package.json packages/share/package.json
COPY packages/share/tsconfig.json packages/share/tsconfig.json
COPY packages/share/src/ packages/share/src/
COPY packages/share/scripts/ packages/share/scripts/
COPY packages/core/package.json packages/core/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/player/package.json packages/player/package.json
COPY packages/producer/package.json packages/producer/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/studio/package.json packages/studio/package.json
COPY packages/shader-transitions/package.json packages/shader-transitions/package.json
COPY packages/aws-lambda/package.json packages/aws-lambda/package.json
COPY packages/gcp-cloud-run/package.json packages/gcp-cloud-run/package.json
COPY packages/lint/package.json packages/lint/package.json
COPY packages/parsers/package.json packages/parsers/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/sdk-playground/package.json packages/sdk-playground/package.json
COPY packages/inspector/package.json packages/inspector/package.json
COPY packages/studio-server/package.json packages/studio-server/package.json
COPY scripts/package-subpaths.mjs scripts/package-subpaths.mjs
# A corrupt tarball extraction can print an error and then hang instead of
# exiting (seen in Dockerfile.test, run 35468046055). Bound each attempt and
# retry once, so a prod deploy build fails fast instead of hanging.
RUN timeout 300 bun install --frozen-lockfile \
    || timeout 300 bun install --frozen-lockfile

# Fail the image build closed if the packaged executable cannot perform the
# same BeginFrame operation the distributed renderer relies on. Generate the
# argument list with the production engine helper so a launcher-flag regression
# invalidates this layer and fails the contract instead of testing a duplicate
# hard-coded profile.
COPY packages/core/ packages/core/
COPY packages/parsers/ packages/parsers/
COPY packages/engine/ packages/engine/
COPY packages/aws-lambda/scripts/probe-beginframe.ts packages/aws-lambda/scripts/probe-beginframe.ts
RUN bun -e 'import { buildChromeArgs } from "./packages/engine/src/services/browserManager.ts"; await Bun.write("/tmp/hf-gcp-chrome-args.json", JSON.stringify(buildChromeArgs({ width: 800, height: 600, captureMode: "beginframe", platform: "linux" }, { browserGpuMode: "software" })))' \
    && bun packages/aws-lambda/scripts/probe-beginframe.ts \
      --executable-path /opt/chrome/chrome-headless-shell \
      --launch-args-json /tmp/hf-gcp-chrome-args.json

# Reports whether this exact pinned binary gets a hardware WebGPU adapter. A software-only
# host reports "no usable adapter" without failing the build; its WebGPU compositions refuse
# to render at run time. A real script file, not an inline `bun -e` eval: the eval's
# synthetic `/app/[eval]` path can't resolve the workspace-hoisted `puppeteer-core`.
COPY packages/aws-lambda/scripts/probe-webgpu-adapter.ts packages/aws-lambda/scripts/probe-webgpu-adapter.ts
RUN bun packages/aws-lambda/scripts/probe-webgpu-adapter.ts \
      --executable-path /opt/chrome/chrome-headless-shell

# CI targets `beginframe-contract` directly, so pin/probe changes do not need
# the full monorepo build merely to verify browser capability. The deployable
# image continues from the already-proven binary and installed workspaces.
FROM beginframe-contract AS runtime

# Copy source for the packages the render path needs, plus the shared post-emit
# import rewrite their builds run.
COPY scripts/rewrite-relative-import-extensions.mjs scripts/rewrite-relative-import-extensions.mjs
COPY packages/core/ packages/core/
COPY packages/engine/ packages/engine/
COPY packages/producer/ packages/producer/
COPY packages/gcp-cloud-run/ packages/gcp-cloud-run/
COPY packages/lint/ packages/lint/
COPY packages/parsers/ packages/parsers/
COPY packages/sdk/ packages/sdk/
COPY packages/sdk-playground/ packages/sdk-playground/
COPY packages/studio-server/ packages/studio-server/

# Build workspace dependencies before the producer bundle. The published
# workspace packages are not prebuilt in a fresh clone, so producer's esbuild
# resolution otherwise fails on parsers/core compiler entrypoints. Core's build
# also generates the embedded font data, so glyph layout matches production.
RUN bun run --cwd packages/parsers build \
    && bun run --cwd packages/lint build \
    && bun run --cwd packages/studio-server build \
    && bun run --cwd packages/core build \
    && bun run --cwd packages/core build:hyperframes-runtime:modular \
    && bun run --cwd packages/sdk build \
    && bun run --cwd packages/sdk-playground build \
    && bun run --cwd packages/engine build \
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
