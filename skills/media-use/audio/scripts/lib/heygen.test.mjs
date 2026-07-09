import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heygenAuthHeaders } from "./heygen.mjs";

function withCleanHeygenEnv(fn) {
  const previousApiKey = process.env.HEYGEN_API_KEY;
  const previousHyperframesApiKey = process.env.HYPERFRAMES_API_KEY;
  const previousConfigDir = process.env.HEYGEN_CONFIG_DIR;
  try {
    delete process.env.HEYGEN_API_KEY;
    delete process.env.HYPERFRAMES_API_KEY;
    delete process.env.HEYGEN_CONFIG_DIR;
    return fn();
  } finally {
    if (previousApiKey === undefined) delete process.env.HEYGEN_API_KEY;
    else process.env.HEYGEN_API_KEY = previousApiKey;
    if (previousHyperframesApiKey === undefined) delete process.env.HYPERFRAMES_API_KEY;
    else process.env.HYPERFRAMES_API_KEY = previousHyperframesApiKey;
    if (previousConfigDir === undefined) delete process.env.HEYGEN_CONFIG_DIR;
    else process.env.HEYGEN_CONFIG_DIR = previousConfigDir;
  }
}

test("heygenAuthHeaders does not tag API-key requests as CLI traffic", () => {
  withCleanHeygenEnv(() => {
    process.env.HEYGEN_API_KEY = "hg_test";
    // API-key requests use normal billing; the backend ignores the cli-source
    // header for them, so it's not sent.
    assert.deepEqual(heygenAuthHeaders(), {
      "X-Api-Key": "hg_test",
    });
  });
});

test("heygenAuthHeaders tags OAuth requests as CLI traffic", () => {
  withCleanHeygenEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-cred-"));
    try {
      process.env.HEYGEN_CONFIG_DIR = dir;
      writeFileSync(
        join(dir, "credentials"),
        JSON.stringify({
          oauth: {
            access_token: "at_test",
            expires_at: "2099-01-01T00:00:00Z",
          },
        }),
      );
      assert.deepEqual(heygenAuthHeaders(), {
        Authorization: "Bearer at_test",
        "X-HeyGen-Source": "cli",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
