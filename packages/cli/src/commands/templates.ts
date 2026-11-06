import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { makeOutputFolder } from "../utils/outputFolder.js";
import { processIsAlive } from "../utils/processTree.js";
import { basename, dirname, join, resolve } from "node:path";
import { resolveCloudAuthHeaders } from "../cloud/auth.js";
import { billingBaseUrl } from "../heygen/plan.js";
import { c } from "../ui/colors.js";
import { failCommand } from "../utils/commandResult.js";
import { fetchExplained, NetworkFailure } from "../utils/networkFailure.js";
import { defineCommand } from "../utils/defineCommand.js";

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

function assertSafeEntries(data: Buffer): void {
  const names = execFileSync("tar", ["-tzf", "-"], {
    input: data,
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  for (const name of names.split("\n"))
    if (name.startsWith("/") || name.split("/").includes(".."))
      throw new PullRefused(`The template holds an unsafe path (${name}); nothing was unpacked.`);
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

function removeAbandonedParts(dest: string): void {
  const parent = dirname(dest);
  if (!existsSync(parent)) return;
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(parent, entry.name);
    const pid = pullOwner(path, entry.name, dest);
    if (pid !== null && !processIsAlive(pid)) rmSync(path, { recursive: true, force: true });
  }
}

/** Unpacks the pack beside `dest` and moves it in whole, so `dest` only ever holds a complete template. */
async function unpack(data: Buffer, dest: string, pack: TemplatePack): Promise<void> {
  makeOutputFolder(dirname(dest));
  removeAbandonedParts(dest);
  const work = mkdtempSync(join(dirname(dest), `${partPrefix(dest)}${process.pid}-`));
  const stopWatching = removeOnStop(work);
  try {
    writeFileSync(join(work, PULL_MARKER), JSON.stringify({ owner: PULL_OWNER, pid: process.pid }));
    const out = join(work, "template");
    assertSafeEntries(data);
    mkdirSync(out);
    await extract(data, out);
    writeFileSync(join(out, PULLED_HASH), pack.sha256);
    removeEmptyPlaceholder(dest);
    renameSync(out, dest);
  } finally {
    stopWatching();
    rmSync(work, { recursive: true, force: true });
  }
}

/** Fetches the template into `<dir>/templates/<slug>/` and returns that path; one this pull left there is kept. */
export async function pullTemplate(slug: string, dir: string): Promise<string> {
  const pack = TEMPLATES[slug];
  if (!pack)
    throw new PullRefused(
      `No template "${slug}". Templates: ${Object.keys(TEMPLATES).join(", ")}.`,
    );
  const dest = resolve(dir, "templates", slug);
  if (alreadyPulled(dest, pack)) return dest;
  await unpack(await download(await bundleUrl(pack), pack), dest, pack);
  return dest;
}

const removeEmptyPlaceholder = (dest: string) => existsSync(dest) && rmdirSync(dest);

function alreadyPulled(dest: string, pack: TemplatePack): boolean {
  if (!existsSync(dest)) return false;
  const folder = statSync(dest).isDirectory();
  const record = join(dest, PULLED_HASH);
  const pulledHash = folder && existsSync(record) ? readFileSync(record, "utf8") : null;
  if (pulledHash === pack.sha256) return true;
  if (folder && readdirSync(dest).length === 0) return false;
  if (pulledHash)
    throw new PullRefused(
      `${dest} holds an older pull of this template; nothing was downloaded. Move it aside and run the pull again to update.`,
    );
  throw new PullRefused(
    `${dest} is there but is not this template; nothing was downloaded. Move it aside and run the pull again.`,
  );
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
      console.log(c.success(`✓ ${path}`));
    } catch (error) {
      if (!(error instanceof PullRefused || error instanceof NetworkFailure)) throw error;
      console.error(c.error(error.message));
      if (error instanceof NetworkFailure) console.error(c.dim(error.hint));
      failCommand();
    }
  },
});
