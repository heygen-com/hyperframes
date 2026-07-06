#!/usr/bin/env tsx
/**
 * Build the AWS Lambda deployment ZIP.
 *
 * Pack layout (paths inside the ZIP are relative to Lambda's
 * `/var/task/`):
 *
 *   handler.mjs                — bundled entry, set as Lambda's Handler
 *   handler.mjs.map            — sourcemap (debugging aid; small)
 *   bin/ffmpeg                 — ffmpeg-static binary
 *   bin/chrome-headless-shell  — fallback Chrome (only when CHROME_SOURCE=shell)
 *   node_modules/@sparticuz/chromium/
 *                              — primary Chrome (lives under node_modules so
 *                                runtime `import("@sparticuz/chromium")`
 *                                resolves; the package's own tarball stays
 *                                inside).
 *
 * The handler bundle (esbuild) externalises modules whose binary assets
 * must be present at runtime — `@sparticuz/chromium` for its bin tarball,
 * `puppeteer-core` because Lambda runtime resolves it via Node module
 * resolution from `node_modules/`. Everything else is inlined for cold
 * start speed.
 *
 * Run:
 *   bun run --cwd packages/aws-lambda build:zip
 *   bun run --cwd packages/aws-lambda build:zip -- --source=chrome-headless-shell
 *
 * Outputs the resolved ZIP path + size to stdout and writes a sidecar
 * JSON (`dist/handler.zip.manifest.json`) describing the contents.
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { formatBytes } from "./_formatBytes.js";
import { HANDLER_BANNER } from "./_handlerBanner.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const monorepoRoot = resolve(packageRoot, "../..");
const distDir = join(packageRoot, "dist");

interface BuildOptions {
  source: "sparticuz" | "chrome-headless-shell";
  /** Hard upper bound on the unzipped bundle size in bytes (Lambda limit is 250 MiB). */
  maxUnzippedBytes: number;
  /** Hard upper bound on the ZIP file size in bytes. */
  maxZippedBytes: number;
}

const DEFAULT_OPTIONS: BuildOptions = {
  source: "sparticuz",
  // Lambda's hard ceiling for ZIP-deployed functions is 250 MiB unzipped
  // (AWS docs label it "250 MB" but the 262144000-byte value is 250
  // binary mebibytes). We gate at 248 MiB to keep ~2 MiB of headroom —
  // the sparticuz Chrome (~70 MiB) + ffmpeg (~80 MiB) + ffprobe (~62
  // MiB) + bundled Node deps put us close to the ceiling. Chrome itself
  // decompresses into Lambda's `/tmp` at cold start, which has its own
  // 10 GiB budget, so the unzipped /var/task footprint above is what
  // actually competes with Lambda's 250 MiB limit.
  maxUnzippedBytes: 248 * 1024 * 1024,
  // Lambda's only zipped-size cap is for direct console/CLI uploads (50
  // MiB); S3-deployed functions are bounded by the unzipped ceiling. We
  // gate at 150 MiB to flag a sudden bundle-size regression without
  // false-failing on the natural ~100 MiB sparticuz + ffmpeg payload.
  maxZippedBytes: 150 * 1024 * 1024,
};

