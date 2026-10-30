// Skills freshness: give the HyperFrames skill bundle a content fingerprint so
// we can answer "are the installed skills the latest version?" across every
// agent platform (Claude Code, Codex, …) — independent of how they were
// installed.
//
// Why our own hash instead of the `skills-lock.json` `computedHash`: the
// vercel-labs/skills lock hashes only `SKILL.md` with an algorithm we can't
// recompute from source. A skill is a whole directory (SKILL.md + references/ +
// scripts/ + palettes/ + templates/), so we fingerprint the *entire* bundle.
// The same function hashes the source tree (to build the published manifest)
// and the installed tree (to compare) — so equal content ⇒ equal hash.
//
// The manifest is intentionally minimal — `{ source, skills }`, no version
// label or timestamp. Per-skill hashes are the source of truth for "current vs
// outdated", so a top-level version number would only add a second, confusable
// signal. The published manifest lives at the repo root (`skills-manifest.json`).

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// File extensions we treat as text — line endings are normalised (CRLF→LF)
// before hashing so a Windows checkout doesn't read as "outdated". Everything
// else is hashed as raw bytes.
const TEXT_EXT = new Set([
  ".md",
  ".txt",
  ".mjs",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".html",
  ".css",
  ".json",
  ".svg",
  ".csv",
  ".yml",
  ".yaml",
]);

export interface SkillEntry {
  /** Short sha256 (16 hex chars) over the skill's whole directory. */
  hash: string;
  /** Number of files in the bundle (for a quick human sanity signal). */
  files: number;
}

export interface SkillsManifest {
  /** Source repo, e.g. "heygen-com/hyperframes". */
  source: string;
  /** Per-skill fingerprint, keyed by skill name. */
  skills: Record<string, SkillEntry>;
}

export type SkillStatus = "current" | "outdated" | "missing";

export interface SkillDiff {
  name: string;
  status: SkillStatus;
  installedHash?: string;
  latestHash?: string;
}

/** The pure manifest diff (current / outdated / missing — what `diffSkills` returns). */
export interface SkillsDiff {
  updateAvailable: boolean;
  /** `coreMissing` ⊆ `missing`: the missing skills that are core (see "Skill tiers"). */
  summary: { current: number; outdated: number; missing: number; coreMissing: number };
  skills: SkillDiff[];
}

export interface SkillsCheckResult {
  /** Install location that was checked (absolute path), or null if none found. */
  location: string | null;
  /** Agent convention inferred from the location (claude-code, codex, …). */
  agent: string | null;
  /** Scope of the located install — so a caller prunes in the same scope it attributed from. */
  scope: "project" | "global" | null;
  updateAvailable: boolean;
  summary: {
    current: number;
    outdated: number;
    missing: number;
    coreMissing: number;
  };
  skills: SkillDiff[];
  /** Manifest-named skills the lock attributes to another publisher; left untouched. */
  foreign: string[];
}

const DEFAULT_REPO_SLUG = "heygen-com/hyperframes";
const REPO_SLUG_PATTERN = /^[\w.-]+\/[\w.-]+$/;
/** Manifest filename, published at the repo root. */
export const MANIFEST_FILE = "skills-manifest.json";
const FETCH_TIMEOUT_MS = 4000;

// ── Skill tiers ──────────────────────────────────────────────────────────────
//
// Two tiers decide what installs eagerly vs on demand:
//
//   core     — the `/hyperframes` entry skill plus the shared skills
//              (`hyperframes-*`, `media-use`) every other skill references
//              structurally (sibling `../hyperframes/references/…` paths,
//              "call /media-use" preambles). These must be present and current
//              for any video work, so `init` / `skills update` keep them fresh.
//   on-demand — everything else: decks (slideshow), Remotion ports
//              (remotion-to-hyperframes) and optional integrations (figma).
//              They install when named (`hyperframes skills update <name>`),
//              instead of being sprayed onto every machine that runs `init`.

