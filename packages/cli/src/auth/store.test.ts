import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAuthError } from "./errors.js";
import {
  clearOAuth,
  deleteStore,
  hasPreservedUnknownData,
  readStore,
  writeStore,
  type Credentials,
} from "./store.js";

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "hf-auth-store-"));
}

// POSIX file modes don't apply on Windows — `fs.chmod` only toggles the
// read-only bit there, so `stat.mode & 0o777` reports 0o666/0o444
// regardless of what we requested. Skip the mode assertions on win32;
// the 0600/0700 hardening is a Unix concern.
const IS_POSIX = process.platform !== "win32";

describe("auth/store", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await makeTmpDir();
    path = join(dir, "credentials");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns absent when the file does not exist", async () => {
    const result = await readStore(path);
    expect(result).toEqual({ credentials: {}, source: "absent" });
  });

  it("round-trips api_key only", async () => {
    const creds: Credentials = { api_key: "hg_test_abc" };
    await writeStore(creds, path);
    const result = await readStore(path);
    expect(result.source).toBe("file_json");
    expect(result.credentials).toEqual(creds);
  });

  it("round-trips oauth tokens", async () => {
    const creds: Credentials = {
      oauth: {
        access_token: "at_123",
        refresh_token: "rt_456",
        expires_at: "2026-06-25T12:00:00.000Z",
        scope: "openid profile",
        token_type: "Bearer",
      },
    };
    await writeStore(creds, path);
    const result = await readStore(path);
    expect(result.credentials).toEqual(creds);
  });

  it("round-trips both api_key and oauth", async () => {
    const creds: Credentials = {
      api_key: "hg_test_abc",
      oauth: { access_token: "at_123" },
    };
    await writeStore(creds, path);
    const result = await readStore(path);
    expect(result.credentials.api_key).toBe("hg_test_abc");
    expect(result.credentials.oauth?.access_token).toBe("at_123");
  });

  it("reads legacy one-line plaintext format", async () => {
    await fs.writeFile(path, "hg_legacy_key\n", { mode: 0o600 });
    const result = await readStore(path);
    expect(result.source).toBe("file_legacy");
    expect(result.credentials.api_key).toBe("hg_legacy_key");
  });

  it("treats empty file as absent", async () => {
    await fs.writeFile(path, "", { mode: 0o600 });
    const result = await readStore(path);
    expect(result.source).toBe("absent");
  });

  it("throws ErrInvalidStore on garbage JSON", async () => {
    await fs.writeFile(path, "{not valid json", { mode: 0o600 });
    await expect(readStore(path)).rejects.toSatisfy((err) => isAuthError(err));
  });

  it("throws ErrInvalidStore on multi-line non-JSON content", async () => {
    await fs.writeFile(path, "not\na\nkey", { mode: 0o600 });
    await expect(readStore(path)).rejects.toSatisfy((err) => isAuthError(err));
  });

  it.skipIf(!IS_POSIX)("writes file 0600 and dir 0700", async () => {
    const nested = join(dir, "sub", "deeper");
    const p = join(nested, "credentials");
    await writeStore({ api_key: "hg_x" }, p);
    expect((await fs.stat(p)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(nested)).mode & 0o777).toBe(0o700);
  });

  it("preserves content across overwrites", async () => {
    await writeStore({ api_key: "first" }, path);
    await writeStore({ api_key: "second" }, path);
    if (IS_POSIX) {
      expect((await fs.stat(path)).mode & 0o777).toBe(0o600);
    }
    const result = await readStore(path);
    expect(result.credentials.api_key).toBe("second");
  });

  it("rejects empty-string api_key", async () => {
    await fs.writeFile(path, JSON.stringify({ api_key: "" }), { mode: 0o600 });
    await expect(readStore(path)).rejects.toSatisfy((err) => isAuthError(err));
  });

  it("rejects api_key with CR/LF (header-injection guard)", async () => {
    await fs.writeFile(path, JSON.stringify({ api_key: "hg_x\r\nX-Evil: foo" }), { mode: 0o600 });
    await expect(readStore(path)).rejects.toSatisfy((err) => isAuthError(err));
  });

  it("strips oauth fields containing CR/LF rather than crashing later", async () => {
    await fs.writeFile(
      path,
      JSON.stringify({
        oauth: {
          access_token: "good_at",
          refresh_token: "bad_rt\r\nX-Smuggle: 1",
        },
      }),
      { mode: 0o600 },
    );
    const result = await readStore(path);
    expect(result.credentials.oauth?.access_token).toBe("good_at");
    expect(result.credentials.oauth?.refresh_token).toBeUndefined();
  });

  it("rejects access_token containing CR/LF (header-injection guard)", async () => {
    await fs.writeFile(path, JSON.stringify({ oauth: { access_token: "at\r\nX-Evil: 1" } }), {
      mode: 0o600,
    });
    await expect(readStore(path)).rejects.toSatisfy((err) => isAuthError(err));
  });

  it("accepts a legacy plaintext key of any HeyGen key format", async () => {
    // Real HeyGen keys come in multiple formats (`sk_V2_…`, `hg_…`,
    // partner keys, etc.). The CLI doesn't shape-check — the backend
    // does. Any single-line printable non-empty value is accepted as
    // a legacy key here; the next /v3/users/me call decides validity.
    await fs.writeFile(path, "sk_V2_hgu_kVzzCxfI3cT_Yi96MxT2Ki6UamtWxyP7oOIPqsxaFHqN", {
      mode: 0o600,
    });
    const result = await readStore(path);
    expect(result.source).toBe("file_legacy");
    expect(result.credentials.api_key).toBe(
      "sk_V2_hgu_kVzzCxfI3cT_Yi96MxT2Ki6UamtWxyP7oOIPqsxaFHqN",
    );
  });

  it("still rejects plaintext that contains a space (not a credential shape)", async () => {
    await fs.writeFile(path, "hello world this is not a key", { mode: 0o600 });
    await expect(readStore(path)).rejects.toSatisfy((err) => isAuthError(err));
  });

  it("still rejects too-short plaintext", async () => {
    await fs.writeFile(path, "tiny", { mode: 0o600 });
    await expect(readStore(path)).rejects.toSatisfy((err) => isAuthError(err));
  });

  it("rejects oauth without access_token", async () => {
    await fs.writeFile(path, JSON.stringify({ oauth: { refresh_token: "rt" } }), {
      mode: 0o600,
    });
    await expect(readStore(path)).rejects.toSatisfy((err) => isAuthError(err));
  });

  it("exposes only the typed surface for known keys (unknown keys hidden from callers)", async () => {
    // The typed `credentials` view shows only the modelled keys —
    // unknown/foreign keys are captured in a hidden (symbol-keyed)
    // passthrough slot, not the enumerable surface, so callers can't
    // accidentally read them. Round-trip preservation is covered below.
    await fs.writeFile(path, JSON.stringify({ api_key: "hg_x", future_field: { stuff: 1 } }), {
      mode: 0o600,
    });
    const result = await readStore(path);
    expect(Object.keys(result.credentials)).toEqual(["api_key"]);
    expect(result.credentials.api_key).toBe("hg_x");
  });

  // --- Cross-CLI forward compatibility: unknown-field preservation. ---
  // The credentials file is SHARED with the Go `heygen` CLI. If this CLI
  // strips keys it doesn't model when it writes the file back, it
  // silently destroys the other CLI's data (and vice versa). The writer
  // MUST round-trip unknown fields untouched.

  it("preserves an unknown TOP-LEVEL key across a read → write round-trip", async () => {
    // Simulate a file another CLI version wrote with a future key.
    await fs.writeFile(
      path,
      JSON.stringify({ api_key: "hg_x", future_field: { nested: [1, 2], flag: true } }),
      { mode: 0o600 },
    );
    // Read it, then write back a typed update (here: just the api_key it
    // surfaced). The unknown key must survive.
    const { credentials } = await readStore(path);
    await writeStore(credentials, path);

    const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
    expect(onDisk.api_key).toBe("hg_x");
    expect(onDisk.future_field).toEqual({ nested: [1, 2], flag: true });
  });

  it("preserves the heygen-cli `user` block when this CLI rewrites only the credential", async () => {
    // The exact cross-CLI data-loss scenario: heygen-cli wrote a `user`
    // block; hyperframes-cli updates the api_key and must not drop it.
    await fs.writeFile(
      path,
      JSON.stringify({
        api_key: "hg_old",
        user: { email: "jane@example.com", first_name: "Jane", last_name: "Doe", username: "jdoe" },
      }),
      { mode: 0o600 },
    );
    const { credentials } = await readStore(path);
    credentials.api_key = "hg_new";
    await writeStore(credentials, path);

    const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
    expect(onDisk.api_key).toBe("hg_new");
    expect(onDisk.user).toEqual({
      email: "jane@example.com",
      first_name: "Jane",
      last_name: "Doe",
      username: "jdoe",
    });
  });

  it("preserves an unknown key INSIDE the oauth sub-object", async () => {
    await fs.writeFile(
      path,
      JSON.stringify({
        oauth: { access_token: "at_1", id_token: "future_id_token_value" },
      }),
      { mode: 0o600 },
    );
    const { credentials } = await readStore(path);
    await writeStore(credentials, path);

    const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
    expect(onDisk.oauth.access_token).toBe("at_1");
    expect(onDisk.oauth.id_token).toBe("future_id_token_value");
  });

  it("preserves an unknown key INSIDE the user sub-object", async () => {
    await fs.writeFile(
      path,
      JSON.stringify({
        api_key: "hg_x",
        user: { email: "u@example.com", avatar_url: "https://cdn/x.png" },
      }),
      { mode: 0o600 },
    );
    const { credentials } = await readStore(path);
    await writeStore(credentials, path);

    const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
    expect(onDisk.user.email).toBe("u@example.com");
    expect(onDisk.user.avatar_url).toBe("https://cdn/x.png");
  });

  it("round-trips the user block (schema + omitempty: empty fields are not written)", async () => {
    const creds: Credentials = {
      api_key: "hg_x",
      user: { email: "u@example.com", username: "u" },
    };
    await writeStore(creds, path);
    const result = await readStore(path);
    expect(result.credentials.user).toEqual({ email: "u@example.com", username: "u" });

    // omitempty: only the populated fields appear on disk — no empty
    // first_name / last_name strings littering the file.
    const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
    expect(onDisk.user).toEqual({ email: "u@example.com", username: "u" });
    expect(Object.keys(onDisk.user)).toEqual(["email", "username"]);
  });

  it('omits an all-empty user block entirely (no `"user": {}` litter)', async () => {
    await writeStore({ api_key: "hg_x", user: {} }, path);
    const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
    expect(onDisk.user).toBeUndefined();
    expect(onDisk.api_key).toBe("hg_x");
  });

  it("backwards-compat: a legacy file WITHOUT a user block parses with user undefined", async () => {
    await fs.writeFile(path, JSON.stringify({ api_key: "hg_legacy" }), { mode: 0o600 });
    const result = await readStore(path);
    expect(result.source).toBe("file_json");
    expect(result.credentials.api_key).toBe("hg_legacy");
    expect(result.credentials.user).toBeUndefined();
  });

  it("ignores a malformed user sub-field rather than rejecting the whole file", async () => {
    // The user block is additive metadata — a junk sub-field must never
    // block resolving a perfectly good api_key. Non-string fields are
    // dropped; the credential survives.
    await fs.writeFile(
      path,
      JSON.stringify({ api_key: "hg_x", user: { email: "u@example.com", first_name: 12345 } }),
      { mode: 0o600 },
    );
    const result = await readStore(path);
    expect(result.credentials.api_key).toBe("hg_x");
    expect(result.credentials.user).toEqual({ email: "u@example.com" });
  });

  it("deleteStore is idempotent", async () => {
    await writeStore({ api_key: "hg_x" }, path);
    await deleteStore(path);
    await deleteStore(path);
    await expect(fs.access(path)).rejects.toThrow();
  });

  it("clearOAuth removes only the oauth field", async () => {
    await writeStore({ api_key: "hg_keep", oauth: { access_token: "drop_me" } }, path);
    await clearOAuth(path);
    const result = await readStore(path);
    expect(result.credentials.oauth).toBeUndefined();
    expect(result.credentials.api_key).toBe("hg_keep");
  });

  it("clearOAuth removes the whole file when no api_key remains", async () => {
    await writeStore({ oauth: { access_token: "only" } }, path);
    await clearOAuth(path);
    await expect(fs.access(path)).rejects.toThrow();
  });

  it("clearOAuth keeps the user block (and unknown keys) when an api_key survives", async () => {
    await fs.writeFile(
      path,
      JSON.stringify({
        api_key: "hg_keep",
        oauth: { access_token: "drop_me" },
        user: { email: "u@example.com" },
        future_field: 1,
      }),
      { mode: 0o600 },
    );
    await clearOAuth(path);
    const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
    expect(onDisk.oauth).toBeUndefined();
    expect(onDisk.api_key).toBe("hg_keep");
    expect(onDisk.user).toEqual({ email: "u@example.com" });
    expect(onDisk.future_field).toBe(1);
  });

  it("clearOAuth is a no-op when file is absent", async () => {
    await clearOAuth(path);
    await expect(fs.access(path)).rejects.toThrow();
  });

  // --- Destructive paths must not clobber preserved unknown data. ---
  // When clearing the only known credential would otherwise delete the
  // file, a surviving unknown/foreign top-level key (a future credential
  // another CLI owns) must keep the file alive — deleting would clobber
  // exactly the cross-CLI data this machinery exists to preserve.

  it("clearOAuth keeps the file (writing the unknown bag) when no api_key but a foreign top-level key survives", async () => {
    await fs.writeFile(
      path,
      JSON.stringify({
        oauth: { access_token: "drop_me" },
        future_credential: { token: "owned_by_other_cli" },
      }),
      { mode: 0o600 },
    );
    await clearOAuth(path);
    // File must still exist and carry the foreign key.
    const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
    expect(onDisk.oauth).toBeUndefined();
    expect(onDisk.future_credential).toEqual({ token: "owned_by_other_cli" });
  });

  it("clearOAuth keeps the file when no api_key but a foreign key survives inside the user block", async () => {
    // The user block has no known friendly fields, only a foreign sub-key
    // — the block itself survives the oauth clear, so its unknown data
    // must too.
    await fs.writeFile(
      path,
      JSON.stringify({
        oauth: { access_token: "drop_me" },
        user: { external_org_id: "org_123" },
      }),
      { mode: 0o600 },
    );
    await clearOAuth(path);
    const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
    expect(onDisk.oauth).toBeUndefined();
    expect(onDisk.user).toEqual({ external_org_id: "org_123" });
  });

  it("clearOAuth still deletes the file when only a known (empty-after-clear) surface remains", async () => {
    // No api_key, no foreign data — just the oauth block being cleared.
    // Nothing worth preserving, so the file goes.
    await writeStore({ oauth: { access_token: "only" } }, path);
    await clearOAuth(path);
    await expect(fs.access(path)).rejects.toThrow();
  });

  describe("hasPreservedUnknownData", () => {
    it("false for an empty record", () => {
      expect(hasPreservedUnknownData({})).toBe(false);
    });

    it("false for a record with only known fields", () => {
      expect(
        hasPreservedUnknownData({
          api_key: "hg_x",
          oauth: { access_token: "at" },
          user: { email: "u@example.com" },
        }),
      ).toBe(false);
    });

    it("true when a top-level unknown key was captured at read time", async () => {
      await fs.writeFile(path, JSON.stringify({ api_key: "hg_x", future_field: 1 }), {
        mode: 0o600,
      });
      const { credentials } = await readStore(path);
      expect(hasPreservedUnknownData(credentials)).toBe(true);
    });

    it("true when an unknown key was captured inside the oauth sub-object", async () => {
      await fs.writeFile(
        path,
        JSON.stringify({ oauth: { access_token: "at", id_token: "future" } }),
        { mode: 0o600 },
      );
      const { credentials } = await readStore(path);
      expect(hasPreservedUnknownData(credentials)).toBe(true);
    });

    it("true when an unknown key was captured inside the user sub-object", async () => {
      await fs.writeFile(
        path,
        JSON.stringify({ api_key: "hg_x", user: { email: "u@example.com", avatar_url: "x" } }),
        { mode: 0o600 },
      );
      const { credentials } = await readStore(path);
      expect(hasPreservedUnknownData(credentials)).toBe(true);
    });
  });
});
