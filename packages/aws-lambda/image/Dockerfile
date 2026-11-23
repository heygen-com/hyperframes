# The arm64 Lambda video function's native ffmpeg, built on the Lambda Node 22 base it runs on:
#   docker buildx build --platform linux/arm64 --target artifact --output type=local,dest=out packages/aws-lambda/image
# The artifact stage depends on the check stage, so no tarball comes out of a build whose codecs fail.
ARG BASE=public.ecr.aws/lambda/nodejs:22@sha256:f571ad6becf9000980068fab79b9aac30c369fdd69817c0803f33ecaa9206834

FROM ${BASE} AS build
ENV SOURCE_DATE_EPOCH=1722643200
COPY fetch.sh /fetch.sh
RUN . /fetch.sh && rpm -qa --qf '%{NAME}\n' | sort >/build-base-rpms.txt && \
    retry microdnf install -y --nodocs --setopt=install_weak_deps=0 --releasever=2023.12.20260914 \
      gcc gcc-c++ make cmake meson ninja-build autoconf automake libtool pkgconf-pkg-config diffutils \
      git xz bzip2 tar gzip which patchelf gnutls-devel zlib-devel $([ "$(uname -m)" = x86_64 ] && echo nasm) && \
    microdnf clean all && mkdir /build && mv /build-base-rpms.txt /build/base-rpms.txt
COPY sources.txt build-ffmpeg.sh /build/
RUN bash /build/build-ffmpeg.sh

FROM ${BASE} AS certs
COPY fetch.sh /fetch.sh
# certtool, not openssl: the base's openssl-libs cannot run the repo's openssl CLI.
RUN . /fetch.sh && retry microdnf install -y --nodocs --releasever=2023.12.20260914 gnutls-utils && mkdir /certs && cd /certs && \
    printf 'cn = check-ca\nca\ncert_signing_key\nexpiration_days = 2\n' >ca.tmpl && \
    printf 'cn = localhost\ndns_name = localhost\ntls_www_server\nexpiration_days = 2\n' >server.tmpl && \
    certtool -p --outfile ca.key && certtool -s --load-privkey ca.key --template ca.tmpl --outfile ca.crt && \
    certtool -p --outfile server.key && \
    certtool -c --load-privkey server.key --load-ca-certificate ca.crt --load-ca-privkey ca.key \
      --template server.tmpl --outfile server.crt

FROM ${BASE} AS check
COPY --from=build /opt/hf-media /opt/hf-media
COPY --from=certs /certs /certs
COPY check-ffmpeg.sh /check-ffmpeg.sh
RUN cp /certs/ca.crt /etc/pki/ca-trust/source/anchors/ && update-ca-trust && bash /check-ffmpeg.sh >/check.txt

FROM scratch AS artifact
COPY --from=build /out/ /
COPY --from=check /check.txt /hf-media-check.txt

# The video function. /var/task comes from scripts/stage-arm64-image.ts as the `task` build context:
#   docker buildx build --platform linux/arm64 --target video --build-context task=<out>/task packages/aws-lambda/image
# Its Chrome is Chrome for Testing's linux-arm64 chrome-headless-shell, the whole folder: the executable
# alone finds no ICU data or .pak resources. The base has none of the shared libraries the shell links, so
# they come from the base's own repository; this RUN needs an arm64 host or emulation. Its fonts are the
# x86 function's: stage-arm64-image.ts unpacks @sparticuz/chromium's fonts and fonts.conf into /var/task/fonts.
# Bump the version and the archive's sha256 together, with the rest of the repo's pins.
FROM ${BASE} AS video
ARG CHROME_HEADLESS_SHELL_VERSION=158.0.8127.36
ARG CHROME_HEADLESS_SHELL_SHA256=176ee5c55486c22de43128871189061365ea28e881fc96016fd18e7cb59437c8
COPY fetch.sh /fetch.sh
RUN . /fetch.sh && retry microdnf install -y --nodocs --setopt=install_weak_deps=0 --releasever=2023.12.20260914 \
      alsa-lib at-spi2-atk at-spi2-core atk dbus-libs expat fontconfig libX11 libXcomposite libXdamage \
      libXext libXfixes libXrandr libxcb libxkbcommon mesa-libgbm nspr nss nss-util \
      systemd-libs unzip && \
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 20 --max-time 600 -o /tmp/chs.zip \
      "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_HEADLESS_SHELL_VERSION}/linux-arm64/chrome-headless-shell-linux-arm64.zip" && \
    echo "${CHROME_HEADLESS_SHELL_SHA256}  /tmp/chs.zip" | sha256sum -c - && \
    unzip -q /tmp/chs.zip -d /opt && rm /tmp/chs.zip /fetch.sh && \
    microdnf remove -y unzip && microdnf clean all && \
    /opt/chrome-headless-shell-linux-arm64/chrome-headless-shell --version | grep -F "${CHROME_HEADLESS_SHELL_VERSION}"
# src/chromium.ts launches this executable.
ENV HYPERFRAMES_LAMBDA_CHROME_SOURCE=chrome-headless-shell \
    HYPERFRAMES_LAMBDA_CHROME_PATH=/opt/chrome-headless-shell-linux-arm64/chrome-headless-shell \
    FONTCONFIG_PATH=/var/task/fonts
COPY --from=task / /var/task/
CMD ["handler.handler"]
