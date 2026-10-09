/**
 * Shared fixtures for auth-module tests. Centralises the env-snapshot
 * + tmp-config-dir pattern so resolver.test.ts and oauth.test.ts don't
 * each maintain a copy of the same beforeEach/afterEach plumbing.
 *
 * Only loaded by `*.test.ts` — runtime code doesn't depend on it.
 */

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_KEYS = [
  "HEYGEN_API_KEY",
  "HEYGEN_ACCESS_TOKEN",
  "HYPERFRAMES_API_KEY",
  "HEYGEN_CONFIG_DIR",
  "HEYGEN_API_URL",
  "HYPERFRAMES_OAUTH_CLIENT_ID",
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

export interface EnvFixture {
  /** Tmp config dir; deleted on `restore()`. */
  dir: string;
  /** Restore env + delete tmp dir. Idempotent. */
  restore: () => Promise<void>;
}

/**
 * Take a snapshot of the auth-related env, clear them, make a tmp
 * `HEYGEN_CONFIG_DIR`, and return a `restore()` that undoes all of
 * the above.
 */
export async function setupTempAuthEnv(prefix = "hf-auth-test-"): Promise<EnvFixture> {
  const dir = await fs.mkdtemp(join(tmpdir(), prefix));
  const saved: Partial<Record<EnvKey, string | undefined>> = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env["HEYGEN_CONFIG_DIR"] = dir;

  const restore = async (): Promise<void> => {
    for (const k of ENV_KEYS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fs.rm(dir, { recursive: true, force: true });
  };

  return { dir, restore };
}
