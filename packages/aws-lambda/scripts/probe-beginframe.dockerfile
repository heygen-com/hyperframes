# BeginFrame regression-guard container.
#
# Uses the official AWS Lambda Node 22 image as the base so the probe
# exercises @sparticuz/chromium against the SAME glibc, kernel feature
# set, and `/tmp` filesystem layout that real Lambda invocations see. If
# this Dockerfile passes, the bundled handler is on solid footing for
# real AWS.
#
# Build context: monorepo root (../../). Build + run:
#
#   bun run --cwd packages/aws-lambda probe:beginframe:docker
#
# The default CMD runs `tsx scripts/probe-beginframe.ts` and exits 0 on
# pass, 1 on BeginFrame failure, 2 on harness failure.

FROM public.ecr.aws/lambda/nodejs:22

# Shared libraries @sparticuz/chromium expects but the Lambda base image
# does not bring in by default. Versions are pinned to whatever
# `dnf install` resolves on the Lambda base image at build time; we just
# need them present.
RUN dnf install -y \
        alsa-lib \
        atk \
        cups-libs \
        gtk3 \
        libdrm \
        libxkbcommon \
        libXcomposite \
        libXdamage \
        libXrandr \
        mesa-libgbm \
        nss \
        pango \
        tar \
        gzip \
        unzip \
        && dnf clean all

WORKDIR /var/task

# The probe is self-contained — we install the three deps it needs into a
# fresh package directory rather than re-using the monorepo's
# workspace-rooted manifests (which carry `workspace:` protocol deps npm
# can't resolve).
COPY packages/aws-lambda/scripts/ scripts/

RUN printf '{"name":"hf-lambda-probe","version":"1.0.0","type":"module"}\n' > package.json \
    && npm install --no-audit --no-fund --omit=optional \
        @sparticuz/chromium@148.0.0 \
        puppeteer-core@^24.39.1 \
        tsx@^4.21.0

ENV NODE_PATH=/var/task/node_modules
ENV PATH="/var/task/node_modules/.bin:${PATH}"

# Lambda's `tmpfs` is mounted at /tmp; sparticuz decompresses into /tmp
# at runtime. The base image already has /tmp writable.

ENTRYPOINT []
CMD ["node", "--experimental-strip-types", "scripts/probe-beginframe.ts"]
