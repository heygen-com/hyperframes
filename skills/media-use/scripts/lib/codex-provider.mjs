import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Image generation via the OpenAI Codex CLI's built-in image tool (gpt-image-2)
// on the user's ChatGPT subscription: the codex CLI owns auth, media-use holds
// no key (CLI-only). The image UPSELL behind local mflux; skipped by --local-only.
//
// Retrieval mirrors illo-skill rather than trusting the model to save a file:
// `--enable imagegenext` makes the built-in tool drop the rendered artifact into
// $CODEX_HOME/generated_images/, and we fetch the freshest file that postdates
// this run. The save-to-path instruction is only a best-effort verify-first.

const TIMEOUT_MS = 600000; // codex exec round-trips the sub; first-run tool spin-up is slow
const MTIME_SKEW_MS = 2000; // tolerate mtime granularity / clock skew (illo uses 2s)

function codexGeneratedDir() {
  // Codex relocates CODEX_HOME on some hosts, so resolve it at run time.
  return join(process.env.CODEX_HOME || join(homedir(), ".codex"), "generated_images");
}

// Newest artifact that postdates `sinceMs` (minus skew), so a stale prior render
// or a concurrent session's file can't be mistaken for this run's output.
function freshestGeneratedImage(sinceMs) {
  const dir = codexGeneratedDir();
  if (!existsSync(dir)) return null;
  const floor = sinceMs - MTIME_SKEW_MS;
  let best = null;
  for (const name of readdirSync(dir)) {
    let st;
    try {
      st = statSync(join(dir, name));
    } catch {
      continue;
    }
    if (!st.isFile() || st.mtimeMs < floor) continue;
    if (!best || st.mtimeMs > best.mtimeMs) best = { path: join(dir, name), mtimeMs: st.mtimeMs };
  }
  return best?.path ?? null;
}

// Short `codex` subcommand → combined stdout+stderr, or null if it can't run.
function codexRun(args) {
  try {
    return execFileSync("codex", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
    });
  } catch (err) {
    return `${err.stdout?.toString() ?? ""}${err.stderr?.toString() ?? ""}` || null;
  }
}

// Fail-fast host check (mirrors illo): don't burn a minutes-long exec when Codex
// isn't usable. Returns null when ready, else a human reason. imagegenext ships
// default-disabled ("under development"), so we check the ROW is present (the
// capability signal) — the exec enables it per-render with --enable.
function codexUnavailableReason() {
  try {
    const which = process.platform === "win32" ? "where" : "which";
    execFileSync(which, ["codex"], { stdio: ["ignore", "ignore", "ignore"], timeout: 5000 });
  } catch {
    return "codex CLI not on PATH";
  }
  // Auth marker: presence of the credentials file, NOT `codex login status`.
  // That command prints "Logged in using ChatGPT" only to a human stream
  // (stderr / TTY) and exits 0, so its piped stdout — how media-use spawns it —
  // is empty, and the gate falsely reported "not logged in", blocking codex
  // image gen in every headless / CI / agent run even when fully authed.
  // auth.json is the durable, TTY-independent signal; token validity is proven
  // by the exec itself, which fails cleanly if the login is stale.
  const authPath = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json");
  if (!existsSync(authPath)) return "codex not logged in (run: codex login)";
  const feats = codexRun(["features", "list"]);
  if (feats == null) return "could not read `codex features list`";
  if (!/\bimage_generation\b/.test(feats)) return "codex image_generation feature unavailable";
  if (!/\bimagegenext\b/.test(feats)) return "codex imagegenext unavailable (upgrade Codex CLI)";
  return null;
}

export async function codexImageGenerate(intent) {
  const unavailable = codexUnavailableReason();
  if (unavailable) {
    console.error(`media-use: codex image upsell unavailable: ${unavailable}`);
    return null;
  }
  const outPath = join(tmpdir(), `media-use-codex-${process.pid}-${Date.now()}.png`);
  const prompt =
    `${intent}\n\n` +
    `Use your built-in image generation tool to render this, then save the image ` +
    `to ${outPath} (overwrite if it exists). Do not ask for confirmation. ` +
    `If you have no built-in image tool, do nothing (no PIL/matplotlib/SVG substitute).`;
  try {
    unlinkSync(outPath); // clear any prior file so verify-first can't accept a stale render
  } catch {
    /* no prior file */
  }
  const started = Date.now();
  try {
    execFileSync(
      "codex",
      [
        "exec",
        "--cd",
        tmpdir(),
        "-s",
        "workspace-write",
        "--skip-git-repo-check",
        "--enable",
        "imagegenext",
        "-",
      ],
      { input: prompt, encoding: "utf8", timeout: TIMEOUT_MS, stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch (err) {
    console.error(
      `media-use: \`codex exec\` image generation failed: ${err.stderr?.toString().trim().slice(-200) || err.message}`,
    );
    return null;
  }
  // Verify-first (save-to-path may have worked), else fetch the imagegenext artifact.
  const produced =
    existsSync(outPath) && statSync(outPath).size > 0 ? outPath : freshestGeneratedImage(started);
  if (!produced) return null;
  if (produced !== outPath) {
    try {
      copyFileSync(produced, outPath);
    } catch {
      return null;
    }
  }
  return {
    localPath: outPath,
    ext: ".png",
    source: "generated",
    metadata: { description: intent, provider: "codex.image_gen", provenance: { prompt: intent } },
  };
}
