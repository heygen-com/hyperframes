import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isContainedIn } from "./registry-target-paths.mjs";

interface MirrorEntry {
  status: number;
  contentType: string | null;
  file: string;
}
type MirrorIndex = Record<string, MirrorEntry>;

export type MirrorMode = "replay" | "record";

// Text/font/js cover what's recorded today; json/image/video are allowed for a future source.
// Anything else, or any response over the size cap below, is refused, not silently recorded,
// so an unexpected fetch fails the run instead of writing an unbounded, unvetted body to disk.
const MIRROR_CONTENT_TYPES = [
  /^text\//,
  /^font\//,
  /^image\//,
  /^video\//,
  /^application\/json/,
  /^application\/javascript/,
];
const MAX_MIRROR_BYTES = 8 * 1024 * 1024;

function mirrorableContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const base = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  return MIRROR_CONTENT_TYPES.some((re) => re.test(base));
}

export interface FetchMirror {
  /** Throws when a fetch during the run was not in the mirror, even if the caller swallowed the error. */
  assertNoMisses(): void;
  /** Writes the recorded responses (record mode) and restores the real fetch. */
  finish(): void;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function readIndex(dir: string): MirrorIndex {
  const path = join(dir, "index.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
}

function writeIndex(dir: string, index: MirrorIndex): void {
  const sorted = Object.fromEntries(
    Object.entries(index).sort(([a], [b]) => (a < b ? -1 : Number(a > b))),
  );
  writeFileSync(join(dir, "index.json"), `${JSON.stringify(sorted, null, 2)}\n`);
}

function replayResponse(dir: string, entry: MirrorEntry): Response {
  const headers = entry.contentType ? { "content-type": entry.contentType } : undefined;
  return new Response(readFileSync(join(dir, entry.file)), { status: entry.status, headers });
}

/**
 * Serves every fetch from a committed mirror so generation needs no network (replay), or records
 * live responses into it (record). Replaces `globalThis.fetch` until `finish()`.
 */
export function installFetchMirror(dir: string, mode: MirrorMode): FetchMirror {
  const realFetch = globalThis.fetch;
  const index = mode === "record" ? {} : readIndex(dir);
  const misses: string[] = [];

  async function recordFetch(input: Parameters<typeof fetch>[0], init?: RequestInit) {
    const response = await realFetch(input, init);
    if (!response.ok) return response;
    const url = requestUrl(input);
    const contentType = response.headers.get("content-type");
    if (!mirrorableContentType(contentType)) {
      misses.push(`${url} (content-type ${contentType ?? "none"} is not mirrored)`);
      return response;
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_MIRROR_BYTES) {
      misses.push(`${url} (${body.length} bytes exceeds the ${MAX_MIRROR_BYTES}-byte mirror cap)`);
      return response;
    }
    const file = `${createHash("sha256").update(body).digest("hex").slice(0, 24)}.bin`;
    mkdirSync(dir, { recursive: true });
    if (!isContainedIn(dir, file))
      throw new Error(`catalog fetch mirror: refusing to write outside ${dir}`);
    writeFileSync(join(dir, file), body);
    index[url] = { status: response.status, contentType, file };
    return new Response(body, { status: response.status, headers: response.headers });
  }

  async function replayFetch(input: Parameters<typeof fetch>[0]) {
    const url = requestUrl(input);
    const entry = index[url];
    if (entry) return replayResponse(dir, entry);
    misses.push(url);
    throw new Error(
      `catalog fetch mirror: ${url} is not mirrored (CATALOG_FETCH_MIRROR=record adds it)`,
    );
  }

  globalThis.fetch = (mode === "record" ? recordFetch : replayFetch) as typeof fetch;
  return {
    assertNoMisses() {
      if (misses.length > 0)
        throw new Error(`fetches outside the mirror:\n  ${misses.join("\n  ")}`);
    },
    finish() {
      globalThis.fetch = realFetch;
      if (mode === "record") writeIndex(dir, index);
    },
  };
}