/** The entry skill — read first for any video request. */
const ENTRY_SKILL = "hyperframes";

/** True for skills every other skill depends on (see "Skill tiers" above). */
export function isCoreSkill(name: string): boolean {
  return name === ENTRY_SKILL || name.startsWith("hyperframes-") || name === "media-use";
}

/**
 * Pinned enumeration of the core tier, used ONLY when the live manifest is
 * unreachable (offline / rate-limited): isCoreSkill is a pattern, and a
 * pattern can't be enumerated without a name list. Best-effort by design —
 * if this lags the skills/ tree, the degraded path misses (or over-asks for)
 * a core skill until the next release, and the online path self-corrects on
 * the next run. A unit test pins this list to the repo's skills/ tree so it
 * can't drift silently; update it when core membership changes.
 */
export const FALLBACK_CORE_SKILLS: readonly string[] = [
  "hyperframes",
  "hyperframes-cli",
  "hyperframes-registry",
  "media-use",
];

/**
 * Domain skills folded into the `hyperframes` and `media-use` skills. Their
 * `hyperframes-` prefix makes them ours by name, so an on-disk bundle with no
 * lock entry is removed too.
 */
const RETIRED_DOMAIN_SKILLS: readonly string[] = [
  "hyperframes-animation",
  "hyperframes-audio",
  "hyperframes-core",
  "hyperframes-creative",
  "hyperframes-keyframes",
  "hyperframes-studio",
];

/**
 * Workflow skills retired when their knowledge moved into the `hyperframes`
 * skill's references (film, captions, overlays, motion, look). Their names are
 * generic, so only a lock entry attributing them to our source marks them ours.
 */
const RETIRED_WORKFLOW_SKILLS: readonly string[] = [
  "embedded-captions",
  "faceless-explainer",
  "general-video",
  "motion-graphics",
  "music-to-video",
  "pr-to-video",
  "product-launch-video",
  "talking-head-recut",
];

/**
 * Skills no longer published. Machines that installed them still carry the old
 * bundles; detectRemoved flags these names whenever the manifest no longer
 * lists them, so `skills update` removes them, and naming one in
 * `skills update <name>` explains where its knowledge went instead of failing.
 */
export const RETIRED_SKILLS: readonly string[] = [
  ...RETIRED_DOMAIN_SKILLS,
  ...RETIRED_WORKFLOW_SKILLS,
];

/** Where a retired skill's knowledge lives now, for `skills update <retired-name>`. */
export function retiredSkillNotice(name: string): string {
  const home =
    name === "hyperframes-audio"
      ? "the /media-use skill (references/mixing.md)"
      : "the /hyperframes skill and its references (film, captions, overlays, motion, look, format)";
  return `${name} was retired; its knowledge now lives in ${home}, which \`skills update\` keeps current.`;
}

// ── Hashing ────────────────────────────────────────────────────────────────

// By-products of using a skill (bytecode from running its scripts, installs, OS
// and editor files), skipped on both the source and the installed side so a
// tree that ran a script hashes the same as a clean checkout.
const RUNTIME_DIRS = new Set([
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "node_modules",
]);
const RUNTIME_FILES = new Set([".DS_Store", "Thumbs.db"]);
const RUNTIME_FILE_SUFFIXES = [".pyc", ".pyo", ".swp", ".swo", "~"];

function isRuntimeFile(name: string): boolean {
  return RUNTIME_FILES.has(name) || RUNTIME_FILE_SUFFIXES.some((s) => name.endsWith(s));
}

function listFilesSorted(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        if (!RUNTIME_DIRS.has(name)) walk(p);
      } else if (!isRuntimeFile(name)) {
        out.push(p);
      }
    }
  };
  walk(dir);
  // Sorting the full path list once is what guarantees a deterministic,
  // filesystem-order-independent hash — no need to also sort per directory.
  return out.sort();
}

