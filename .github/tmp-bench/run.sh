#!/bin/bash
set -e
T=$GITHUB_WORKSPACE; cd $T
D=$RUNNER_TEMP/dists; W=$RUNNER_TEMP/work; mkdir -p $D $W
cp .github/tmp-bench/landing.html.txt $W/landing.html
F=packages/cli/src/capture/browserLaunchArgs.ts
grep -q disable-gpu-compositing $F
mv packages/cli/dist $D/fix
git show origin/main:$F > $F
(cd packages/cli && bun run build >/dev/null 2>&1); mv packages/cli/dist $D/main
git checkout -- $F
MAP=https://maplibre.org/maplibre-gl-js/docs/examples/animate-map-camera-around-a-point.html
run() { # cpus rounds target label
  docker run --rm --cpus $1 -v $T:$T -v $D:/dists -v $W:/work -w /work node:22-bookworm-slim bash -c "
    apt-get update -qq && apt-get install -y -qq chromium fonts-liberation unzip >/dev/null 2>&1
    npx --yes @puppeteer/browsers install chrome-headless-shell@158.0.8127.36 --path /tmp/chrome >/dev/null 2>&1
    export HYPERFRAMES_BROWSER_PATH=\$(find /tmp/chrome -name chrome-headless-shell -type f)
    for r in \$(seq 1 $2); do for v in main fix; do
      rm -rf $T/packages/cli/dist; cp -r /dists/\$v $T/packages/cli/dist
      s=\$(date +%s)
      node $T/packages/cli/bin/hyperframes.mjs capture $3 -o out-$4-$1-\$v-\$r --json --skip-vision > res-$4-$1-\$v-\$r.json 2> err-$4-$1-\$v-\$r.txt || true
      echo \"$4 cpus $1 \$v round \$r: \$(( \$(date +%s) - s )) s, \$(grep -o '\"screenshots\": *[0-9]*' res-$4-$1-\$v-\$r.json | head -1), \$(grep -o '\"canvases\": *[0-9]*' res-$4-$1-\$v-\$r.json | head -1), \$(grep -o '\"remainingMs\": *[0-9]*' res-$4-$1-\$v-\$r.json | tail -1)\"
    done; done
    rm -rf $T/packages/cli/dist; chmod -R a+rwX /work"
}
echo "arch: $(uname -m), cpus: $(nproc)"
run 3 2 "$MAP" map
run 2 2 "$MAP" map
run 2 1 "--local-file landing.html" css
