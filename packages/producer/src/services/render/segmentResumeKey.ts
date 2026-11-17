/**
 * The secret this install signs segment manifests with. It lives in the user's HyperFrames
 * config folder, outside every project, so segments that arrive inside a project folder can
 * never carry a signature this install accepts.
 */
import { randomBytes } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const KEY_BYTES = 32;

function defaultKeyPath(): string {
  const configDir = process.env.HYPERFRAMES_CONFIG_DIR || join(homedir(), ".hyperframes");
  return join(configDir, "segment-resume.key");
}

/** Publishes a new key under `path` only if none exists, so concurrent renders agree on one. */
function createKeyOnce(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, randomBytes(KEY_BYTES), { mode: 0o600 });
  try {
    linkSync(tmp, path);
  } catch {
    // expected: another render published its key first; that one is read instead
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Null when the key cannot be read or created; segments are then never reused. */
export function loadSegmentResumeKey(path = defaultKeyPath()): Buffer | null {
  try {
    const existing = readFileSync(path);
    return existing.length >= KEY_BYTES ? existing : null;
  } catch {
    // expected: no key yet, so this install makes one
  }
  try {
    createKeyOnce(path);
    const created = readFileSync(path);
    return created.length >= KEY_BYTES ? created : null;
  } catch {
    // expected: a read-only or missing config folder; resume then re-captures every segment
    return null;
  }
}
