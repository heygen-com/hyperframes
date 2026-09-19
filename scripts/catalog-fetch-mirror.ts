import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface MirrorEntry {
  status: number;
  contentType: string | null;
  file: string;
}
type MirrorIndex = Record<string, MirrorEntry>;

export type MirrorMode = "replay" | "record";

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
    const body = Buffer.from(await response.arrayBuffer());
    const file = `${createHash("sha256").update(body).digest("hex").slice(0, 24)}.bin`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), body);
    const contentType = response.headers.get("content-type");
    index[requestUrl(input)] = { status: response.status, contentType, file };
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
