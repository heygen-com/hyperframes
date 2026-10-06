import {
  readFileSync,
  appendFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  openSync,
  closeSync,
  writeFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, join } from "node:path";

const MANIFEST_FILE = "manifest.jsonl";
const INDEX_FILE = "index.md";

const TYPE_DIRS = {
  bgm: "audio/bgm",
  sfx: "audio/sfx",
  voice: "audio/voice",
  image: "images",
  icon: "images",
  logo: "images",
  brand: "images",
  video: "video",
  grade: "luts",
  lut: "luts",
  recipe: "recipes",
};

export function mediaDir(projectDir) {
  return join(projectDir, ".media");
}

export function manifestPath(projectDir) {
  return join(mediaDir(projectDir), MANIFEST_FILE);
}

export function indexPath(projectDir) {
  return join(mediaDir(projectDir), INDEX_FILE);
}

export function typeSubdir(type) {
  const sub = TYPE_DIRS[type];
  if (!sub) throw new Error(`unknown media type: ${type}`);
  return sub;
}

export function typeDirPath(projectDir, type) {
  return join(mediaDir(projectDir), typeSubdir(type));
}

export function readManifest(projectDir) {
  const p = manifestPath(projectDir);
  if (!existsSync(p)) return [];
  const raw = readFileSync(p, "utf8");
  const records = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // ponytail: skip malformed lines, don't crash
    }
  }
  return records;
}

export function appendRecord(projectDir, record) {
  const dir = mediaDir(projectDir);
  mkdirSync(dir, { recursive: true });
  const typeDir = typeDirPath(projectDir, record.type);
  mkdirSync(typeDir, { recursive: true });

  const p = manifestPath(projectDir);
  const line = JSON.stringify(record) + "\n";
  appendFileSync(p, line);
}

/** Sources that mean the agent made or fetched the file; any other file is the person's own. */
export const AGENT_SOURCES = ["generated", "search", "bundled"];

/** The record a path has now: the manifest only appends, so the last one for a path wins. */
export function latestRecordFor(projectDir, path) {
  return readManifest(projectDir).findLast((record) => record.path === path);
}

/** Records with every older record for the same path dropped, since the last one for a path is its record. */
export function currentRecords(projectDir) {
  const records = readManifest(projectDir);
  const last = new Map(records.map((record, index) => [record.path, index]));
  return records.filter((record, index) => !record.path || last.get(record.path) === index);
}

/** Records a file already in the project where it is, unless its current record already says the same thing. */
export function recordInPlace(
  projectDir,
  { type, path, source, description, duration, provenance },
) {
  const fields = {
    type,
    path,
    source,
    description: description || basename(path),
    ...(duration != null && { duration: Math.round(duration * 10) / 10 }),
  };
  mkdirSync(mediaDir(projectDir), { recursive: true });
  return withLock(mediaDir(projectDir), () => {
    const latest = latestRecordFor(projectDir, path);
    const same = ["source", "description", "duration"].every(
      (key) => latest?.[key] === fields[key],
    );
    if (latest && same) return latest;
    const record = { id: nextFreeId(projectDir, type), ...fields, provenance };
    appendRecord(projectDir, record);
    return record;
  });
}

