/**
 * This install's secret for signing segment manifests. It lives in the HyperFrames config folder,
 * outside every project, so segments shipped inside a project never carry a signature it accepts.
 */
import { randomBytes } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const KEY_BYTES = 32;

function defaultKeyPath(): string {
  const configDir = process.env.HYPERFRAMES_CONFIG_DIR || join(homedir(), ".hyperframes");
  return join(configDir, "segment-resume.key");
}

function readUsableKey(path: string): Buffer | null {
  try {
    const key = readFileSync(path);
    return key.length >= KEY_BYTES ? key : null;
  } catch {
    // expected: no key yet
    return null;
  }
}

/** A missing key is linked into place, so concurrent renders keep whichever landed first. */
function publishKey(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, randomBytes(KEY_BYTES), { mode: 0o600 });
  try {
    if (existsSync(path)) renameSync(tmp, path);
    else linkSync(tmp, path);
  } catch {
    // expected: another render linked its key first
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Null when no key can be read or created; resume then re-captures every segment. */
export function loadSegmentResumeKey(path = defaultKeyPath()): Buffer | null {
  const existing = readUsableKey(path);
  if (existing) return existing;
  try {
    publishKey(path);
  } catch {
    // expected: a read-only or missing config folder
    return null;
  }
  return readUsableKey(path);
}
