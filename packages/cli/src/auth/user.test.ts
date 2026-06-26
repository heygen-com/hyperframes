import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStore, writeStore } from "./store.js";
import {
  clearUserInfo,
  isUserInfoEmpty,
  loadUserInfo,
  saveUserInfo,
  userDisplayName,
  type StoredUserInfo,
} from "./user.js";

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "hf-auth-user-"));
}

describe("auth/user — userDisplayName priority", () => {
  const cases: { name: string; ui: StoredUserInfo; want: string | undefined }[] = [
    {
      name: "email wins over everything",
      ui: { email: "u@example.com", first_name: "Jane", last_name: "Doe", username: "jdoe" },
      want: "u@example.com",
    },
    {
      name: "no email → first last",
      ui: { first_name: "Jane", last_name: "Doe", username: "jdoe" },
      want: "Jane Doe",
    },
    { name: "only first name", ui: { first_name: "Jane", username: "jdoe" }, want: "Jane" },
    { name: "only last name", ui: { last_name: "Doe", username: "jdoe" }, want: "Doe" },
    { name: "only username", ui: { username: "jdoe" }, want: "jdoe" },
    { name: "all empty → undefined", ui: {}, want: undefined },
  ];
  for (const tc of cases) {
    it(tc.name, () => {
      expect(userDisplayName(tc.ui)).toBe(tc.want);
    });
  }
});

describe("auth/user — isUserInfoEmpty", () => {
  it("true for an all-empty block", () => {
    expect(isUserInfoEmpty({})).toBe(true);
  });
  it("false when any field is set", () => {
    expect(isUserInfoEmpty({ email: "u@example.com" })).toBe(false);
    expect(isUserInfoEmpty({ username: "u" })).toBe(false);
    expect(isUserInfoEmpty({ first_name: "J" })).toBe(false);
    expect(isUserInfoEmpty({ last_name: "D" })).toBe(false);
  });
});

describe("auth/user — save / load / clear", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await makeTmpDir();
    path = join(dir, "credentials");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("round-trips a user block through the credentials file", async () => {
    await writeStore({ api_key: "hg_x" }, path);
    const ui: StoredUserInfo = {
      email: "u@example.com",
      first_name: "Jane",
      last_name: "Doe",
      username: "jdoe",
    };
    await saveUserInfo(ui, path);
    expect(await loadUserInfo(path)).toEqual(ui);
  });

  it("saveUserInfo preserves a co-located api_key", async () => {
    await writeStore({ api_key: "hg_keep" }, path);
    await saveUserInfo({ email: "u@example.com" }, path);
    const { credentials } = await readStore(path);
    expect(credentials.api_key).toBe("hg_keep");
    expect(credentials.user).toEqual({ email: "u@example.com" });
  });

  it("saveUserInfo upgrades a legacy plaintext file to JSON with the user block", async () => {
    await fs.writeFile(path, "hg_legacy_key\n", { mode: 0o600 });
    await saveUserInfo({ email: "u@example.com" }, path);
    const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
    expect(onDisk.api_key).toBe("hg_legacy_key");
    expect(onDisk.user).toEqual({ email: "u@example.com" });
  });

  it("saveUserInfo with an empty block is a no-op (does not blank an existing block)", async () => {
    await writeStore({ api_key: "hg_x", user: { email: "keep@example.com" } }, path);
    const before = await fs.readFile(path, "utf8");
    await saveUserInfo({}, path);
    const after = await fs.readFile(path, "utf8");
    expect(after).toBe(before);
    expect(await loadUserInfo(path)).toEqual({ email: "keep@example.com" });
  });

  it("loadUserInfo returns null for an absent file", async () => {
    expect(await loadUserInfo(path)).toBeNull();
  });

  it("loadUserInfo returns null for a legacy file without a user block (backwards-compat)", async () => {
    await fs.writeFile(path, JSON.stringify({ api_key: "hg_legacy" }), { mode: 0o600 });
    expect(await loadUserInfo(path)).toBeNull();
  });

  it("clearUserInfo removes only the user block, keeping the credential", async () => {
    await writeStore({ api_key: "hg_keep", user: { email: "u@example.com" } }, path);
    await clearUserInfo(path);
    const { credentials } = await readStore(path);
    expect(credentials.api_key).toBe("hg_keep");
    expect(credentials.user).toBeUndefined();
  });

  it("clearUserInfo removes the whole file when no credential survives", async () => {
    // A file holding ONLY a user block (no credential) — clearing leaves
    // nothing, so the file should be removed entirely.
    await fs.writeFile(path, JSON.stringify({ user: { email: "u@example.com" } }), { mode: 0o600 });
    await clearUserInfo(path);
    await expect(fs.access(path)).rejects.toThrow();
  });

  it("clearUserInfo is a no-op when there is no user block", async () => {
    await writeStore({ api_key: "hg_only" }, path);
    const before = await fs.readFile(path, "utf8");
    await clearUserInfo(path);
    const after = await fs.readFile(path, "utf8");
    expect(after).toBe(before);
  });

  it("clearUserInfo keeps the file (preserving a foreign top-level key) when no credential survives", async () => {
    // The file holds a user block plus a future/foreign top-level key but
    // NO known credential. Clearing the user block must NOT delete the
    // file — the foreign key may be a credential another CLI owns, and
    // dropping it would clobber the cross-CLI data the store preserves.
    await fs.writeFile(
      path,
      JSON.stringify({
        user: { email: "u@example.com" },
        future_credential: { token: "owned_by_other_cli" },
      }),
      { mode: 0o600 },
    );
    await clearUserInfo(path);
    const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
    expect(onDisk.user).toBeUndefined();
    expect(onDisk.future_credential).toEqual({ token: "owned_by_other_cli" });
  });

  it("saveUserInfo does not clobber an unknown/foreign top-level key", async () => {
    // The cross-CLI invariant exercised through the persistence helper.
    await fs.writeFile(path, JSON.stringify({ api_key: "hg_x", future_field: 42 }), {
      mode: 0o600,
    });
    await saveUserInfo({ email: "u@example.com" }, path);
    const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
    expect(onDisk.future_field).toBe(42);
    expect(onDisk.user).toEqual({ email: "u@example.com" });
  });
});