function parseArgs(argv: string[]): BuildOptions {
  const opts = { ...DEFAULT_OPTIONS };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--source=")) {
      const v = arg.slice("--source=".length);
      if (v !== "sparticuz" && v !== "chrome-headless-shell") {
        throw new Error(`--source must be 'sparticuz' or 'chrome-headless-shell' (got ${v})`);
      }
      opts.source = v;
    } else if (arg.startsWith("--max-unzipped=")) {
      opts.maxUnzippedBytes = Number.parseInt(arg.slice("--max-unzipped=".length), 10);
    } else if (arg.startsWith("--max-zipped=")) {
      opts.maxZippedBytes = Number.parseInt(arg.slice("--max-zipped=".length), 10);
    } else if (arg === "--help") {
      console.log(
        "Usage: tsx build-zip.ts [--source=sparticuz|chrome-headless-shell]\n" +
          "                       [--max-unzipped=<bytes>] [--max-zipped=<bytes>]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  const start = Date.now();

  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  const stagingDir = join(distDir, "staging");
  mkdirSync(stagingDir, { recursive: true });

  console.log(`[build-zip] source=${opts.source}`);

  // 1. Bundle the handler.
  await bundleHandler(stagingDir);

  // 2. Stage runtime modules (puppeteer-core + @sparticuz/chromium or the
  //    fallback chrome-headless-shell tar).
  stageRuntimeModules(stagingDir, opts.source);

  // 3. Stage the ffmpeg binary.
  stageFfmpeg(stagingDir);

  // 3b. Stage the hyperframe runtime manifest + IIFE as siblings of
  //     handler.mjs. The producer's `hyperframeRuntimeLoader` checks
  //     SIBLING_MANIFEST_PATH first, so dropping the manifest alongside
  //     the bundled handler at /var/task/hyperframe.manifest.json lets
  //     renderChunk find it without needing PRODUCER_HYPERFRAME_MANIFEST_PATH.
  stageHyperframeRuntime(stagingDir);

  // 4. If we're on the chrome-headless-shell fallback, stage that binary.
  if (opts.source === "chrome-headless-shell") {
    stageChromeHeadlessShell(stagingDir);
  }

  // 5. Compute the unzipped size BEFORE zipping so we fail loud when over budget.
  const unzippedBytes = directorySizeBytes(stagingDir);
  console.log(`[build-zip] unzipped staging size: ${formatBytes(unzippedBytes)}`);
  if (unzippedBytes > opts.maxUnzippedBytes) {
    throw new Error(
      `[build-zip] unzipped bundle ${formatBytes(unzippedBytes)} exceeds limit ${formatBytes(
        opts.maxUnzippedBytes,
      )} (Lambda ZIP ceiling: 250 MiB unzipped). ` +
        `Switch --source to the lighter option, or move Chrome to a Lambda Layer.`,
    );
  }

  // 6. Build the ZIP.
  const zipPath = join(distDir, "handler.zip");
  zipDirectory(stagingDir, zipPath);
  const zippedBytes = statSync(zipPath).size;
  console.log(`[build-zip] zip size: ${formatBytes(zippedBytes)} → ${zipPath}`);
  if (zippedBytes > opts.maxZippedBytes) {
    throw new Error(
      `[build-zip] zip ${formatBytes(zippedBytes)} exceeds ZIP size limit ${formatBytes(
        opts.maxZippedBytes,
      )}.`,
    );
  }

  // 7. Sidecar manifest.
  const manifest = {
    builtAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    source: opts.source,
    unzippedBytes,
    zippedBytes,
    maxUnzippedBytes: opts.maxUnzippedBytes,
    maxZippedBytes: opts.maxZippedBytes,
  };
  writeFileSync(join(distDir, "handler.zip.manifest.json"), JSON.stringify(manifest, null, 2));

  // 8. Cleanup staging.
  rmSync(stagingDir, { recursive: true, force: true });
  console.log(`[build-zip] done in ${Date.now() - start}ms`);
}

async function bundleHandler(stagingDir: string): Promise<void> {
  const entry = join(packageRoot, "src/handler.ts");
  const outfile = join(stagingDir, "handler.mjs");

  const workspaceAliasPlugin: esbuild.Plugin = {
    name: "workspace-alias",
    setup(build) {
      build.onResolve({ filter: /^@hyperframes\/producer\/distributed$/ }, () => ({
        path: resolve(monorepoRoot, "packages/producer/src/distributed.ts"),
      }));
      build.onResolve({ filter: /^@hyperframes\/producer$/ }, () => ({
        path: resolve(monorepoRoot, "packages/producer/src/index.ts"),
      }));
      build.onResolve({ filter: /^@hyperframes\/engine$/ }, () => ({
        path: resolve(monorepoRoot, "packages/engine/src/index.ts"),
      }));
      build.onResolve({ filter: /^@hyperframes\/engine\/alpha-blit$/ }, () => ({
        path: resolve(monorepoRoot, "packages/engine/src/utils/alphaBlit.ts"),
      }));
      build.onResolve({ filter: /^@hyperframes\/engine\/shader-transitions$/ }, () => ({
        path: resolve(monorepoRoot, "packages/engine/src/utils/shaderTransitions.ts"),
      }));
      build.onResolve({ filter: /^@hyperframes\/core$/ }, () => ({
        path: resolve(monorepoRoot, "packages/core/src/index.ts"),
      }));
      build.onResolve({ filter: /^@hyperframes\/core\/lint$/ }, () => ({
        path: resolve(monorepoRoot, "packages/core/src/lint/index.ts"),
      }));
    },
  };

  await esbuild.build({
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    // Externalise binary-shipped modules so node module resolution picks
    // them up at runtime. esbuild would otherwise try to inline their
    // postinstall-extracted binaries, which it cannot do.
    external: [
      "@sparticuz/chromium",
      "puppeteer-core",
      "puppeteer",
      // AWS SDK v3 is pre-installed in the Lambda Node 22 runtime; mark
      // external so we don't double-bundle 3+ MiB of SDK.
      "@aws-sdk/client-s3",
    ],
    plugins: [workspaceAliasPlugin],
    minify: false,
    // sourcemap=false: the ZIP is tight on Lambda's 250 MiB unzipped cap
    // (Chrome ~70 MiB + ffmpeg ~80 MiB + ffprobe ~62 MiB + Node deps). A
    // 4-5 MiB sourcemap puts us over. Re-enable for local debugging by passing
    // --sourcemap; the bundle's stack traces stay readable enough without
    // it because we don't minify.
    sourcemap: false,
    entryPoints: [entry],
    outfile,
    // See HANDLER_BANNER (_handlerBanner.ts) for why the ESM bundle needs the
    // CJS require/__filename/__dirname shims.
    banner: {
      js: HANDLER_BANNER,
    },
  });
  console.log(`[build-zip] bundled handler → ${outfile}`);
}

function stageRuntimeModules(stagingDir: string, source: BuildOptions["source"]): void {
  // Bun's isolated-install layout means cpSync(@sparticuz/chromium) only
  // copies the package's own files, missing transitive deps like `tar-fs`.
  // The clean cross-package-manager solution: write a tiny package.json
  // into staging/ that declares the production deps, then `npm install`
  // there. npm flattens transitive deps into staging/node_modules/.
  const pkg: Record<string, unknown> = {
    name: "hyperframes-aws-lambda-bundled",
    version: "0.0.0",
    private: true,
    dependencies: {
      "puppeteer-core": readDepVersion("puppeteer-core"),
    },
  };
  if (source === "sparticuz") {
    (pkg.dependencies as Record<string, string>)["@sparticuz/chromium"] =
      readDepVersion("@sparticuz/chromium");
  }
  writeFileSync(join(stagingDir, "package.json"), JSON.stringify(pkg, null, 2));

  // --no-package-lock so we don't pollute staging with a lockfile we don't
  // ship; --no-audit/--no-fund just for log noise.
  const result = spawnSync(
    "npm",
    ["install", "--no-package-lock", "--no-audit", "--no-fund", "--omit=dev", "--omit=optional"],
    {
      cwd: stagingDir,
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    throw new Error(`[build-zip] npm install into staging failed (status ${result.status})`);
  }
  console.log(`[build-zip] staged node_modules via npm install`);
}

function readDepVersion(moduleName: string): string {
  // Resolve the EXACT version bun installed into the workspace, not the
  // semver range declared in package.json. The staging-dir npm install
  // runs with `--no-package-lock`, so a caret range would float to the
  // latest registry version at build time — diverging from what the
  // workspace tests ran against and breaking ZIP-content determinism
  // across consecutive builds. The lockfile pin gives us reproducibility.
  const lockText = readFileSync(join(monorepoRoot, "bun.lock"), "utf-8");
  // bun.lock lines look like:
  //   "puppeteer-core": ["puppeteer-core@24.43.1", "", { ... }, "sha512-..."],
  const re = new RegExp(
    `"${moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":\\s*\\["${moduleName.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    )}@([^"]+)"`,
  );
  const match = re.exec(lockText);
  if (!match || !match[1]) {
    // Fall back to the manifest range — better than failing the build
    // entirely if bun.lock's format changes between bun versions.
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
    };
    return manifest.dependencies?.[moduleName] ?? "latest";
  }
  return match[1];
}

function resolveModuleDir(moduleName: string): string {
  // Walk up from packageRoot to find a matching node_modules entry.
  // Used by stageFfmpeg below; the @sparticuz/chromium + puppeteer-core
  // paths now go through npm install instead.
  let dir = packageRoot;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "node_modules", moduleName);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(
    `[build-zip] could not resolve ${moduleName} from ${packageRoot} — run 'bun install' first.`,
  );
}

