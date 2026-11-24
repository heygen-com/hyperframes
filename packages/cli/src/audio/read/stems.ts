import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findFfBinary, mediaInputFormatArgs } from "@hyperframes/parsers/ff-binaries";
import { replaceFileAtomically } from "@hyperframes/core/atomic-file";
import { setTimeout as sleep } from "node:timers/promises";
import { downloadToFile } from "../../cloud/download.js";
import { HyperframesCloudClient } from "../../cloud/_gen/client.js";
import { uploadAssetViaDirectUpload } from "../../cloud/upload.js";
import {
  runFile,
  serviceAccess,
  serviceFailure,
  type ServiceAccess,
} from "../analysis/providers/shared.js";
import { probeAudio } from "../analysis/decode.js";
import { hyperframesConfigDir } from "../../utils/configDir.js";
import { readPlainFile } from "../../utils/projectRecords.js";
import { isPlainFile, isPlainName, isRealFolder, makeRealFolder } from "../cacheFolder.js";

/**
 * Upload 192 kb/s stereo MP3 through the service origin's direct-upload routes, then POST
 * `{ version: 1, audio: { type: "asset_id", asset_id } }` with one Idempotency-Key.
 * A completed response wraps StemsJob in `data`. Retry 409 `request_in_progress` or a dropped
 * connection with the same key and body; other HTTP errors carry `{ error: { code, message } }`.
 * A complete separation contains vocals, drums, bass, guitar, piano and other.
 */
interface StemsJob {
  id: string;
  status: "pending" | "completed" | "failed";
  stems?: { name: string; url: string }[];
  failure_message?: string;
}

const URL_ENV = "HYPERFRAMES_AUDIO_STEMS_URL";
const KEY_ENV = "HYPERFRAMES_AUDIO_API_KEY";
const TIMEOUT_ENV = "HYPERFRAMES_AUDIO_STEMS_TIMEOUT_MS";
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const RETRY_MS = 5000;
const DONE = "stems.json";
const MAX_DONE_BYTES = 64 * 1024;
const STEM_NAMES = ["vocals", "drums", "bass", "guitar", "piano", "other"] as const;

export const VOICE_STEM = "vocals";
export const VOICE_FREE_MIX = "no-vocals.wav";
export const DRUM_STEM = "drums";

export const SELF_CONTAINED_STEM_INPUT = [
  "-protocol_whitelist",
  "file",
  "-format_whitelist",
  "wav,w64,mp3,flac,ogg,aiff,caf,aac,mov,matroska",
] as const;

const recordOutsideProject = (dir: string) =>
  hyperframesConfigDir(
    "read-audio-stems",
    `${createHash("sha256").update(realpathSync(dir)).digest("hex").slice(0, 32)}.json`,
  );

function identity(path: string): string | null {
  const found = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  return found?.isFile() ? `${found.dev}:${found.ino}:${found.size}:${found.mtimeNs}` : null;
}