// Match prompts forgivingly. Agents rarely re-emit a byte-identical intent, so
// keying cache lookups on exact equality meant "Calm piano" and "calm  piano"
// re-searched and re-downloaded. Normalize (trim, lowercase, collapse internal
// whitespace) on both sides; the raw prompt is still stored for audit.
export function normalizePrompt(prompt) {
  return String(prompt ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function findByPrompt(projectDir, prompt, type) {
  const key = normalizePrompt(prompt);
  if (!key) return null;
  const records = currentRecords(projectDir);
  return (
    records.find(
      (r) => normalizePrompt(r.provenance?.prompt) === key && (type == null || r.type === type),
    ) || null
  );
}

export function findByEntity(projectDir, entity) {
  const lower = entity.toLowerCase();
  const records = currentRecords(projectDir);
  return records.find((r) => r.entity && r.entity.toLowerCase() === lower) || null;
}

export function nextId(projectDir, type) {
  const records = readManifest(projectDir);
  const prefix = type;
  let max = 0;
  for (const r of records) {
    if (r.type !== type) continue;
    const m = r.id?.match(new RegExp(`^${prefix}_(\\d+)$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}_${String(max + 1).padStart(3, "0")}`;
}

// Sync sleep (no busy-spin) for the allocation lock retry.
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Coarse per-project lock so concurrent resolves don't race on id allocation.
// ponytail: one lock file with a 15s stale-steal (a crashed holder can't wedge
// the project); fine for agent-scale concurrency — revisit if throughput needs
// finer locking. Date.now() is available here (a normal Node CLI, not a
// workflow DSL), so mtime-based staleness is safe.
const LOCK_STALE_MS = 15000;
const LOCK_TIMEOUT_MS = 20000;

function withLock(dir, fn) {
  const lock = join(dir, ".lock");
  const start = Date.now();
  for (;;) {
    try {
      closeSync(openSync(lock, "wx")); // O_EXCL: atomic acquire
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          rmSync(lock, { force: true }); // steal a stale lock from a dead holder
          continue;
        }
      } catch {
        continue; // lock vanished between check and stat — retry the acquire
      }
      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        throw new Error("media-use: timed out acquiring .media/.lock");
      }
      sleepMs(25);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

// Atomically allocate the next free id for `type` AND reserve it on disk, so a
// slow download/copy between allocation and appendRecord can't let a concurrent
// caller grab the same id (the MU-23 clobber). Under the lock we take the max id
// across BOTH the manifest and any already-reserved files in the type dir, then
// O_EXCL-create an empty marker under core's atomic temp name, which Studio's
// project history skips. Returns { id, localPath, markerPath }.
export function allocateId(projectDir, type, ext) {
  mkdirSync(mediaDir(projectDir), { recursive: true });
  const typeDir = typeDirPath(projectDir, type);
  mkdirSync(typeDir, { recursive: true });
  return withLock(mediaDir(projectDir), () => {
    const id = nextFreeId(projectDir, type);
    const localPath = `.media/${typeSubdir(type)}/${id}${ext}`;
    // Same shape as core atomicTempPath: an empty file at the final name would be committed.
    const markerPath = `${join(projectDir, localPath)}.hf${randomBytes(3).toString("hex")}.tmp`;
    writeFileSync(markerPath, "", { flag: "wx" }); // durable reservation
    return { id, localPath, markerPath };
  });
}

// Call under the lock: counts recorded ids and ids reserved by a file not yet recorded.
function nextFreeId(projectDir, type) {
  const re = new RegExp(`^${type}_(\\d+)`);
  let max = 0;
  for (const r of readManifest(projectDir)) {
    if (r.type !== type) continue;
    const m = r.id?.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const typeDir = typeDirPath(projectDir, type);
  for (const f of existsSync(typeDir) ? readdirSync(typeDir) : []) {
    const m = f.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${type}_${String(max + 1).padStart(3, "0")}`;
}

function reservedFile(projectDir, type, ext) {
  const allocation = allocateId(projectDir, type, ext);
  return { ...allocation, fullPath: join(projectDir, allocation.localPath) };
}

function releaseReservation(reservation, committed) {
  if (!committed) rmSync(reservation.fullPath, { force: true });
  rmSync(reservation.markerPath, { force: true });
}

// A reservation is committed only when populate returns a non-null value.
// Throwing/rejecting or returning null means no usable asset was produced, so
// the reservation and any partial asset are released. Keeping this transaction
// beside allocateId prevents provider/cache/LUT paths from forgetting the rollback.
export function withReservedFileSync(projectDir, type, ext, populate) {
  const reservation = reservedFile(projectDir, type, ext);
  try {
    const result = populate(reservation);
    releaseReservation(reservation, result != null);
    return result;
  } catch (error) {
    releaseReservation(reservation, false);
    throw error;
  }
}

export async function withReservedFile(projectDir, type, ext, populate) {
  const reservation = reservedFile(projectDir, type, ext);
  try {
    const result = await populate(reservation);
    releaseReservation(reservation, result != null);
    return result;
  } catch (error) {
    releaseReservation(reservation, false);
    throw error;
  }
}