function stageHyperframeRuntime(stagingDir: string): void {
  const coreDist = resolve(monorepoRoot, "packages/core/dist");
  const manifestSrc = join(coreDist, "hyperframe.manifest.json");
  const iifeSrc = join(coreDist, "hyperframe.runtime.iife.js");
  if (!existsSync(manifestSrc) || !existsSync(iifeSrc)) {
    throw new Error(
      `[build-zip] hyperframe runtime artifacts missing under ${coreDist}. ` +
        `Run 'bun run --filter @hyperframes/core build:hyperframes-runtime:modular' first.`,
    );
  }
  cpSync(manifestSrc, join(stagingDir, "hyperframe.manifest.json"));
  cpSync(iifeSrc, join(stagingDir, "hyperframe.runtime.iife.js"));
  console.log(`[build-zip] staged hyperframe.manifest.json + hyperframe.runtime.iife.js`);
}

// ELF header constants used by `assertLinuxX86_64Elf`. Header layout:
// bytes 0..3 magic `0x7F 'E' 'L' 'F'`, byte 4 EI_CLASS (`2` = ELFCLASS64),
// bytes 18..19 e_machine little-endian (`0x3E` = EM_X86_64).
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const ELF_CLASS_64 = 2;
const ELF_MACHINE_X86_64 = 0x3e;
const ELF_HEADER_BYTES = 20;