/**
 * Fingerprint one skill directory. Deterministic: files are sorted by relative
 * POSIX path, text files are line-ending normalised, and the relative path is
 * folded into the hash so a moved file changes the fingerprint.
 */
export function hashSkillBundle(skillDir: string): SkillEntry {
  const files = listFilesSorted(skillDir);
  const h = createHash("sha256");
  for (const f of files) {
    const rel = relative(skillDir, f).split(sep).join("/");
    h.update(rel);
    h.update("\0");
    const ext = rel.slice(rel.lastIndexOf("."));
    const buf = readFileSync(f);
    if (TEXT_EXT.has(ext)) h.update(buf.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
    else h.update(buf);
    h.update("\0");
  }
  return { hash: h.digest("hex").slice(0, 16), files: files.length };
}

/**
 * Build a manifest from a `skills/` root directory (a folder of
 * `<name>/SKILL.md` skill bundles). Used by the manifest generator. Output is
 * fully deterministic — same content in, byte-identical manifest out.
 */
export function buildManifest(skillsRoot: string, meta: { source: string }): SkillsManifest {
  const names = readdirSync(skillsRoot)
    .filter((n) => existsSync(join(skillsRoot, n, "SKILL.md")))
    .sort();
  const skills: Record<string, SkillEntry> = {};
  for (const name of names) skills[name] = hashSkillBundle(join(skillsRoot, name));
  return { source: meta.source, skills };
}

// ── Locating installed skills ────────────────────────────────────────────────

interface SkillRoot {
  /** Absolute path to a `.../skills` directory. */
  dir: string;
  /** Agent convention this directory belongs to. */
  agent: string;
  /** project = under cwd, global = under $HOME. */
  scope: "project" | "global";
}

/**
 * Map a host directory name to an agent label: ".claude" → "claude-code",
 * ".factory" → "factory", "opencode" (under .config) → "opencode".
 */
function agentLabel(hostDir: string): string {
  const name = hostDir.replace(/^\.+/, "");
  return name === "claude" ? "claude-code" : name || "unknown";
}

/** Infer the agent from a `.../skills` path by its host segment (the dir above "skills"). */
function agentFromDir(dir: string): string {
  const parts = dir.split(sep).filter(Boolean);
  const i = parts.lastIndexOf("skills");
  return agentLabel(i > 0 ? parts[i - 1]! : (parts[parts.length - 1] ?? ""));
}

/** Immediate subdirectory names of `dir` (including symlinked dirs); [] if unreadable. */
function listSubdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Auto-discover candidate `<host>/skills` dirs under a scope base instead of
 * enumerating a fixed list of agents. The upstream `skills` CLI installs into
 * 70+ agent conventions; each lands as `<base>/<host>/skills` (or the XDG
 * `<base>/.config/<host>/skills`), so we find them by structure — future-proof
 * as upstream adds agents. claude-code is ordered first; the rest
 * deterministically by agent then path.
 */
function discoverSkillRoots(base: string, scope: "project" | "global"): SkillRoot[] {
  const candidates: SkillRoot[] = [];
  const add = (hostBase: string, host: string): void => {
    const dir = join(hostBase, host, "skills");
    if (existsSync(dir) && statSync(dir).isDirectory())
      candidates.push({ dir, agent: agentLabel(host), scope });
  };
  for (const host of listSubdirs(base)) add(base, host);
  const xdg = join(base, ".config");
  for (const host of listSubdirs(xdg)) add(xdg, host);
  return candidates.sort((a, b) => {
    if (a.agent !== b.agent) {
      if (a.agent === "claude-code") return -1;
      if (b.agent === "claude-code") return 1;
      return a.agent.localeCompare(b.agent);
    }
    return a.dir.localeCompare(b.dir);
  });
}

/**
 * Decide whether an explicit `--dir` is a project- or global-scoped install, so
 * lock attribution reads the *right* lock. The upstream `skills` CLI keeps two
 * locks: a project lock at `<cwd>/skills-lock.json` and a global lock under
 * `$HOME` (see lockPathForScope).
 *
 * Precedence is CWD-containment FIRST, then HOME — because the common
 * project-local case is *also* under `$HOME` (e.g. `~/work/proj/.claude/skills`,
 * or `--dir .claude/skills` run from `~/work/proj`). Checking HOME first would
 * misclassify every such project install as global, reading the wrong lock and
 * (worse) letting `skills update` prune with `-g`. So:
 *   - `dir` under `cwd`  → project (even when that's also under $HOME)
 *   - else `dir` under $HOME → global (a real `~/.claude/skills`-style install)
 *   - else → project (safe default — never prune globally for an unknown path)
 *
 * Each base is normalised with a trailing separator before the prefix test so a
 * sibling like `/home/user2` doesn't false-match `/home/user`.
 */
function scopeForDir(dir: string, home: string, cwd: string): "project" | "global" {
  const norm = (p: string): string => {
    const r = resolve(p);
    return r.endsWith(sep) ? r : r + sep;
  };
  const d = norm(dir);
  if (d.startsWith(norm(cwd))) return "project";
  if (d.startsWith(norm(home))) return "global";
  return "project";
}

/**
 * Find the first skill root that actually contains HyperFrames skills. A
 * `--dir` override (if given) is treated as a `.../skills` directory directly;
 * its scope is inferred (see scopeForDir) so lock attribution reads the right
 * lock. Otherwise scan global ($HOME) then project (cwd), auto-discovering hosts.
 *
 * Global is checked FIRST to match how agents actually load skills: Claude Code
 * (and most others) give the personal/global scope priority over the project
 * scope, and HyperFrames now installs globally. Checking global-first means
 * `check` reports on the copy the agent will really use — not a stale project
 * copy that a newer global install silently overrides.
 */
function locateInstall(
  skillNames: string[],
  opts: { dir?: string; cwd?: string; home?: string } = {},
): SkillRoot | null {
  if (opts.dir) {
    return existsSync(opts.dir)
      ? {
          dir: opts.dir,
          agent: agentFromDir(opts.dir),
          scope: scopeForDir(opts.dir, opts.home ?? homedir(), opts.cwd ?? process.cwd()),
        }
      : null;
  }
  const roots = [
    ...discoverSkillRoots(opts.home ?? homedir(), "global"),
    ...discoverSkillRoots(opts.cwd ?? process.cwd(), "project"),
  ];
  for (const root of roots) {
    if (skillNames.some((n) => existsSync(join(root.dir, n, "SKILL.md")))) return root;
  }
  return null;
}

/**
 * Names from `skillNames` that are present (their SKILL.md exists) in the
 * located install. Local-only — no manifest fetch — so callers can verify the
 * presence half of an install guarantee even when GitHub is unreachable.
 */
export function presentSkills(
  skillNames: readonly string[],
  opts: { dir?: string; cwd?: string; home?: string } = {},
): string[] {
  const root = locateInstall([...skillNames], opts);
  if (!root) return [];
  return skillNames.filter((name) => existsSync(join(root.dir, name, "SKILL.md")));
}

/** Hash every manifest skill that is installed under `root`. */
function hashInstalled(root: SkillRoot, skillNames: string[]): Record<string, SkillEntry> {
  const out: Record<string, SkillEntry> = {};
  for (const name of skillNames) {
    const skillDir = join(root.dir, name);
    if (existsSync(join(skillDir, "SKILL.md"))) out[name] = hashSkillBundle(skillDir);
  }
  return out;
}

// ── Diff ─────────────────────────────────────────────────────────────────────

export function diffSkills(
  installed: Record<string, SkillEntry>,
  latest: SkillsManifest,
): SkillsDiff {
  // Report only on skills the manifest knows about. A skill on disk that isn't
  // in the manifest is handled separately (see detectRemoved): we can only call
  // one "ours but removed" via the lock's source attribution, never the bare
  // directory name — `.../skills` is shared across sources.
  const skills: SkillDiff[] = [];
  const summary = { current: 0, outdated: 0, missing: 0, coreMissing: 0 };

  for (const name of Object.keys(latest.skills).sort()) {
    const latestEntry = latest.skills[name]!;
    const installedEntry = installed[name];
    let status: SkillStatus;
    if (!installedEntry) status = "missing";
    else if (installedEntry.hash === latestEntry.hash) status = "current";
    else status = "outdated";

    if (status === "current") summary.current++;
    else if (status === "outdated") summary.outdated++;
    else {
      summary.missing++;
      if (isCoreSkill(name)) summary.coreMissing++;
    }

    skills.push({
      name,
      status,
      installedHash: installedEntry?.hash,
      latestHash: latestEntry.hash,
    });
  }

  return {
    // "Update available" means the install is stale, not merely partial:
    // anything installed-but-outdated, or a missing CORE skill (the entry
    // router + shared domain skills every workflow needs). A missing
    // on-demand skill is NOT an update — it installs when its workflow is
    // triggered (`hyperframes skills update <name>`). Counting it here is what
    // used to make `init` re-pull the full skill set onto machines that
    // deliberately installed a subset.
    updateAvailable: summary.outdated > 0 || summary.coreMissing > 0,
    summary,
    skills,
  };
}

// ── Install record (lock) ────────────────────────────────────────────────────
//
// The vercel-labs/skills lock records which source each installed skill came
// from. `.../skills` is shared across sources, so a skill is never called ours
// from its directory name alone.

interface LockEntry {
  source?: string;
  sourceUrl?: string;
}

/** The slice of the vercel-labs/skills lock file we read. */
export interface SkillLock {
  skills?: Record<string, LockEntry>;
}

/** Normalise a slug or git clone URL to a bare lowercase `owner/repo`. */
function repoSlug(s: string | undefined): string {
  return (s ?? "")
    .replace(/^git\+/, "")
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .toLowerCase();
}

/** Skill names the lock attributes to `source` (matched by slug or clone URL). */
export function skillsAttributedToSource(lock: SkillLock | null, source: string): string[] {
  const want = repoSlug(source);
  if (!want || !lock?.skills) return [];
  return Object.entries(lock.skills)
    .filter(([, e]) => repoSlug(e.source) === want || repoSlug(e.sourceUrl) === want)
    .map(([name]) => name);
}

/**
 * The lock records another publisher as the skill's source. A skill with no
 * lock entry is not "from another source": provenance is unknown, not foreign.
 */
function isFromOtherSource(entry: LockEntry | undefined, source: string): boolean {
  const recorded = [repoSlug(entry?.source), repoSlug(entry?.sourceUrl)].filter(Boolean);
  return recorded.length > 0 && !recorded.includes(repoSlug(source));
}

// Lock locations, verified against vercel-labs/skills@v1.5.13 (src/skill-lock.ts,
// src/local-lock.ts); re-check them when bumping:
//   - global:  $XDG_STATE_HOME/skills/.skill-lock.json  else  ~/.agents/.skill-lock.json
//   - project: <cwd>/skills-lock.json
/** Locate the vercel-labs/skills lock for a scope. */
function lockPathForScope(
  scope: "project" | "global",
  opts: { cwd?: string; home?: string },
): string {
  if (scope === "project") return join(opts.cwd ?? process.cwd(), "skills-lock.json");
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) return join(xdgStateHome, "skills", ".skill-lock.json");
  return join(opts.home ?? homedir(), ".agents", ".skill-lock.json");
}

