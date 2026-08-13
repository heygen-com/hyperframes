FROM docker.io/cloudflare/sandbox:0.12.5

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libxshmfence1 \
    libgtk-3-0 \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -fv

# Ubuntu jammy has no `chromium` apt package. Install the same
# chrome-headless-shell the producer regression image uses.
RUN npx --yes @puppeteer/browsers install chrome-headless-shell@148.0.7778.167 \
      --path /opt/hf/chrome \
    && find /opt/hf/chrome -name "chrome-headless-shell" -type f

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CONTAINER=true
ENV CHROME_PATH=/opt/hf/chrome
# resolveHeadlessShellPath also searches ~/.cache/puppeteer; keep a copy there.
ENV PRODUCER_HEADLESS_SHELL_PATH=/opt/hf/chrome

RUN mkdir -p /opt/hf /workspace /root/.cache \
    && ln -sfn /opt/hf/chrome /root/.cache/puppeteer

COPY chunk-worker.mjs /opt/hf/chunk-worker.mjs
COPY runtime/hyperframe.manifest.json /opt/hf/runtime/hyperframe.manifest.json
COPY runtime/hyperframe.runtime.iife.js /opt/hf/runtime/hyperframe.runtime.iife.js
ENV PRODUCER_HYPERFRAME_MANIFEST_PATH=/opt/hf/runtime/hyperframe.manifest.json
WORKDIR /opt/hf
RUN printf '%s\n' '{"name":"hf-chunk-worker","type":"module"}' > /opt/hf/package.json \
    && npm install --omit=dev ws \
    && test -d /opt/hf/node_modules/ws

# Wrapper so `chrome-headless-shell --version` works in /smoke.
RUN printf '%s\n' '#!/bin/sh' 'exec "$(find /opt/hf/chrome -name chrome-headless-shell -type f | head -n1)" "$@"' \
      > /usr/local/bin/chrome-headless-shell \
    && chmod +x /usr/local/bin/chrome-headless-shell \
    && printf '%s\n' '#!/bin/sh' 'exec /usr/local/bin/chrome-headless-shell "$@"' \
      > /usr/local/bin/chromium \
    && chmod +x /usr/local/bin/chromium

ENV PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chrome-headless-shell
ENV PRODUCER_HEADLESS_SHELL_PATH=/usr/local/bin/chrome-headless-shell
ENV NODE_PATH=/opt/hf/node_modules

RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v1.3.14"

EXPOSE 8080