/**
 * Verify the binary at `path` is a Linux x86-64 ELF executable, the only
 * shape the Lambda runtime can exec. Throws with the canonical workaround
 * (Docker `--platform=linux/amd64` or `npm_config_platform` /
 * `npm_config_arch` overrides) so the build doesn't ship a silently
 * broken zip when a non-Linux host's postinstall fetched the wrong arch.
 */
function assertLinuxX86_64Elf(path: string, label: string): void {
  const head = readFileHead(path, ELF_HEADER_BYTES, label);
  const isElf = head.subarray(0, 4).equals(ELF_MAGIC);
  const isElf64 = head[4] === ELF_CLASS_64;
  const machine = head.readUInt16LE(18);
  if (isElf && isElf64 && machine === ELF_MACHINE_X86_64) return;

  const magicHex = head.subarray(0, 4).toString("hex");
  throw new Error(
    `[build-zip] ${label} at ${path} is not a Linux x86-64 ELF executable ` +
      `(magic=0x${magicHex}, ei_class=${head[4]}, e_machine=0x${machine.toString(16)}). ` +
      `This usually means the deploy host's postinstall fetched a host-platform binary ` +
      `(e.g. macOS arm64 ffmpeg) instead of the linux/x64 binary Lambda needs. ` +
      `Re-run the build inside a linux/amd64 container, or pre-install with ` +
      `\`npm_config_platform=linux npm_config_arch=x64\` so the package fetches the right binary.`,
  );
}

function readFileHead(path: string, byteCount: number, label: string): Buffer {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(byteCount);
    const bytesRead = readSync(fd, buf, 0, byteCount, 0);
    if (bytesRead < byteCount) {
      throw new Error(
        `[build-zip] ${label} at ${path} is too short — read ${bytesRead} of ${byteCount} bytes.`,
      );
    }
    return buf;
  } finally {
    closeSync(fd);
  }
}

function stageFfmpeg(stagingDir: string): void {
  const binDir = join(stagingDir, "bin");
  mkdirSync(binDir, { recursive: true });

  // ffmpeg from `ffmpeg-static`. The package only ships the encoder
  // binary; the audio pad/trim path also needs ffprobe, which comes
  // from `ffprobe-static`.
  //
  // `ffmpeg-static`'s postinstall fetches a binary for the host platform
  // (e.g. arm64 Mach-O on Apple Silicon macOS). Lambda runs Linux x86-64,
  // so a build from a non-Linux host silently produces a zip that boots
  // but fails at first ffmpeg invocation with `cannot execute binary file`.
  // Verify the ELF header up front and bail with a clear message instead.
  const ffmpegBinary = join(resolveModuleDir("ffmpeg-static"), "ffmpeg");
  if (!existsSync(ffmpegBinary)) {
    throw new Error(
      `[build-zip] ffmpeg-static binary missing at ${ffmpegBinary}. Did postinstall run?`,
    );
  }
  assertLinuxX86_64Elf(ffmpegBinary, "ffmpeg-static binary");
  const ffmpegDest = join(binDir, "ffmpeg");
  cpSync(ffmpegBinary, ffmpegDest);
  chmodSync(ffmpegDest, 0o755);

  // ffprobe lives at `ffprobe-static/bin/<platform>/<arch>/ffprobe`.
  // The producer's `audioPadTrim` spawns `ffprobe` from PATH so we need
  // it alongside ffmpeg under /var/task/bin/.
  const ffprobeModule = resolveModuleDir("ffprobe-static");
  const ffprobeCandidates = [
    join(ffprobeModule, "bin", "linux", "x64", "ffprobe"),
    join(ffprobeModule, "bin", "linux", "arm64", "ffprobe"),
  ];
  const ffprobeBinary = ffprobeCandidates.find((p) => existsSync(p));
  if (!ffprobeBinary) {
    throw new Error(
      `[build-zip] ffprobe-static binary not found under ${ffprobeModule}/bin/linux/. Did postinstall run?`,
    );
  }
  const ffprobeDest = join(binDir, "ffprobe");
  cpSync(ffprobeBinary, ffprobeDest);
  chmodSync(ffprobeDest, 0o755);

  console.log(`[build-zip] staged ffmpeg + ffprobe → bin/`);
}