function readSkillLock(path: string): SkillLock | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SkillLock;
  } catch {
    // No lock (or unreadable / not JSON) → we can't attribute, so report none.
    return null;
  }
}

/**
 * The skill names the upstream lock attributes to HyperFrames, for a scope.
 * The mirror MUST scope by this — never by listing `~/.claude/skills`, which is
 * shared across sources, so a directory listing would fan a user's gstack /
 * personal / company skills out to every agent. Same source-attribution the
 * prune uses. Empty when the lock is absent (we can't attribute → mirror none).
 */
export function hyperframesSkillNames(opts: {
  scope: "project" | "global";
  cwd?: string;
  home?: string;
}): string[] {
  const lockPath = lockPathForScope(opts.scope, { cwd: opts.cwd, home: opts.home });
  return skillsAttributedToSource(readSkillLock(lockPath), DEFAULT_REPO_SLUG);
}

// ── Resolving the "latest" manifest ──────────────────────────────────────────

/** Walk up from `cwd` to find a repo checkout that ships the manifest. */
function findRepoManifest(cwd = process.cwd()): string | null {
  let dir = cwd;
  // Bounded climb (deep monorepos / nested worktrees) — stops early at the FS root.
  for (let i = 0; i < 16; i++) {
    const p = join(dir, MANIFEST_FILE);
    if (existsSync(p)) return p;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Narrow an untrusted JSON payload to a SkillsManifest, or throw a clear error.
 * Guards against a CDN serving an error page (or a malformed manifest) as 200 —
 * without this, a bad shape surfaces later as a cryptic crash in diffSkills.
 */
function asSkillsManifest(data: unknown, sourceLabel: string): SkillsManifest {
  const m = data as Partial<SkillsManifest> | null;
  if (!m || typeof m !== "object" || typeof m.skills !== "object" || m.skills === null) {
    throw new Error(`Malformed skills manifest from ${sourceLabel}`);
  }
  return m as SkillsManifest;
}

async function fetchManifest(url: string): Promise<SkillsManifest> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Connection: "close" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return asSkillsManifest(await res.json(), url);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolve main's live HEAD sha via `git ls-remote`: the branch-raw CDN can serve
 * stale content for minutes after a push, a SHA-pinned raw URL cannot. Returns
 * null for a slug that is not `owner/repo`, or when git/network is unavailable.
 *
 * GIT_TERMINAL_PROMPT=0 does not stop credential helpers or askpass, and Git
 * Credential Manager (the Git for Windows default) answers a private or missing
 * repo's auth challenge with a blocking sign-in window. An empty credential.helper
 * clears every helper; an empty GIT_ASKPASS also skips core.askPass and SSH_ASKPASS.
 */
async function remoteHeadSha(repoSlug: string): Promise<string | null> {
  if (!REPO_SLUG_PATTERN.test(repoSlug)) return null;
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "-c",
        "credential.helper=",
        "ls-remote",
        `https://github.com/${repoSlug}.git`,
        "refs/heads/main",
      ],
      {
        timeout: FETCH_TIMEOUT_MS,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "",
          GCM_INTERACTIVE: "never",
        },
        windowsHide: true,
      },
    );
    const sha = stdout.split(/\s+/)[0]?.trim() ?? "";
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/** Read a manifest from a local path — a manifest file or a repo root. */
function resolveLocalManifest(source: string): SkillsManifest {
  const direct = source.endsWith(".json") ? source : join(source, MANIFEST_FILE);
  if (existsSync(direct)) return JSON.parse(readFileSync(direct, "utf8")) as SkillsManifest;
  // Fall back to computing from a skills/ tree on disk.
  const skillsRoot = source.endsWith("skills") ? source : join(source, "skills");
  if (existsSync(skillsRoot)) return buildManifest(skillsRoot, { source: skillsRoot });
  throw new Error(`No skills manifest found at: ${source}`);
}

