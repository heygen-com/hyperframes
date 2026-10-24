# The arm64 Lambda video function's native ffmpeg, built on the Lambda Node 22 base it runs on:
#   docker buildx build --platform linux/arm64 --target artifact --output type=local,dest=out packages/aws-lambda/image
# The artifact stage depends on the check stage, so no tarball comes out of a build whose codecs fail.
ARG BASE=public.ecr.aws/lambda/nodejs:22@sha256:d138eff445f6ea04c51091d8e6cbb064d5663e850cddfa62396061586f98b126

FROM ${BASE} AS build
ENV SOURCE_DATE_EPOCH=1722643200
RUN rpm -qa --qf '%{NAME}\n' | sort >/build-base-rpms.txt && \
    microdnf install -y --nodocs --setopt=install_weak_deps=0 --releasever=2023.12.20260914 \
      gcc gcc-c++ make cmake meson ninja-build autoconf automake libtool pkgconf-pkg-config diffutils \
      git xz bzip2 tar gzip which patchelf gnutls-devel zlib-devel $([ "$(uname -m)" = x86_64 ] && echo nasm) && \
    microdnf clean all && mkdir /build && mv /build-base-rpms.txt /build/base-rpms.txt
COPY sources.txt build-ffmpeg.sh /build/
RUN bash /build/build-ffmpeg.sh

FROM ${BASE} AS certs
# certtool, not openssl: the base's openssl-libs cannot run the repo's openssl CLI.
RUN microdnf install -y --nodocs --releasever=2023.12.20260914 gnutls-utils && mkdir /certs && cd /certs && \
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
# Copy only, so any host builds it without emulation.
FROM ${BASE} AS video
COPY --from=task / /var/task/
CMD ["handler.handler"]
