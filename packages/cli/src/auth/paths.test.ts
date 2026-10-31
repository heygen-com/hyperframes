import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { CREDENTIAL_FILENAME, configDir, credentialPath } from "./paths.js";

describe("auth/paths", () => {
  const original = process.env["HYPERFRAMES_CONFIG_DIR"];

  beforeEach(() => {
    delete process.env["HYPERFRAMES_CONFIG_DIR"];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (original !== undefined) process.env["HYPERFRAMES_CONFIG_DIR"] = original;
    else delete process.env["HYPERFRAMES_CONFIG_DIR"];
  });

  it("defaults to ~/.hyperframes", () => {
    expect(configDir()).toBe(join(homedir(), ".hyperframes"));
  });

  it("honors HYPERFRAMES_CONFIG_DIR override", () => {
    process.env["HYPERFRAMES_CONFIG_DIR"] = "/tmp/some-test-dir";
    expect(configDir()).toBe("/tmp/some-test-dir");
    expect(credentialPath()).toBe(join("/tmp/some-test-dir", CREDENTIAL_FILENAME));
  });

  it("treats empty HYPERFRAMES_CONFIG_DIR as unset", () => {
    process.env["HYPERFRAMES_CONFIG_DIR"] = "";
    expect(configDir()).toBe(join(homedir(), ".hyperframes"));
  });

  it("ignores the HeyGen CLI directory and isolates the dev environment", () => {
    vi.stubEnv("HEYGEN_CONFIG_DIR", "/tmp/heygen-other-account");
    expect(configDir()).toBe(join(homedir(), ".hyperframes"));
    vi.stubEnv("HYPERFRAMES_ENV", "dev");
    expect(configDir()).toBe(join(homedir(), ".hyperframes", "dev"));
  });
});