/**
 * Fetch the manifest from GitHub. A full URL is fetched directly; an
 * `owner/repo` slug (or the default repo) is SHA-pinned via `git ls-remote` to
 * dodge raw-CDN lag, falling back to the branch URL when git is unavailable.
 */
async function fetchRemoteManifest(source?: string): Promise<SkillsManifest> {
  if (source?.startsWith("http")) return fetchManifest(source);

  const repoSlug = source ?? DEFAULT_REPO_SLUG;
  const sha = await remoteHeadSha(repoSlug);
  if (sha) {
    try {
      return await fetchManifest(
        `https://raw.githubusercontent.com/${repoSlug}/${sha}/${MANIFEST_FILE}`,
      );
    } catch {
      /* fall through to the branch URL */
    }
  }
  return fetchManifest(`https://raw.githubusercontent.com/${repoSlug}/main/${MANIFEST_FILE}`);
}

/**
 * Resolve the latest manifest. `source` may be:
 *   - undefined → in-repo manifest if present (dev / CI), else fetch from GitHub
 *   - a local path to a manifest file or a repo root containing `skills/`
 *   - an `owner/repo` slug or full URL → fetched from GitHub
 *
 * `canonical: true` skips the in-repo shortcut (the `!source` branch below)
 * even when one is found, and always resolves over the network instead. Use
 * it for any decision that must match what `skills add` actually installs
 * from — the canonical published repo — never a local checkout's manifest,
 * which can be stale (e.g. still listing a skill that was retired/renamed
 * upstream since that checkout's last pull). An explicit local `source`
 * override is a deliberate caller choice and still wins regardless of
 * `canonical`.
 */
