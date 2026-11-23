import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { makeOutputFolder } from "../utils/outputFolder.js";
import { recordFolder } from "../utils/projectRecords.js";
import { processIsAlive } from "../utils/processTree.js";
import { basename, dirname, join, resolve } from "node:path";
import { resolveCloudAuthHeaders } from "../cloud/auth.js";
import { billingBaseUrl } from "../heygen/plan.js";
import { terminalText } from "@hyperframes/core";
import { c } from "../ui/colors.js";
import { failCommand } from "../utils/commandResult.js";
import { printFailureLine } from "../utils/jsonError.js";
import { fetchExplained, NetworkFailure } from "../utils/networkFailure.js";
import { defineCommand } from "../utils/defineCommand.js";
import { projectConfigPath, seedProjectAuthoringSkill } from "../utils/projectConfig.js";
import { trackSkillCommandRan } from "../telemetry/events.js";
import { createStagingDir, replaceFileAtomically } from "@hyperframes/core/atomic-file";
import { hyperframesCacheDir } from "@hyperframes/core/cache-dir";

const STYLE_SAMPLING = "style-sampling";

export interface TemplatePack {
  /** The private bundle's id on the plan-gated route. */
  id: string;
  sha256: string;
  bytes: number;
}

// ponytail: packs are pinned here, so a new pack ships with a CLI release; move to a public index if templates change faster.
export const TEMPLATES: Record<string, TemplatePack> = {
  "animated-science-explainer": {
    id: "M9003",
    sha256: "205011f9ed345db786a611bfff43036e6c971368420c87120ff376a7797a26ee",
    bytes: 25535379,
  },
  "finance-explainer": {
    id: "M9002",
    sha256: "e8ace0e0e4fe8219010ce01e7ca1eae6ab03741d6eb60140e0b2a4ff9628dd30",
    bytes: 140485130,
  },
  "3d-true-crime": {
    id: "M9005",
    sha256: "2c27e08dd83984c0470f3c4f9f0c94f2b4528bbc27160312bbda580e89a43d63",
    bytes: 6544517,
  },
  "collage-explainer": {
    id: "M9001",
    sha256: "bb9f71ee3b27cc046e161e53d9c6c7bd7ce9a6d6b6f41acc01da4eb455a63230",
    bytes: 36702348,
  },
  "3d-brand-explainer": {
    id: "M9004",
    sha256: "33bbabcf94db88bedf0f2ef97331a7a34dff4ba6d5b09846ec759600b99d15ae",
    bytes: 20126308,
  },
};

/** A pull that stopped, with the one line the agent relays. Nothing was written. */
export class PullRefused extends Error {}

const LINK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 20 * 60_000;

async function bundleUrl(pack: TemplatePack, retries = 1): Promise<string> {
  const headers = await resolveCloudAuthHeaders().catch((error: unknown) => {
    if (error instanceof NetworkFailure) throw error;
    throw new PullRefused("Not signed in. Run `npx hyperframes auth login`.");
  });
  const route = `${billingBaseUrl()}/v1/hyperframes/moments/${pack.id}/bundle?sha256=${pack.sha256}`;
  const res = await fetchExplained(route, {
    headers: { ...headers, accept: "application/json" },
    signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
  });
  if (res.status === 503 && retries > 0) return bundleUrl(pack, retries - 1);
  if (res.status === 401) throw new PullRefused("Not signed in. Run `npx hyperframes auth login`.");
  if (res.status === 402)
    throw new PullRefused(
      "Creator templates are part of HyperFrames Pro; nothing was downloaded. Run `npx hyperframes billing subscribe --feature templates --skill style-sampling`: it opens the page and waits.",
    );
  if (res.status === 404) throw new PullRefused("That template version is no longer available.");
  if (!res.ok) throw new PullRefused(`HeyGen could not hand over the template (${res.status}).`);
  const body = (await res.json()) as { data?: { url?: string } };
  if (!body.data?.url) throw new PullRefused("HeyGen answered without a download link.");
  return body.data.url;
}

