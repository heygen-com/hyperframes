import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Writes into a folder someone else may have filled: a link already at a name is replaced or refused, never followed.

/** Folder `rel` under `base`, made if missing; throws when any folder on the way is a link. */
export function ownFolder(base, rel) {
  let dir = base;
  // Each folder is looked at before it is made, so nothing is ever made through a link.
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    dir = join(dir, part);
    if (lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(
        `${dir} is a link; media is written only into real folders, so nothing was written there`,
      );
    }
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** A new temp file beside `path` holding `content`, with a random name, created exclusively. */
export function writeTempBeside(path, content) {
  // Same shape as core atomicTempPath, which Studio's project history skips.
  const temp = `${path}.hf${randomBytes(3).toString("hex")}.tmp`;
  try {
    writeFileSync(temp, content, { flag: "wx" });
  } catch (error) {
    // EEXIST: the random name belongs to another writer, so it is left alone. A failed cleanup must not hide `error`.
    if (error?.code !== "EEXIST") {
      try {
        rmSync(temp, { force: true });
      } catch {}
    }
    throw error;
  }
  return temp;
}

/** Writes `content` to a temp file beside `path`, then renames it over: a link at `path` is replaced, not followed. */
export function replaceFile(path, content) {
  publish(writeTempBeside(path, content), path);
}

/** As replaceFile, with `write(temp)` filling the temp file (an ffmpeg run, say); a throw leaves `path` as it was. */
export function replaceFileWith(path, write) {
  const temp = writeTempBeside(path, "");
  try {
    write(temp);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
  publish(temp, path);
}

function publish(temp, path) {
  try {
    renameRidingWindowsHolds(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

// Windows refuses a rename for a moment while antivirus or a just-exited process still holds the file.
const WINDOWS_HOLD = new Set(["EPERM", "EACCES", "EBUSY"]);
const HOLD_BACKOFF_MS = [10, 20, 40, 80, 160, 320, 640];

function renameRidingWindowsHolds(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return renameSync(from, to);
    } catch (error) {
      const held = process.platform === "win32" && WINDOWS_HOLD.has(error?.code);
      if (!held || attempt >= HOLD_BACKOFF_MS.length) throw error;
      sleepMs(HOLD_BACKOFF_MS[attempt]);
    }
  }
}

/** Sync sleep (no busy-spin). */
export function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
