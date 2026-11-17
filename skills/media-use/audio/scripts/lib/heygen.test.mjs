import { test } from "node:test";
import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  billingRefusal,
  heygenAuthHeaders,
  heygenAuthMethod,
  heygenBase,
  heygenCredential,
  heygenJSON,
  heygenMessage,
  loadEnvFromDir,
  noteProjectElevenLabsKey,
} from "./heygen.mjs";

const HEYGEN_ENV = [
  "HEYGEN_ACCESS_TOKEN",
  "HEYGEN_API_KEY",
  "HYPERFRAMES_API_KEY",
  "HYPERFRAMES_CONFIG_DIR",
  "HYPERFRAMES_ENV",
  "HYPERFRAMES_OAUTH_CLIENT_ID",
  "HYPERFRAMES_OAUTH_TOKEN_URL",
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
      process.env.HYPERFRAMES_CONFIG_DIR = dir;
      writeFileSync(
        join(dir, "credentials"),
        JSON.stringify({
          oauth: {
            client_id: "Zg3LF4FCLoeJoGs2YqMtZ17g",
            token_endpoint: "https://api2.heygen.com/v1/oauth/token",
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

test("development audio uses its isolated store and the client and token host from the environment", () => {
  withCleanHeygenEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "hf-dev-cred-"));
    try {
      process.env.HYPERFRAMES_CONFIG_DIR = dir;
      process.env.HYPERFRAMES_ENV = "dev";
      process.env.HYPERFRAMES_OAUTH_CLIENT_ID = "fake-client";
      process.env.HYPERFRAMES_OAUTH_TOKEN_URL = "https://auth.example.test/token";
      mkdirSync(join(dir, "dev"));
      writeFileSync(
        join(dir, "dev", "credentials"),
        JSON.stringify({
          oauth: {
            access_token: "dev-at",
            client_id: "fake-client",
            token_endpoint: "https://auth.example.test/token",
          },
        }),
      );
      assert.equal(heygenBase(), "https://api.heygen.com/v3");
      assert.equal(heygenAuthHeaders().Authorization, "Bearer dev-at");
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

test("a live login wins over HEYGEN_API_KEY; an expired one gives way to it", () => {
  withCleanHeygenEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "hf-login-vs-env-"));
    try {
      process.env.HYPERFRAMES_CONFIG_DIR = dir;
      process.env.HEYGEN_API_KEY = "hg_env";
      const credential = {
        api_key: "saved-wallet",
        oauth: {
          client_id: "Zg3LF4FCLoeJoGs2YqMtZ17g",
          token_endpoint: "https://api2.heygen.com/v1/oauth/token",
          access_token: "at_login",
          expires_at: "2099-01-01T00:00:00Z",
        },
      };
      writeFileSync(join(dir, "credentials"), JSON.stringify(credential));
      assert.deepEqual(heygenCredential(), { headers: { Authorization: "Bearer at_login" } });
      // HeyGen's own base is no gateway, so naming it changes nothing.
      process.env.HEYGEN_API_BASE = "https://api.heygen.com";
      assert.deepEqual(heygenCredential(), { headers: { Authorization: "Bearer at_login" } });
      delete process.env.HEYGEN_API_BASE;
      credential.oauth.expires_at = "2000-01-01T00:00:00Z";
      writeFileSync(join(dir, "credentials"), JSON.stringify(credential));
      assert.deepEqual(heygenCredential(), { headers: { "X-Api-Key": "hg_env" } });
      writeFileSync(join(dir, "credentials"), JSON.stringify({ api_key: "saved-wallet" }));
      assert.deepEqual(heygenCredential(), { headers: { "X-Api-Key": "hg_env" } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Runs fn(dir, notes, project) with a temp credentials dir and a project whose .env sets name=key.
function withProjectEnv(key, received, fn, name = "HEYGEN_API_KEY") {
  withCleanHeygenEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-cred-"));
    const project = mkdtempSync(join(tmpdir(), "heygen-env-"));
    const write = process.stderr.write;
    const notes = [];
    process.stderr.write = (line) => notes.push(String(line));
    try {
      process.env.HYPERFRAMES_CONFIG_DIR = dir;
      writeFileSync(join(project, ".env"), `${name}=${key}\n`);
      if (received !== undefined) {
        mkdirSync(join(project, ".hyperframes"));
        writeFileSync(join(project, ".hyperframes", "received-files.json"), received);
      }
      loadEnvFromDir(project);
      fn(dir, notes, project);
    } finally {
      process.stderr.write = write;
      rmSync(dir, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });
}

// A cloned or copied folder has no received-files record; a received one lists its .env.
const PROJECT_KINDS = [
  ["a folder with no received-files record", undefined],
  ["a received folder", JSON.stringify({ files: [".env"] })],
];

for (const [kind, record] of [...PROJECT_KINDS, ["an unreadable received-files record", "{oops"]]) {
  test(`a project .env key from ${kind} gives way to the saved API key`, () => {
    withProjectEnv("hg_project", record, (dir, notes) => {
      writeFileSync(join(dir, "credentials"), JSON.stringify({ api_key: "saved-wallet" }));
      assert.deepEqual(heygenCredential(), { headers: { "X-Api-Key": "saved-wallet" } });
      assert.deepEqual(notes, []);
    });
  });
}

for (const [projectName, shellName] of [
  ["HEYGEN_API_KEY", "HYPERFRAMES_API_KEY"],
  ["HYPERFRAMES_API_KEY", "HEYGEN_API_KEY"],
]) {
  test(`the shell's ${shellName} wins over a project .env's ${projectName}, with or without a saved key`, () => {
    withProjectEnv(
      "hg_project",
      undefined,
      (dir) => {
        process.env[shellName] = "hg_shell";
        assert.deepEqual(heygenCredential(), { headers: { "X-Api-Key": "hg_shell" } });
        writeFileSync(join(dir, "credentials"), JSON.stringify({ api_key: "saved-wallet" }));
        assert.deepEqual(heygenCredential(), { headers: { "X-Api-Key": "hg_shell" } });
      },
      projectName,
    );
  });
}

// Loads a project .env with HEYGEN_API_KEY=hg_received and a saved key; arrange(root, project) places the record.
function receivedBy(arrange, load = (project) => project) {
  return withCleanHeygenEnv(() => {
    const root = mkdtempSync(join(tmpdir(), "heygen-rec-"));
    const project = join(root, "real", "p");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, ".env"), "HEYGEN_API_KEY=hg_received\n");
    process.env.HYPERFRAMES_CONFIG_DIR = join(root, "cred");
    mkdirSync(process.env.HYPERFRAMES_CONFIG_DIR);
    writeFileSync(join(root, "cred", "credentials"), JSON.stringify({ api_key: "saved-wallet" }));
    try {
      arrange(root, project);
      loadEnvFromDir(load(project, root));
      return heygenCredential().headers["X-Api-Key"];
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test(
  "a received .env reached through a linked folder is still received",
  { skip: process.platform === "win32" },
  () => {
    const key = receivedBy(
      (root, project) => {
        mkdirSync(join(root, "real", ".hyperframes"));
        writeFileSync(
          join(root, "real", ".hyperframes", "received-files.json"),
          JSON.stringify({ files: ["p/.env"] }),
        );
        symlinkSync(project, join(root, "link"));
      },
      (_project, root) => join(root, "link"),
    );
    assert.equal(key, "saved-wallet");
  },
);

test("a received .env listed under another path to the same file is received", () => {
  const key = receivedBy((_root, project) => {
    mkdirSync(join(project, ".hyperframes"));
    linkSync(join(project, ".env"), join(project, "copy.env"));
    writeFileSync(
      join(project, ".hyperframes", "received-files.json"),
      JSON.stringify({ files: ["copy.env"] }),
    );
  });
  assert.equal(key, "saved-wallet");
});

test("an unreadable record in the project's own folder counts its .env as received", () => {
  const key = receivedBy((_root, project) => {
    mkdirSync(join(project, ".hyperframes", "received-files.json"), { recursive: true });
  });
  assert.equal(key, "saved-wallet");
});

test("a project .env key works with no saved credential, and the process names its file once", () => {
  const lines = [];
  for (const [, record] of PROJECT_KINDS) {
    withProjectEnv("hg_project", record, (_dir, notes, project) => {
      assert.deepEqual(heygenCredential(), { headers: { "X-Api-Key": "hg_project" } });
      heygenCredential();
      lines.push(...notes.map((line) => line.replace(join(project, ".env"), "<file>")));
    });
  }
  assert.deepEqual(lines, [
    "[hyperframes] Using HEYGEN_API_KEY from the project .env (<file>): generated media goes to that key's HeyGen account.\n",
  ]);
});

for (const [why, oauth, state, hint] of [
  [
    "expired",
    { client_id: "Zg3LF4FCLoeJoGs2YqMtZ17g", expires_at: "2000-01-01T00:00:00Z" },
    { expired: true },
    /OAuth token expired — run `npx hyperframes auth refresh`/,
  ],
  [
    "from another client",
    { client_id: "shared-heygen-client", expires_at: "2099-01-01T00:00:00Z" },
    { expired: true, foreign: true },
    /another OAuth client or environment — run `npx hyperframes auth login`/,
  ],
]) {
  for (const [kind, record] of PROJECT_KINDS) {
    test(`a project .env key from ${kind} never replaces a saved login that is ${why}`, () => {
      withProjectEnv("hg_project", record, (dir, notes) => {
        const login = {
          token_endpoint: "https://api2.heygen.com/v1/oauth/token",
          access_token: "at_login",
          ...oauth,
        };
        writeFileSync(join(dir, "credentials"), JSON.stringify({ oauth: login }));
        assert.deepEqual(heygenCredential(), state);
        assert.throws(() => heygenAuthHeaders(), hint);
        assert.deepEqual(notes, []);
      });
    });
  }
}

for (const [kind, record] of PROJECT_KINDS) {
  test(`a malformed credentials file refuses a project .env key from ${kind} and says to fix that file`, () => {
    withProjectEnv("hg_project", record, (dir, notes) => {
      writeFileSync(join(dir, "credentials"), "{not valid");
      assert.equal(heygenCredential(), null);
      assert.throws(() => heygenAuthHeaders(), /can't be read \(not valid JSON\)/);
      assert.deepEqual(notes, []);
    });
  });
}

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
      process.env.HYPERFRAMES_CONFIG_DIR = dir;
      writeFileSync(
        join(dir, "credentials"),
        JSON.stringify({
          oauth: {
            client_id: "Zg3LF4FCLoeJoGs2YqMtZ17g",
            token_endpoint: "https://api2.heygen.com/v1/oauth/token",
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
      process.env.HYPERFRAMES_CONFIG_DIR = dir; // no credentials file written
      assert.equal(heygenAuthMethod(), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("an expired or foreign OAuth login never falls back to a saved API wallet", () => {
  withCleanHeygenEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "hf-auth-payer-"));
    try {
      process.env.HYPERFRAMES_CONFIG_DIR = dir;
      const credential = {
        api_key: "other-wallet",
        oauth: {
          client_id: "Zg3LF4FCLoeJoGs2YqMtZ17g",
          token_endpoint: "https://api2.heygen.com/v1/oauth/token",
          access_token: "expired",
          expires_at: "2000-01-01T00:00:00Z",
        },
      };
      writeFileSync(join(dir, "credentials"), JSON.stringify(credential));
      assert.deepEqual(heygenCredential(), { expired: true });
      credential.oauth.expires_at = "2099-01-01T00:00:00Z";
      credential.oauth.client_id = "shared-heygen-client";
      writeFileSync(join(dir, "credentials"), JSON.stringify(credential));
      assert.deepEqual(heygenCredential(), { expired: true, foreign: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("loadEnvFromDir skips a .env folder and loads the .env file above it", () => {
  const root = mkdtempSync(join(tmpdir(), "heygen-env-"));
  const project = join(root, "project");
  mkdirSync(join(project, ".env"), { recursive: true });
  writeFileSync(join(root, ".env"), "ELEVENLABS_API_KEY=from-parent\n");
  const saved = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    withCleanHeygenEnv(() => {
      process.env.HYPERFRAMES_CONFIG_DIR = join(root, "no-config");
      loadEnvFromDir(project);
    });
    assert.equal(process.env.ELEVENLABS_API_KEY, "from-parent");
  } finally {
    if (saved === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = saved;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a project's .env supplies provider keys only, never programs, runtime options or another account", () => {
  const keys = [
    "ELEVENLABS_API_KEY",
    "HYPERFRAMES_PYTHON",
    "HYPERFRAMES_PARAKEET",
    "NODE_OPTIONS",
    "npm_config_registry",
    "DYLD_INSERT_LIBRARIES",
    "HYPERFRAMES_CONFIG_DIR",
    "HEYGEN_ACCESS_TOKEN",
    "HYPERFRAMES_CLI_ENTRY",
    "GOOGLE_APPLICATION_CREDENTIALS",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  const project = mkdtempSync(join(tmpdir(), "heygen-env-"));
  writeFileSync(join(project, ".env"), keys.map((key) => `${key}=/project/value`).join("\n"));
  const configDir = join(project, "no-config");
  try {
    withCleanHeygenEnv(() => {
      process.env.HYPERFRAMES_CONFIG_DIR = configDir;
      loadEnvFromDir(project);
      assert.equal(process.env.ELEVENLABS_API_KEY, "/project/value");
      assert.equal(process.env.HYPERFRAMES_CONFIG_DIR, configDir);
      for (const key of keys.slice(1).filter((key) => key !== "HYPERFRAMES_CONFIG_DIR"))
        assert.equal(process.env[key], undefined, key);
    });
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(project, { recursive: true, force: true });
  }
});

test("a project's .env cannot name the HeyGen base, so a shell key never leaves for its host", () => {
  withCleanHeygenEnv(() => {
    const project = mkdtempSync(join(tmpdir(), "heygen-env-"));
    writeFileSync(
      join(project, ".env"),
      "HEYGEN_API_BASE=https://proxy.example.com\nHEYGEN_ALLOW_HTTP=1\nHYPERFRAMES_TTS_CONCURRENCY=3\n",
    );
    const savedConcurrency = process.env.HYPERFRAMES_TTS_CONCURRENCY;
    delete process.env.HYPERFRAMES_TTS_CONCURRENCY;
    try {
      process.env.HEYGEN_API_KEY = "hg_shell_real";
      loadEnvFromDir(project);
      assert.equal(process.env.HYPERFRAMES_TTS_CONCURRENCY, "3");
      assert.equal(process.env.HEYGEN_API_BASE, undefined);
      assert.equal(process.env.HEYGEN_ALLOW_HTTP, undefined);
      assert.equal(heygenBase(), "https://api.heygen.com/v3");
    } finally {
      if (savedConcurrency === undefined) delete process.env.HYPERFRAMES_TTS_CONCURRENCY;
      else process.env.HYPERFRAMES_TTS_CONCURRENCY = savedConcurrency;
      rmSync(project, { recursive: true, force: true });
    }
  });
});

test("heygenAuthMethod returns null when the credentials path is a folder", () => {
  withCleanHeygenEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-cred-"));
    try {
      mkdirSync(join(dir, "credentials"));
      process.env.HYPERFRAMES_CONFIG_DIR = dir;
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
      process.env.HYPERFRAMES_CONFIG_DIR = dir;
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
      process.env.HYPERFRAMES_CONFIG_DIR = dir;
      assert.throws(() => heygenAuthHeaders(), /no HyperFrames credentials/);
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
      process.env.HYPERFRAMES_CONFIG_DIR = dir;
      writeFileSync(join(dir, "credentials"), JSON.stringify({ api_key: "hg_stored" }));
      process.env.HEYGEN_ACCESS_TOKEN = "at_host";
      process.env.HEYGEN_API_BASE = "https://proxy.example.com";
      assert.equal(heygenCredential(), null);
      assert.throws(() => heygenAuthHeaders(), /no HyperFrames credentials/);
      // HeyGen's own hosts keep every credential source.
      process.env.HEYGEN_API_BASE = "https://api-canary.heygen.com";
      assert.equal(heygenAuthMethod(), "oauth");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("a refused HyperFrames-plan call becomes one line with the billing command", () => {
  const refused = (code) => ({
    status: 402,
    body: JSON.stringify({ error: { code, message: "raw" } }),
  });
  assert.equal(
    heygenMessage(refused("hf_subscription_required")),
    "This needs a HyperFrames plan. Run `npx hyperframes billing subscribe --skill media-use`: it opens the page and waits.",
  );
  assert.equal(
    heygenMessage(refused("hf_usage_exhausted")),
    "Out of HyperFrames credits. Run `npx hyperframes billing add-credits --skill media-use`: it opens the page and waits.",
  );
  assert.match(
    heygenMessage({ status: 403, body: JSON.stringify({ error: { code: "api_key_required" } }) }),
    /Nothing was charged/,
  );
  // Every other failure keeps HeyGen's own words.
  assert.equal(
    billingRefusal({
      status: 400,
      body: JSON.stringify({ error: { code: "invalid_parameter", message: "bad voice" } }),
    }),
    null,
  );
  assert.equal(
    heygenMessage({ status: 400, body: JSON.stringify({ error: { message: "bad voice" } }) }),
    "bad voice",
  );
});

const PROVIDER_ENV = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GCS_CREDS",
  "ELEVENLABS_API_KEY",
  "HYPERFRAMES_PROJECT_ENV_ORIGINS",
];

// Runs fn(project, notes) with HeyGen and provider variables unset, no saved credentials, the given shell variables
// set and a project folder whose .env holds `env`; `received` lists that .env in a received-files record.
function withProviderProject({ shell = {}, env, received }, fn) {
  return withCleanHeygenEnv(() => {
    const previous = Object.fromEntries(PROVIDER_ENV.map((name) => [name, process.env[name]]));
    const project = mkdtempSync(join(tmpdir(), "hf-media-provider-"));
    const notes = [];
    const write = process.stderr.write;
    try {
      for (const name of PROVIDER_ENV) delete process.env[name];
      process.env.HYPERFRAMES_CONFIG_DIR = join(project, "no-config");
      Object.assign(process.env, shell);
      writeFileSync(join(project, ".env"), env);
      if (received) {
        mkdirSync(join(project, ".hyperframes"));
        writeFileSync(
          join(project, ".hyperframes", "received-files.json"),
          JSON.stringify({ files: [".env"] }),
        );
      }
      process.stderr.write = (line) => notes.push(String(line));
      fn(project, notes);
    } finally {
      process.stderr.write = write;
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      rmSync(project, { recursive: true, force: true });
    }
  });
}

test("loadEnvFromDir leaves out a received .env's Gemini key when the shell has Gemini credentials", () => {
  withProviderProject(
    {
      shell: { GOOGLE_APPLICATION_CREDENTIALS: "/own/sa.json" },
      env: "GEMINI_API_KEY=received\n",
      received: true,
    },
    (project, notes) => {
      loadEnvFromDir(project);
      assert.equal(process.env.GEMINI_API_KEY, undefined);
      assert.match(
        notes.join(""),
        /ignoring GEMINI_API_KEY from a received project .*GOOGLE_APPLICATION_CREDENTIALS/,
      );
    },
  );
});

test("loadEnvFromDir keeps a person's own .env Gemini key next to a shell service account music cannot use", () => {
  withProviderProject(
    { shell: { GOOGLE_APPLICATION_CREDENTIALS: "/own/sa.json" }, env: "GEMINI_API_KEY=mine\n" },
    (project, notes) => {
      loadEnvFromDir(project);
      assert.equal(process.env.GEMINI_API_KEY, "mine");
      assert.deepEqual(notes, []);
    },
  );
});

test("loadEnvFromDir leaves out a project .env's Gemini key when the shell has the other Gemini API key", () => {
  withProviderProject(
    { shell: { GOOGLE_API_KEY: "own" }, env: "GEMINI_API_KEY=cloned\n" },
    (project, notes) => {
      loadEnvFromDir(project);
      assert.equal(process.env.GEMINI_API_KEY, undefined);
      assert.match(
        notes.join(""),
        /ignoring GEMINI_API_KEY from a project \.env .*using your own GOOGLE_API_KEY/,
      );
    },
  );
});

test("loadEnvFromDir keeps a project .env's Gemini key when the person has no Gemini credential", () => {
  withProviderProject({ env: "GEMINI_API_KEY=mine\n" }, (project, notes) => {
    loadEnvFromDir(project);
    assert.equal(process.env.GEMINI_API_KEY, "mine");
    assert.deepEqual(notes, []);
  });
});

test("loadEnvFromDir keeps a person's own .env ElevenLabs key for an explicit provider choice", () => {
  withProviderProject(
    { shell: { HEYGEN_API_KEY: "own" }, env: "ELEVENLABS_API_KEY=mine\n" },
    (project) => {
      loadEnvFromDir(project);
      assert.equal(process.env.ELEVENLABS_API_KEY, "mine");
    },
  );
});

test("loadEnvFromDir leaves out a received .env's ElevenLabs key when the person has a HeyGen key", () => {
  withProviderProject(
    { shell: { HEYGEN_API_KEY: "own" }, env: "ELEVENLABS_API_KEY=received\n", received: true },
    (project) => {
      loadEnvFromDir(project);
      assert.equal(process.env.ELEVENLABS_API_KEY, undefined);
    },
  );
});

test("a key the CLI took from a received .env gives way the same as one the script read", () => {
  withProviderProject({ env: "", received: true }, (project) => {
    process.env.HEYGEN_API_KEY = "own";
    process.env.ELEVENLABS_API_KEY = "received";
    process.env.HYPERFRAMES_PROJECT_ENV_ORIGINS = JSON.stringify({ ELEVENLABS_API_KEY: project });
    loadEnvFromDir(project);
    assert.equal(process.env.ELEVENLABS_API_KEY, undefined);
  });
});

test("a received .env's ElevenLabs key with no competing credential is used, with a note naming the file", () => {
  withProviderProject(
    { env: "ELEVENLABS_API_KEY=received\n", received: true },
    (project, notes) => {
      loadEnvFromDir(project);
      assert.equal(process.env.ELEVENLABS_API_KEY, "received");
      noteProjectElevenLabsKey();
      noteProjectElevenLabsKey();
      assert.equal(notes.length, 1);
      assert.match(notes[0], /Using ELEVENLABS_API_KEY from .*\.env, a received project:/);
    },
  );
});
