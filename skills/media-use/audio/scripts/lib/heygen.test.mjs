import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  heygenAuthHeaders,
  heygenAuthMethod,
  heygenCredential,
  loadEnvFromDir,
} from "./heygen.mjs";

function withCleanHeygenEnv(fn) {
  const previousAccessToken = process.env.HEYGEN_ACCESS_TOKEN;
  const previousApiKey = process.env.HEYGEN_API_KEY;
  const previousHyperframesApiKey = process.env.HYPERFRAMES_API_KEY;
  const previousConfigDir = process.env.HEYGEN_CONFIG_DIR;
  try {
    delete process.env.HEYGEN_ACCESS_TOKEN;
    delete process.env.HEYGEN_API_KEY;
    delete process.env.HYPERFRAMES_API_KEY;
    delete process.env.HEYGEN_CONFIG_DIR;
    return fn();
  } finally {
    if (previousAccessToken === undefined) delete process.env.HEYGEN_ACCESS_TOKEN;
    else process.env.HEYGEN_ACCESS_TOKEN = previousAccessToken;
    if (previousApiKey === undefined) delete process.env.HEYGEN_API_KEY;
    else process.env.HEYGEN_API_KEY = previousApiKey;
    if (previousHyperframesApiKey === undefined) delete process.env.HYPERFRAMES_API_KEY;
    else process.env.HYPERFRAMES_API_KEY = previousHyperframesApiKey;
    if (previousConfigDir === undefined) delete process.env.HEYGEN_CONFIG_DIR;
    else process.env.HEYGEN_CONFIG_DIR = previousConfigDir;
  }
}

test("heygenAuthHeaders does not tag API-key requests as CLI traffic, but still carries the media-use tool tag", () => {
  withCleanHeygenEnv(() => {
    process.env.HEYGEN_API_KEY = "hg_test";
    // API-key requests use normal billing; the backend ignores the cli-source
    // header for them, so it's not sent. The tool-attribution header IS sent on
    // every media-use call (any auth type) so the backend can isolate media-use.
    assert.deepEqual(heygenAuthHeaders(), {
      "X-Api-Key": "hg_test",
      "X-HeyGen-Client-Source": "media-use",
    });
  });
});

test("heygenAuthHeaders tags OAuth requests as CLI traffic and with the media-use tool tag", () => {
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
        "X-HeyGen-Client-Source": "media-use",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("a host-injected HEYGEN_ACCESS_TOKEN wins over an API key and is treated as OAuth", () => {
  withCleanHeygenEnv(() => {
    process.env.HEYGEN_ACCESS_TOKEN = "at_host";
    process.env.HEYGEN_API_KEY = "hg_test";
    assert.deepEqual(heygenAuthHeaders(), {
      Authorization: "Bearer at_host",
      "X-HeyGen-Source": "cli",
      "X-HeyGen-Client-Source": "media-use",
    });
    assert.equal(heygenAuthMethod(), "oauth");
  });
});

test("heygenAuthMethod returns api_key for an env API key, without tagging headers", () => {
  withCleanHeygenEnv(() => {
    process.env.HEYGEN_API_KEY = "hg_test";
    assert.equal(heygenAuthMethod(), "api_key");
  });
});

test("heygenAuthMethod returns oauth for a live OAuth credential", () => {
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
      assert.equal(heygenAuthMethod(), "oauth");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("heygenAuthMethod returns null with no credential at all", () => {
  withCleanHeygenEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-cred-"));
    try {
      process.env.HEYGEN_CONFIG_DIR = dir; // no credentials file written
      assert.equal(heygenAuthMethod(), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("loadEnvFromDir skips a .env folder and loads the .env file above it", () => {
  const root = mkdtempSync(join(tmpdir(), "heygen-env-"));
  const project = join(root, "project");
  mkdirSync(join(project, ".env"), { recursive: true });
  writeFileSync(join(root, ".env"), "MEDIA_USE_ENV_DIR_TEST=from-parent\n");
  try {
    loadEnvFromDir(project);
    assert.equal(process.env.MEDIA_USE_ENV_DIR_TEST, "from-parent");
  } finally {
    delete process.env.MEDIA_USE_ENV_DIR_TEST;
    rmSync(root, { recursive: true, force: true });
  }
});

test("heygenAuthMethod returns null when the credentials path is a folder", () => {
  withCleanHeygenEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-cred-"));
    try {
      mkdirSync(join(dir, "credentials"));
      process.env.HEYGEN_CONFIG_DIR = dir;
      assert.equal(heygenAuthMethod(), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("heygenAuthMethod returns null when the credentials path is a symlink loop", () => {
  withCleanHeygenEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-cred-"));
    try {
      symlinkSync(join(dir, "credentials"), join(dir, "credentials"));
      process.env.HEYGEN_CONFIG_DIR = dir;
      assert.equal(heygenAuthMethod(), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("heygenAuthHeaders says to fix an unreadable credentials path, and to log in when there is none", () => {
  withCleanHeygenEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-cred-"));
    try {
      process.env.HEYGEN_CONFIG_DIR = dir;
      assert.throws(() => heygenAuthHeaders(), /no HeyGen credentials/);
      mkdirSync(join(dir, "credentials"));
      assert.equal(heygenCredential(), null);
      assert.throws(
        () => heygenAuthHeaders(),
        (error) =>
          error.message.includes(join(dir, "credentials")) &&
          /fix or remove that path/.test(error.message),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
