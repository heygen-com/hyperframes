import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  heygenAuthHeaders,
  heygenAuthMethod,
  heygenBase,
  heygenCredential,
  heygenJSON,
  loadEnvFromDir,
} from "./heygen.mjs";

const HEYGEN_ENV = [
  "HEYGEN_ACCESS_TOKEN",
  "HEYGEN_API_KEY",
  "HYPERFRAMES_API_KEY",
  "HEYGEN_CONFIG_DIR",
  "HEYGEN_API_BASE",
  "HEYGEN_ALLOW_HTTP",
];

// Runs fn with every HeyGen variable unset, then puts them back; an async fn restores once it settles.
function withCleanHeygenEnv(fn) {
  const previous = Object.fromEntries(HEYGEN_ENV.map((name) => [name, process.env[name]]));
  const restore = () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  for (const name of HEYGEN_ENV) delete process.env[name];
  let result;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  if (result && typeof result.then === "function") return result.finally(restore);
  restore();
  return result;
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

test("a project's .env cannot name the HeyGen base, so a shell key never leaves for its host", () => {
  withCleanHeygenEnv(() => {
    const project = mkdtempSync(join(tmpdir(), "heygen-env-"));
    writeFileSync(
      join(project, ".env"),
      "HEYGEN_API_BASE=https://proxy.example.com\nHEYGEN_ALLOW_HTTP=1\nMEDIA_USE_ENV_BASE_TEST=loaded\n",
    );
    try {
      process.env.HEYGEN_API_KEY = "hg_shell_real";
      loadEnvFromDir(project);
      assert.equal(process.env.MEDIA_USE_ENV_BASE_TEST, "loaded");
      assert.equal(process.env.HEYGEN_API_BASE, undefined);
      assert.equal(process.env.HEYGEN_ALLOW_HTTP, undefined);
      assert.equal(heygenBase(), "https://api.heygen.com/v3");
    } finally {
      delete process.env.MEDIA_USE_ENV_BASE_TEST;
      rmSync(project, { recursive: true, force: true });
    }
  });
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

test("heygenBase is HeyGen's public API unless a host names another", () => {
  withCleanHeygenEnv(() => {
    assert.equal(heygenBase(), "https://api.heygen.com/v3");
    process.env.HEYGEN_API_BASE = "https://api-canary.heygen.com/";
    assert.equal(heygenBase(), "https://api-canary.heygen.com/v3");
  });
});

test("heygenBase refuses a plain-HTTP host unless HEYGEN_ALLOW_HTTP is set, as the heygen CLI does", () => {
  withCleanHeygenEnv(() => {
    process.env.HEYGEN_API_BASE = "http://127.0.0.1:4100";
    assert.throws(() => heygenBase(), /HEYGEN_ALLOW_HTTP=1/);
    process.env.HEYGEN_ALLOW_HTTP = "1";
    assert.equal(heygenBase(), "http://127.0.0.1:4100/v3");
  });
});

test("a host gateway (HEYGEN_API_BASE with its own HEYGEN_API_KEY) wins over a host OAuth token", () => {
  withCleanHeygenEnv(() => {
    process.env.HEYGEN_API_BASE = "http://127.0.0.1:4100";
    process.env.HEYGEN_ALLOW_HTTP = "1";
    process.env.HEYGEN_API_KEY = "gateway-token";
    process.env.HEYGEN_ACCESS_TOKEN = "at_host";
    assert.deepEqual(heygenAuthHeaders(), {
      "X-Api-Key": "gateway-token",
      "X-HeyGen-Client-Source": "media-use",
    });
    assert.equal(heygenAuthMethod(), "api_key");
  });
});

test("heygenJSON sends its request to the host's HEYGEN_API_BASE with the host's key", async () => {
  /** @type {{ url?: string, key?: string | string[] }} */
  const seen = {};
  const server = createServer((req, res) => {
    seen.url = req.url;
    seen.key = req.headers["x-api-key"];
    res.writeHead(200, { "content-type": "application/json" }).end('{"data":[]}');
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  try {
    await withCleanHeygenEnv(async () => {
      process.env.HEYGEN_API_BASE = `http://127.0.0.1:${port}`;
      process.env.HEYGEN_ALLOW_HTTP = "1";
      process.env.HEYGEN_API_KEY = "gateway-token";
      const reply = await heygenJSON("/voices?limit=1", { headers: heygenAuthHeaders() });
      assert.deepEqual(reply, { data: [] });
    });
    assert.equal(seen.url, "/v3/voices?limit=1");
    assert.equal(seen.key, "gateway-token");
  } finally {
    server.close();
  }
});

test("a base that isn't HeyGen's gets no stored or host OAuth credential, only a key named for it", () => {
  withCleanHeygenEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-cred-"));
    try {
      process.env.HEYGEN_CONFIG_DIR = dir;
      writeFileSync(join(dir, "credentials"), JSON.stringify({ api_key: "hg_stored" }));
      process.env.HEYGEN_ACCESS_TOKEN = "at_host";
      process.env.HEYGEN_API_BASE = "https://proxy.example.com";
      assert.equal(heygenCredential(), null);
      assert.throws(() => heygenAuthHeaders(), /no HeyGen credentials/);
      // HeyGen's own hosts keep every credential source.
      process.env.HEYGEN_API_BASE = "https://api-canary.heygen.com";
      assert.equal(heygenAuthMethod(), "oauth");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