function stageChromeHeadlessShell(stagingDir: string): void {
  // The fallback path bundles the same chrome-headless-shell binary the
  // K8s deploy uses. The binary is fetched via `@puppeteer/browsers` on
  // first build into the host's `~/.cache/puppeteer/`; the build script
  // re-uses that cache rather than redownloading.
  const home = process.env.HOME ?? "/root";
  const baseDir = join(home, ".cache", "puppeteer", "chrome-headless-shell");
  if (!existsSync(baseDir)) {
    throw new Error(
      `[build-zip] chrome-headless-shell cache missing at ${baseDir}. Run\n` +
        `  npx --yes @puppeteer/browsers install chrome-headless-shell@stable --path ${home}/.cache/puppeteer\n` +
        `before --source=chrome-headless-shell.`,
    );
  }
  // Sort by numeric semver descending. `sort().reverse()` is lexicographic,
  // which silently picks "99.0.0" over "131.0.0" once Chrome ships
  // three-digit majors that aren't strictly width-aligned. `compareSemver`
  // returns negative/zero/positive on (a, b), so descending = `b - a`.
  const versions = readdirSync(baseDir).sort((a, b) => compareSemver(b, a));
  for (const v of versions) {
    const candidate = join(baseDir, v, "chrome-headless-shell-linux64", "chrome-headless-shell");
    if (existsSync(candidate)) {
      const dest = join(stagingDir, "bin", "chrome-headless-shell");
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(candidate, dest);
      chmodSync(dest, 0o755);
      console.log(`[build-zip] staged chrome-headless-shell (${v}) → bin/chrome-headless-shell`);
      return;
    }
  }
  throw new Error(`[build-zip] no linux64 chrome-headless-shell binary found under ${baseDir}.`);
}

/**
 * Compare two semver-shaped strings like "131.0.6778.108". Treats any
 * non-numeric directory name as `-Infinity` so it sorts to the bottom
 * (Puppeteer's cache layout sometimes includes `latest` or branch tags).
 * Used by `stageChromeHeadlessShell` to pick the newest cached Chrome
 * without tripping on the lexicographic "99 > 131" trap.
 */
function compareSemver(a: string, b: string): number {
  const partsA = a.split(".").map((s) => Number.parseInt(s, 10));
  const partsB = b.split(".").map((s) => Number.parseInt(s, 10));
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const ai = partsA[i] ?? 0;
    const bi = partsB[i] ?? 0;
    if (Number.isNaN(ai) && Number.isNaN(bi)) continue;
    if (Number.isNaN(ai)) return -1;
    if (Number.isNaN(bi)) return 1;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

function zipDirectory(sourceDir: string, zipPath: string): void {
  const result = spawnSync("zip", ["-rq", zipPath, "."], { cwd: sourceDir, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`[build-zip] zip exited with status ${result.status}`);
  }
}

function directorySizeBytes(dir: string): number {
  // Use spawnSync (no shell) instead of execSync so `dir` is passed as
  // an argv element rather than interpolated into a shell command —
  // CodeQL's `js/shell-command-injected-from-environment` rule fires
  // on the latter even with JSON-quoting. `du -sb` is Linux-only;
  // build-zip is CI-side where Linux coreutils is present.
  const result = spawnSync("du", ["-sb", dir], { encoding: "utf-8" });
  if (result.status === 0 && result.stdout) {
    const bytes = Number.parseInt(result.stdout.split(/\s+/)[0] ?? "0", 10);
    if (!Number.isNaN(bytes)) return bytes;
  }
  return walkSize(dir);
}

function walkSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += walkSize(full);
    else if (entry.isFile()) total += statSync(full).size;
  }
  return total;
}

void main().catch((err) => {
  console.error("[build-zip] failed:", err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