async function download(url: string, pack: TemplatePack): Promise<Buffer> {
  const res = await fetchExplained(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new PullRefused(`The download failed (${res.status}). Run it again.`);
  const data = Buffer.from(await res.arrayBuffer());
  const sha256 = createHash("sha256").update(data).digest("hex");
  if (data.length !== pack.bytes || sha256 !== pack.sha256)
    throw new PullRefused("The download does not match the template's hash; nothing was unpacked.");
  return data;
}

const PLAIN_FILE_OR_FOLDER_LISTING = /^[-d]/;

function assertSafeEntries(data: Buffer): void {
  const names = execFileSync("tar", ["-tzf", "-"], {
    input: data,
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  for (const name of names.split("\n"))
    if (name.startsWith("/") || name.split("/").includes(".."))
      throw new PullRefused(`The template holds an unsafe path (${name}); nothing was unpacked.`);
  const kinds = execFileSync("tar", ["-tvzf", "-"], {
    input: data,
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  for (const line of kinds.split("\n"))
    if (line && !PLAIN_FILE_OR_FOLDER_LISTING.test(line))
      throw new PullRefused("The template holds a link or special file; nothing was unpacked.");
}

const PULLED_HASH = ".template-sha256";

const extract = (data: Buffer, out: string) =>
  new Promise<void>((done, fail) => {
    const tar = execFile("tar", ["-xzf", "-", "-C", out, "--no-same-owner"], (error) =>
      error ? fail(error) : done(),
    );
    tar.stdin?.end(data);
  });
const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

function removeOnStop(work: string): () => void {
  const handlers = STOP_SIGNALS.map((signal) => {
    const handler = (): void => {
      rmSync(work, { recursive: true, force: true });
      stopWatching();
      process.kill(process.pid, signal);
    };
    process.once(signal, handler);
    return [signal, handler] as const;
  });
  const stopWatching = (): void => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
  return stopWatching;
}

const partPrefix = (dest: string) => `${basename(dest)}.part-`;
const PULL_MARKER = ".hyperframes-pull.json";
const PULL_OWNER = "hyperframes templates pull";

function pidInPartName(name: string, dest: string): number | null {
  if (!name.startsWith(partPrefix(dest))) return null;
  const match = /^(\d+)-[A-Za-z0-9]{6}$/.exec(name.slice(partPrefix(dest).length));
  return match ? Number(match[1]) : null;
}

function readPullMarker(path: string): unknown {
  let fd: number | undefined;
  try {
    fd = openSync(join(path, PULL_MARKER), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    return fstatSync(fd).isFile() ? JSON.parse(readFileSync(fd, "utf8")) : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const hasMarkerFields = (value: unknown): value is { owner: unknown; pid: unknown } =>
  typeof value === "object" && value !== null && "owner" in value && "pid" in value;

const markedBy = (marker: unknown, pid: number): boolean =>
  hasMarkerFields(marker) && marker.owner === PULL_OWNER && marker.pid === pid;

/** The pid of the pull that made `path`, read from the marker it wrote; null for anything this CLI did not make. */
function pullOwner(path: string, name: string, dest: string): number | null {
  const pid = pidInPartName(name, dest);
  return pid !== null && markedBy(readPullMarker(path), pid) ? pid : null;
}

function removeAbandonedParts(stage: string, dest: string): void {
  if (!existsSync(stage)) return;
  for (const entry of readdirSync(stage, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(stage, entry.name);
    const pid = pullOwner(path, entry.name, dest);
    if (pid !== null && !processIsAlive(pid)) rmSync(path, { recursive: true, force: true });
  }
}

/** Unpacks in `stage`, which watchers skip (a held file fails the rename on Windows), then moves it in whole. */
async function unpack(
  data: Buffer,
  dest: string,
  stage: string,
  pack: TemplatePack,
): Promise<string | null> {
  makeOutputFolder(dirname(dest));
  removeAbandonedParts(stage, dest);
  const work = createStagingDir(stage, `${partPrefix(dest)}${process.pid}-`);
  const stopWatching = removeOnStop(work);
  try {
    writeFileSync(join(work, PULL_MARKER), JSON.stringify({ owner: PULL_OWNER, pid: process.pid }));
    const out = join(work, "template");
    assertSafeEntries(data);
    mkdirSync(out);
    await extract(data, out);
    writeFileSync(join(out, PULLED_HASH), pack.sha256);
    const verified = listKit(out);
    if (!verified)
      throw new PullRefused("The template holds a link or special file; nothing was unpacked.");
    saveManifest(pack, verified);
    return install(out, dest, verified);
  } finally {
    stopWatching();
    rmSync(work, { recursive: true, force: true });
  }
}

function install(out: string, dest: string, verified: KitManifest): string | null {
  if (sameKit(listKit(dest), verified)) return null;
  const aside = moveAside(dest);
  try {
    renameSync(out, dest);
  } catch (error) {
    if (aside) renameSync(aside, dest);
    throw error;
  }
  return aside;
}

function moveAside(dest: string): string | null {
  const found = lstatSync(dest, { throwIfNoEntry: false });
  if (!found) return null;
  if (found.isDirectory() && readdirSync(dest).length === 0) {
    rmdirSync(dest);
    return null;
  }
  const at = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
  let aside = `${dest}.changed-${stamp}`;
  for (let n = 2; lstatSync(aside, { throwIfNoEntry: false }); n++)
    aside = `${dest}.changed-${stamp}-${n}`;
  renameSync(dest, aside);
  return aside;
}

/** Fetches the template into `<dir>/templates/<slug>/` and returns that path; a verified copy already there is kept. */
export async function pullTemplate(slug: string, dir: string): Promise<string> {
  const pack = TEMPLATES[slug];
  if (!pack)
    throw new PullRefused(
      `No template "${slug}". Templates: ${Object.keys(TEMPLATES).join(", ")}.`,
    );
  const dest = resolve(dir, "templates", slug);
  if (alreadyPulled(dest, pack)) return dest;
  const stage = recordFolder(resolve(dir), "template-pulls");
  if (!stage)
    throw new PullRefused(
      `${resolve(dir, ".hyperframes")} is a link or not a folder; remove it and pull again.`,
    );
  const aside = await unpack(await download(await bundleUrl(pack), pack), dest, stage, pack);
  if (aside)
    console.log(
      c.warn(
        `${terminalText(dest)} did not match HeyGen's verified template, so it was moved to ${terminalText(aside)} and is no longer used.`,
      ),
    );
  trackSkillCommandRan({ skill: STYLE_SAMPLING, command: "templates pull" });
  return dest;
}

type KitEntry = { size: number; sha256: string } | "folder";
type KitManifest = Map<string, KitEntry>;

const manifestFile = (pack: TemplatePack) =>
  hyperframesCacheDir("template-manifests", `${pack.sha256}.json`);

const isKitEntry = (value: unknown): value is KitEntry =>
  value === "folder" ||
  (typeof value === "object" &&
    value !== null &&
    "size" in value &&
    typeof value.size === "number" &&
    "sha256" in value &&
    typeof value.sha256 === "string");

const isManifestRow = (row: unknown): row is [string, KitEntry] =>
  Array.isArray(row) && row.length === 2 && typeof row[0] === "string" && isKitEntry(row[1]);

/** The file list a verified download of `pack` unpacked to, kept in the user's cache, never in the project. */
function readManifest(pack: TemplatePack): KitManifest | null {
  try {
    const rows: unknown = JSON.parse(readFileSync(manifestFile(pack), "utf8"));
    return Array.isArray(rows) && rows.every(isManifestRow) ? new Map(rows) : null;
  } catch {
    return null;
  }
}

function saveManifest(pack: TemplatePack, verified: KitManifest): void {
  try {
    mkdirSync(dirname(manifestFile(pack)), { recursive: true });
    replaceFileAtomically(manifestFile(pack), JSON.stringify([...verified]));
  } catch {}
}

const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

function hashFile(path: string): KitEntry | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, READ_FLAGS);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink > 1) return null;
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(1 << 20);
    let size = 0;
    for (let read = readSync(fd, chunk); read > 0; read = readSync(fd, chunk)) {
      hash.update(chunk.subarray(0, read));
      size += read;
    }
    return { size, sha256: hash.digest("hex") };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function listKit(root: string): KitManifest | null {
  if (lstatSync(root, { throwIfNoEntry: false })?.isDirectory() !== true) return null;
  const kit: KitManifest = new Map();
  const walk = (folder: string): boolean => {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      const found = entry.isDirectory() ? "folder" : entry.isFile() && hashFile(join(root, path));
      if (!found) return false;
      kit.set(path, found);
      if (found === "folder" && !walk(path)) return false;
    }
    return true;
  };
  return walk("") ? kit : null;
}

const sameEntry = (found: KitEntry | undefined, expected: KitEntry): boolean =>
  found === expected ||
  (typeof found === "object" &&
    typeof expected === "object" &&
    found.size === expected.size &&
    found.sha256 === expected.sha256);

function sameKit(found: KitManifest | null, expected: KitManifest): boolean {
  if (!found || found.size !== expected.size) return false;
  for (const [path, entry] of expected) if (!sameEntry(found.get(path), entry)) return false;
  return true;
}

/** True only when every path under `dest` matches the files a verified download of `pack` unpacked to. */
function alreadyPulled(dest: string, pack: TemplatePack): boolean {
  if (lstatSync(dest, { throwIfNoEntry: false })?.isFile())
    throw new PullRefused(
      `${dest} is there but is not this template; nothing was downloaded. Move it aside and run the pull again.`,
    );
  const expected = readManifest(pack);
  return expected !== null && sameKit(listKit(dest), expected);
}

export function tagStyleSamplingProject(dir: string, pulled: string): void {
  for (const folder of [dir, pulled]) {
    if (existsSync(projectConfigPath(folder))) seedProjectAuthoringSkill(folder, STYLE_SAMPLING);
  }
}

/** Downloads a style template for a HyperFrames Pro account. The server decides who may have it. */
export default defineCommand({
  meta: {
    name: "templates",
    description: "Pull a style template into this project (HyperFrames Pro)",
  },
  args: {
    action: { type: "positional", description: "pull", required: true },
    slug: {
      type: "positional",
      description: "The template's slug, from the style-sampling skill",
      required: true,
    },
    dir: {
      type: "string",
      description: "Project folder (default: the current folder)",
    },
  },
  async run({ args }) {
    if (args.action !== "pull") {
      console.error(c.error("Use `templates pull <slug>`."));
      failCommand();
      return;
    }
    try {
      const path = await pullTemplate(String(args.slug), args.dir ?? ".");
      tagStyleSamplingProject(args.dir ?? ".", path);
      console.log(c.success(`✓ ${terminalText(path)}`));
    } catch (error) {
      if (!(error instanceof PullRefused || error instanceof NetworkFailure)) throw error;
      printFailureLine((show) => c.error(show(error.message)));
      if (error instanceof NetworkFailure) printFailureLine((show) => c.dim(show(error.hint)));
      failCommand();
    }
  },
});
