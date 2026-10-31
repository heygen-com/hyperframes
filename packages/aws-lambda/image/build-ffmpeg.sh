#!/bin/bash
# Builds ffmpeg + ffprobe into /opt/hf-media and packs /out/hf-media-linux-<arch>.tar.gz.
# Codec libraries link statically; glibc and the TLS stack stay dynamic (a static glibc build crashed on Lambda).
set -euo pipefail

PREFIX=/opt/hf-media
DEPS=/build/deps
SRC=/build/src
JOBS=$(nproc)
export PKG_CONFIG_PATH="$DEPS/lib/pkgconfig:$DEPS/lib64/pkgconfig"
export CFLAGS="-O2 -fPIC" CXXFLAGS="-O2 -fPIC"
mkdir -p "$SRC" "$DEPS" "$PREFIX/share/licenses" /out

source /fetch.sh

license() { mkdir -p "$PREFIX/share/licenses/$1" && cp "${@:2}" "$PREFIX/share/licenses/$1/"; }

fetch x264
(cd "$SRC/x264" && ./configure --prefix="$DEPS" --enable-static --enable-pic --disable-cli &&
  make -j"$JOBS" && make install)
license x264 "$SRC/x264/COPYING"

fetch x265_4.1.tar.gz
# 8-bit x265 with the 10-bit library linked in (x265's multilib layout): HDR renders encode yuv420p10le.
# SVE2 kernels need -march=armv9-a, which the base's gcc 11 does not know (x86 ignores the flag).
x265=(-S "$SRC/x265_4.1/source" -DCMAKE_BUILD_TYPE=Release -DENABLE_SHARED=OFF -DENABLE_CLI=OFF -DENABLE_SVE2=OFF)
cmake "${x265[@]}" -B "$SRC/x265-10" -DHIGH_BIT_DEPTH=ON -DEXPORT_C_API=OFF
cmake --build "$SRC/x265-10" -j"$JOBS"
cmake "${x265[@]}" -B "$SRC/x265-8" -DCMAKE_INSTALL_PREFIX="$DEPS" -DLINKED_10BIT=ON \
  -DEXTRA_LIB="$SRC/x265-10/libx265.a"
cmake --build "$SRC/x265-8" -j"$JOBS"
cmake --install "$SRC/x265-8"
printf 'CREATE %s\nADDLIB %s\nADDLIB %s\nSAVE\nEND\n' "$DEPS/lib/libx265.a" \
  "$SRC/x265-8/libx265.a" "$SRC/x265-10/libx265.a" | ar -M
license x265 "$SRC/x265_4.1/COPYING"

fetch libvpx-1.15.0.tar.gz
(cd "$SRC/libvpx-1.15.0" && ./configure --prefix="$DEPS" --enable-static --disable-shared --enable-pic \
  --enable-vp9-highbitdepth --disable-examples --disable-tools --disable-docs --disable-unit-tests &&
  make -j"$JOBS" && make install)
license libvpx "$SRC/libvpx-1.15.0/LICENSE" "$SRC/libvpx-1.15.0/PATENTS"

fetch opus-1.5.2.tar.gz
(cd "$SRC/opus-1.5.2" && ./configure --prefix="$DEPS" --enable-static --disable-shared --with-pic \
  --disable-doc --disable-extra-programs && make -j"$JOBS" && make install)
license opus "$SRC/opus-1.5.2/COPYING"

fetch zimg-3.0.5.tar.gz
(cd "$SRC/zimg-release-3.0.5" && ./autogen.sh && ./configure --prefix="$DEPS" --enable-static --disable-shared \
  --with-pic && make -j"$JOBS" && make install)
license zimg "$SRC/zimg-release-3.0.5/COPYING"

fetch dav1d-1.5.1.tar.xz
meson setup "$SRC/dav1d-build" "$SRC/dav1d-1.5.1" --prefix="$DEPS" --libdir=lib --buildtype=release \
  --default-library=static -Denable_tools=false -Denable_tests=false
ninja -C "$SRC/dav1d-build" install
license dav1d "$SRC/dav1d-1.5.1/COPYING"

fetch ffmpeg-7.0.2.tar.xz
# No --static pkg-config: gnutls.pc then names a libgmp.a from its own RPM build tree. The deps above
# exist only as .a, so they link statically anyway; --extra-libs carries their private libraries.
(cd "$SRC/ffmpeg-7.0.2" && ./configure --prefix="$PREFIX" \
  --extra-cflags="-I$DEPS/include" --extra-ldflags="-L$DEPS/lib" --extra-libs="-lstdc++ -lpthread -lm -ldl" \
  --enable-gpl --enable-version3 --disable-debug --disable-doc --disable-ffplay --disable-autodetect \
  --enable-gnutls --enable-zlib --enable-libx264 --enable-libx265 --enable-libvpx --enable-libopus \
  --enable-libzimg --enable-libdav1d && make -j"$JOBS" && make install)
license ffmpeg "$SRC/ffmpeg-7.0.2/COPYING.GPLv3" "$SRC/ffmpeg-7.0.2/LICENSE.md"
rm -rf "$PREFIX/include" "$PREFIX/lib" "$PREFIX/share/ffmpeg"
strip "$PREFIX/bin/ffmpeg" "$PREFIX/bin/ffprobe"

# Bundle every shared library the bare base image lacks (gnutls, nettle); the rpath finds them.
mkdir -p "$PREFIX/lib"
ldd "$PREFIX/bin/ffmpeg" "$PREFIX/bin/ffprobe" | awk '$2 == "=>" { print $3 }' | sort -u | while read -r lib; do
  if ! grep -qx "$(rpm -qf --qf '%{NAME}' "$lib")" /build/base-rpms.txt; then
    cp -L "$lib" "$PREFIX/lib/" && patchelf --set-rpath '$ORIGIN' "$PREFIX/lib/$(basename "$lib")"
    echo "$(rpm -qf "$lib") $(basename "$lib")" >>"$PREFIX/share/licenses/bundled-libraries.txt"
  fi
done
patchelf --set-rpath '$ORIGIN/../lib' "$PREFIX/bin/ffmpeg" "$PREFIX/bin/ffprobe"
cp /build/sources.txt "$PREFIX/share/licenses/sources.txt"

tar --sort=name --mtime="@$SOURCE_DATE_EPOCH" --owner=0 --group=0 --numeric-owner -C /opt -cf - hf-media |
  gzip -n -9 >"/out/hf-media-linux-$(uname -m).tar.gz"
