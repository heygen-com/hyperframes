import { afterEach, describe, expect, it, vi } from "vitest";
import { isSafeVersion } from "./updateCheck.js";

describe("isSafeVersion", () => {
  it("accepts strict semver, incl. prerelease/build metadata", () => {
    expect(isSafeVersion("1.2.3")).toBe(true);
    expect(isSafeVersion("0.7.28")).toBe(true);
    expect(isSafeVersion("1.2.3-beta.1")).toBe(true);
    expect(isSafeVersion("1.2.3+build.5")).toBe(true);
  });

  it("rejects anything that could carry shell metacharacters or isn't semver", () => {
    expect(isSafeVersion("")).toBe(false);
    expect(isSafeVersion("latest")).toBe(false);
    expect(isSafeVersion("1.2")).toBe(false);
    expect(isSafeVersion("1.2.3; rm -rf /")).toBe(false);
    expect(isSafeVersion("1.2.3 && curl evil")).toBe(false);
    expect(isSafeVersion("$(whoami)")).toBe(false);
  });
});

/**
 * Drive printUpdateNotice under controlled mocks. isDevMode() is true under
 * vitest (the module path ends in .ts), which would suppress the notice, so we
 * mock ./env.js. detectInstaller and readConfig are mocked to pick the branch.
 */
async function noticeWith(opts: {
  installerCommand: string | null;
  latestVersion?: string;
  isTTY?: boolean;
  env?: Record<string, string | undefined>;
}): Promise<string> {
  vi.resetModules();
  vi.doMock("./env.js", () => ({ isDevMode: () => false }));
  vi.doMock("./installerDetection.js", () => ({
    detectInstaller: () => ({
      kind: opts.installerCommand ? "npm" : "skip",
      installCommand: () => opts.installerCommand,
      reason: "test",
    }),
  }));
  vi.doMock("../telemetry/config.js", () => ({
    readConfig: () => ({ latestVersion: opts.latestVersion ?? "9.9.9" }),
    writeConfig: () => {},
  }));

  const origEnv = { ...process.env };
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // Default to a non-CI interactive terminal unless the test overrides env.
  if (!("CI" in (opts.env ?? {}))) delete process.env["CI"];

  const origTTY = process.stderr.isTTY;
  Object.defineProperty(process.stderr, "isTTY", {
    value: opts.isTTY ?? true,
    configurable: true,
  });
  const writes: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  try {
    const mod = await import("./updateCheck.js");
    mod.printUpdateNotice();
  } finally {
    process.stderr.write = origWrite;
    Object.defineProperty(process.stderr, "isTTY", { value: origTTY, configurable: true });
    process.env = origEnv;
  }
  return writes.join("");
}

describe("printUpdateNotice — install-method-aware command", () => {
  afterEach(() => {
    vi.doUnmock("./env.js");
    vi.doUnmock("./installerDetection.js");
    vi.doUnmock("../telemetry/config.js");
    vi.resetModules();
  });

  it("shows the detected manager's command for an owned global install", async () => {
    const out = await noticeWith({ installerCommand: "brew upgrade hyperframes" });
    expect(out).toContain("Update available");
    expect(out).toContain("brew upgrade hyperframes");
    expect(out).not.toContain("npx hyperframes@latest");
  });

  it("falls back to npx hyperframes@latest when the install method is skip/unknown", async () => {
    const out = await noticeWith({ installerCommand: null });
    expect(out).toContain("npx hyperframes@latest");
  });

  it("is suppressed on a non-TTY stderr", async () => {
    const out = await noticeWith({ installerCommand: "brew upgrade hyperframes", isTTY: false });
    expect(out).toBe("");
  });

  it("is suppressed in CI", async () => {
    const out = await noticeWith({
      installerCommand: "brew upgrade hyperframes",
      env: { CI: "true" },
    });
    expect(out).toBe("");
  });

  it("is suppressed by the HYPERFRAMES_NO_UPDATE_CHECK opt-out", async () => {
    const out = await noticeWith({
      installerCommand: "brew upgrade hyperframes",
      env: { HYPERFRAMES_NO_UPDATE_CHECK: "1" },
    });
    expect(out).toBe("");
  });
});
