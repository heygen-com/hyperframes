import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signedInHeygenUsername } from "./signedInUser.js";

describe("signedInHeygenUsername", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-signed-in-"));
    vi.stubEnv("HYPERFRAMES_CONFIG_DIR", dir);
    vi.stubEnv("HYPERFRAMES_ENV", "prod");
    vi.stubEnv("HEYGEN_CONFIG_DIR", join(dir, "heygen"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (contents: unknown, mtime: number, root = dir) => {
    mkdirSync(root, { recursive: true });
    const file = join(root, "credentials");
    writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
    utimesSync(file, mtime, mtime);
  };

  it("is undefined when nobody is signed in", () => {
    expect(signedInHeygenUsername()).toBeUndefined();
    write({ api_key: "hg_x" }, 1000);
    expect(signedInHeygenUsername()).toBeUndefined();
    write("hg_legacy_plain_key", 1001);
    expect(signedInHeygenUsername()).toBeUndefined();
  });

  it("returns the raw username after sign-in and drops it after sign-out", () => {
    write({ user: { username: "Alice" } }, 1999);
    expect(signedInHeygenUsername()).toBeUndefined();
    write({ api_key: "hg_x", user: { username: "Alice", email: "alice@example.com" } }, 2000);
    expect(signedInHeygenUsername()).toBe("Alice");
    write({ api_key: "hg_x" }, 2001);
    expect(signedInHeygenUsername()).toBeUndefined();
    rmSync(join(dir, "credentials"));
    expect(signedInHeygenUsername()).toBeUndefined();
  });

  it("uses the selected OAuth environment without falling back to HeyGen or production", () => {
    write({ api_key: "hg_other", user: { username: "Other" } }, 2000, join(dir, "heygen"));
    expect(signedInHeygenUsername()).toBeUndefined();
    write({ oauth: { access_token: "test-prod" }, user: { username: "Alice" } }, 2000);
    write(
      { oauth: { access_token: "test-dev" }, user: { username: "Bob" } },
      2000,
      join(dir, "dev"),
    );
    expect(signedInHeygenUsername()).toBe("Alice");
    vi.stubEnv("HYPERFRAMES_ENV", "dev");
    expect(signedInHeygenUsername()).toBe("Bob");
    rmSync(join(dir, "dev", "credentials"));
    expect(signedInHeygenUsername()).toBeUndefined();
  });
});