function readRecord(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(recordOutsideProject(dir), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeRecord(dir: string, kept: Record<string, unknown>, files: readonly string[]): void {
  try {
    const record = recordOutsideProject(dir);
    mkdirSync(dirname(record), { recursive: true, mode: 0o700 });
    const ids = Object.fromEntries(files.map((file) => [file, identity(join(dir, file))]));
    writeFileSync(record, JSON.stringify({ ...kept, ...ids }), { mode: 0o600 });
  } catch {
    // expected: a read-only config folder only means the stems are separated again next time
  }
}

export const recordStems = (dir: string, files: readonly string[]) => writeRecord(dir, {}, files);

export const addRecordedStems = (dir: string, files: readonly string[]) =>
  writeRecord(dir, readRecord(dir) ?? {}, files);

export function writtenHere(dir: string, files: readonly string[]): boolean {
  const recorded = readRecord(dir);
  return (
    recorded !== null &&
    files.every((file) => {
      const id = identity(join(dir, file));
      return id !== null && recorded[file] === id;
    })
  );
}

/** How to reach the stems service, or why it cannot be reached. */
export const stemsAccess = () =>
  serviceAccess(
    { url: URL_ENV, key: KEY_ENV, timeout: TIMEOUT_ENV },
    "/v3/audio/stems",
    DEFAULT_TIMEOUT_MS,
  );

function namedStems(text: string): Record<string, string> | null {
  let names: unknown;
  try {
    names = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof names !== "object" || names === null) return null;
  const files = names as Record<string, unknown>;
  return STEM_NAMES.every((name) => isPlainName(files[name]))
    ? Object.fromEntries(STEM_NAMES.map((name) => [name, files[name] as string]))
    : null;
}

/** Stems this install fetched into `dir`, by name; null when none, or when no record outside the project shows this install wrote them (a project can ship its own). */
export function cachedStems(dir: string): Record<string, string> | null {
  const done = join(dir, DONE);
  if (!isRealFolder(dir, 2) || !isPlainFile(done) || !writtenHere(dir, [DONE])) return null;
  const names = namedStems(readPlainFile(done, MAX_DONE_BYTES));
  if (!names || !writtenHere(dir, Object.values(names))) return null;
  return Object.fromEntries(STEM_NAMES.map((name) => [name, join(dir, names[name]!)]));
}

class StillRunning extends Error {}

const DROPPED = new Set(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET"]);

const dropped = (error: unknown) =>
  error instanceof TypeError &&
  DROPPED.has((error.cause as { code?: string } | undefined)?.code ?? "");

async function stillRunning(response: Response): Promise<boolean> {
  if (response.status !== 409) return false;
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { error?: { code?: string } } | null;
  return body?.error?.code === "request_in_progress";
}

async function job(response: Response): Promise<StemsJob> {
  if (await stillRunning(response)) throw new StillRunning();
  if (!response.ok) throw await serviceFailure(response, "the stems service");
  const body = (await response.json()) as { data?: StemsJob } | StemsJob | null;
  const value = (body && "data" in body ? body.data : body) as StemsJob | undefined;
  if (!value?.id || !value.status) throw new Error("the stems service answered without a job");
  return value;
}

async function encoded(path: string, dir: string, signal: AbortSignal): Promise<string> {
  const ffmpeg = findFfBinary("ffmpeg", { configuredMustExist: true });
  if (!ffmpeg) throw new Error("ffmpeg is required to separate stems; run: npx hyperframes doctor");
  const audio = await probeAudio(path);
  if (!audio) throw new Error("the recording has no audio track ffmpeg can decode");
  const out = join(dir, "upload.mp3");
  await runFile(
    ffmpeg,
    [
      ...["-v", "error", "-y", ...mediaInputFormatArgs(ffmpeg, path), "-i", path],
      ...["-map", `0:a:${audio.audioStream}`],
      ...["-vn", "-ac", "2", "-ar", "44100", "-b:a", "192k", out],
    ],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024, signal },
  );
  return out;
}

async function separated(
  url: string,
  request: RequestInit,
  signal: AbortSignal,
): Promise<StemsJob> {
  for (;;) {
    try {
      return await job(await fetch(url, { ...request, signal }));
    } catch (error) {
      if (!(error instanceof StillRunning || dropped(error))) throw error;
      await sleep(RETRY_MS, undefined, { signal });
    }
  }
}

/** Separate the recording through the configured service and save each stem into `dir`. */
export async function fetchStems(
  path: string,
  dir: string,
  { url, headers, timeoutMs }: ServiceAccess,
): Promise<Record<string, string>> {
  const signal = AbortSignal.timeout(timeoutMs);
  const scratch = await mkdtemp(join(tmpdir(), "hf-stems-"));
  try {
    const mp3 = await encoded(path, scratch, signal);
    const client = new HyperframesCloudClient({
      baseUrl: new URL(url).origin,
      getAuthHeaders: () => headers,
      fetchImpl: (input, init) => fetch(input, { ...init, redirect: "error", signal }),
    });
    const asset = await uploadAssetViaDirectUpload({
      client,
      path: mp3,
      size: statSync(mp3).size,
      filename: "audio.mp3",
      contentType: "audio/mpeg",
      idempotencyKey: randomUUID(),
      signal,
    });
    const current = await separated(
      url,
      {
        method: "POST",
        redirect: "error",
        headers: {
          ...headers,
          "idempotency-key": randomUUID(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ version: 1, audio: { type: "asset_id", asset_id: asset.asset_id } }),
      },
      signal,
    );
    if (current.status !== "completed")
      throw new Error(
        `stem separation failed${current.failure_message ? `: ${current.failure_message}` : ""}`,
      );
    const stems = current.stems ?? [];
    const missing = STEM_NAMES.filter((name) => !stems.some((stem) => stem.name === name));
    if (missing.length)
      throw new Error(
        `the stems service returned an incomplete separation: missing ${missing.join(", ")}`,
      );
    makeRealFolder(dir, 2);
    rmSync(join(dir, VOICE_FREE_MIX), { force: true });
    const names: Record<string, string> = {};
    for (const name of STEM_NAMES) {
      const stem = stems.find((candidate) => candidate.name === name);
      if (!stem) continue;
      const file = `${name}.audio`;
      await downloadToFile(stem.url, join(dir, file), { signal, replaceLink: true });
      names[name] = file;
    }
    replaceFileAtomically(join(dir, DONE), JSON.stringify(names));
    recordStems(dir, [DONE, ...Object.values(names)]);
    return Object.fromEntries(STEM_NAMES.map((name) => [name, join(dir, names[name]!)]));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
