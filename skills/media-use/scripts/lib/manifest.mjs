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
import { join } from "node:path";

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
  const records = readManifest(projectDir);
  return (
    records.find(
      (r) => normalizePrompt(r.provenance?.prompt) === key && (type == null || r.type === type),
    ) || null
  );
}

export function findByEntity(projectDir, entity) {
  const lower = entity.toLowerCase();
  const records = readManifest(projectDir);
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

// Atomically allocate the next free id for `type` AND reserve its file, so a
// slow download/copy between allocation and appendRecord can't let a concurrent
// caller grab the same id (the MU-23 clobber). Under the lock we take the max id
// across BOTH the manifest and any already-reserved files in the type dir, then
// O_EXCL-create an empty placeholder at the target path; freeze/copy overwrites
// it. Returns { id, localPath }.
export function allocateId(projectDir, type, ext) {
  mkdirSync(mediaDir(projectDir), { recursive: true });
  const typeDir = typeDirPath(projectDir, type);
  mkdirSync(typeDir, { recursive: true });
  return withLock(mediaDir(projectDir), () => {
    const re = new RegExp(`^${type}_(\\d+)`);
    let max = 0;
    for (const r of readManifest(projectDir)) {
      if (r.type !== type) continue;
      const m = r.id?.match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    for (const f of readdirSync(typeDir)) {
      const m = f.match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10)); // skip ids reserved but not yet appended
    }
    const id = `${type}_${String(max + 1).padStart(3, "0")}`;
    const localPath = `.media/${typeSubdir(type)}/${id}${ext}`;
    writeFileSync(join(projectDir, localPath), "", { flag: "wx" }); // durable reservation
    return { id, localPath };
  });
}