async function resolveLatestManifest(
  source?: string,
  cwd = process.cwd(),
  opts: { canonical?: boolean } = {},
): Promise<SkillsManifest> {
  // A local path is a relative one (./ ../) or an absolute one — isAbsolute
  // covers POSIX `/…` and Windows `C:\…` / `\…` on their respective platforms.
  if (source && (source.startsWith(".") || isAbsolute(source))) {
    return resolveLocalManifest(source);
  }
  if (!source && !opts.canonical) {
    const repoManifest = findRepoManifest(cwd);
    if (repoManifest) return JSON.parse(readFileSync(repoManifest, "utf8")) as SkillsManifest;
  }
  return fetchRemoteManifest(source);
}

/**
 * End-to-end check: locate the install, hash it, diff against the latest
 * manifest. Pure-ish (network only via `resolveLatestManifest`).
 */
export async function checkSkills(
  opts: {
    dir?: string;
    source?: string;
    cwd?: string;
    home?: string;
    /** See resolveLatestManifest — bypass the in-repo manifest shortcut. */
    canonical?: boolean;
  } = {},
): Promise<SkillsCheckResult> {
  const latest = await resolveLatestManifest(opts.source, opts.cwd, { canonical: opts.canonical });
  const skillNames = Object.keys(latest.skills);
  const root = locateInstall(skillNames, { dir: opts.dir, cwd: opts.cwd, home: opts.home });
  // A directory sharing a name with one of ours can belong to another publisher.
  // The lock says so; such a skill is never compared, refreshed or overwritten.
  const lock = root ? readSkillLock(lockPathForScope(root.scope, opts)) : null;
  const foreign = root
    ? skillNames.filter(
        (name) =>
          existsSync(join(root.dir, name, "SKILL.md")) &&
          isFromOtherSource(lock?.skills?.[name], latest.source),
      )
    : [];
  const ours = skillNames.filter((name) => !foreign.includes(name));
  const installed = root ? hashInstalled(root, ours) : {};
  const diff = diffSkills(installed, {
    ...latest,
    skills: Object.fromEntries(ours.map((name) => [name, latest.skills[name]!])),
  });
  return {
    location: root?.dir ?? null,
    agent: root?.agent ?? null,
    scope: root?.scope ?? null,
    updateAvailable: diff.updateAvailable,
    summary: diff.summary,
    skills: diff.skills,
    foreign,
  };
}
