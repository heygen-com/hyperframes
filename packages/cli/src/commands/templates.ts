import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveCloudAuthHeaders } from "../cloud/auth.js";
import { billingBaseUrl } from "../heygen/plan.js";
import { c } from "../ui/colors.js";
import { failCommand } from "../utils/commandResult.js";
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
    sha256: "4ead405395892545c658a03b48630529943f5598cc15770930c0ffa6b8de58e9",
    bytes: 25559788,
  },
  "finance-explainer": {
    id: "M9002",
    sha256: "b10efcfad35097ddac8118062701eeb3ef4012f3c9b41704e474964d09d37d11",
    bytes: 140688140,
  },
  "3d-true-crime": {
    id: "M9005",
    sha256: "53d1f51eb5b78e3cb60a23625d160952236d5f5fb8d41118798d782a6168eec1",
    bytes: 5977486,
  },
  "collage-explainer": {
    id: "M9001",
    sha256: "395362e3c629706143724e99d72dacb4997d35b978ecc4173901cdef6e70205c",
    bytes: 36711101,
  },
  "3d-brand-explainer": {
    id: "M9004",
    sha256: "4e5c5eb574f977d3f97a170a5a0d8d442234d34dd51f925dc4a2b93e32826ae8",
    bytes: 20181051,
  },
};

/** A pull that stopped, with the one line the agent relays. Nothing was written. */
export class PullRefused extends Error {}

const LINK_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 20 * 60_000;

async function bundleUrl(pack: TemplatePack, retries = 1): Promise<string> {
  const headers = await resolveCloudAuthHeaders().catch(() => {
    throw new PullRefused("Not signed in. Run `npx hyperframes auth login`.");
  });
  const route = `${billingBaseUrl()}/v1/hyperframes/moments/${pack.id}/bundle?sha256=${pack.sha256}`;
  const res = await fetch(route, {
    headers: { ...headers, accept: "application/json" },
    signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
  });
  if (res.status === 503 && retries > 0) return bundleUrl(pack, retries - 1);
  if (res.status === 401) throw new PullRefused("Not signed in. Run `npx hyperframes auth login`.");
  if (res.status === 402)
    throw new PullRefused(
      "Creator templates are part of HyperFrames Pro; nothing was downloaded. Run `npx hyperframes billing subscribe`: it opens the page and waits.",
    );
  if (res.status === 404) throw new PullRefused("That template version is no longer available.");
  if (!res.ok) throw new PullRefused(`HeyGen could not hand over the template (${res.status}).`);
  const body = (await res.json()) as { data?: { url?: string } };
  if (!body.data?.url) throw new PullRefused("HeyGen answered without a download link.");
  return body.data.url;
}

async function download(url: string, pack: TemplatePack): Promise<Buffer> {
  const res = await fetch(url, {
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

/** Unpacks the pack beside `dest` and moves it in whole, so `dest` only ever holds a complete template. */
function unpack(data: Buffer, dest: string, pack: TemplatePack): void {
  mkdirSync(dirname(dest), { recursive: true });
  const work = mkdtempSync(`${dest}.part-`);
  try {
    const out = join(work, "template");
    assertSafeEntries(data);
    mkdirSync(out);
    execFileSync("tar", ["-xzf", "-", "-C", out, "--no-same-owner"], { input: data });
    writeFileSync(join(out, PULLED_HASH), pack.sha256);
    removeEmptyPlaceholder(dest);
    renameSync(out, dest);
  } finally {
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
  unpack(await download(await bundleUrl(pack), pack), dest, pack);
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
      if (!(error instanceof PullRefused)) throw error;
      console.error(c.error(error.message));
      failCommand();
    }
  },
});
