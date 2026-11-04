# Source downloads for the ffmpeg build. One place for the retry policy: curl alone does not retry a reset connection.
SOURCES=${SOURCES:-/build/sources.txt}

retry() {
  local n
  for n in 1 2 3 4 5; do
    "$@" && return 0
    sleep $((n * 3))
  done
  return 1
}

# Tries each URL on the source's line in order; only bytes matching its sha256 (git: its commit) are taken.
fetch() {
  local name=$1 sum urls url
  read -r sum urls <<<"$(awk -v n="$name" '$1 == n { $1 = ""; print }' "$SOURCES")"
  for url in $urls; do
    if [[ $url == *.git ]]; then
      retry git clone -q "$url" "$SRC/$name" && git -C "$SRC/$name" checkout -q "$sum" &&
        [ "$(git -C "$SRC/$name" rev-parse HEAD)" = "$sum" ] && return 0
      rm -rf "${SRC:?}/$name"
    else
      curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 --connect-timeout 20 --max-time 600 -o "$SRC/$name" "$url" &&
        echo "$sum  $SRC/$name" | sha256sum -c --quiet && tar -xf "$SRC/$name" -C "$SRC" && return 0
    fi
    echo "fetch: $name not taken from $url" >&2
  done
  return 1
}
