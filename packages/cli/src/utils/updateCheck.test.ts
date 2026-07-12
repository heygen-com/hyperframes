import { afterEach, describe, expect, it, vi } from "vitest";
import { isSafeVersion, printDeprecationNotice, withMeta } from "./updateCheck.js";

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

/**
 * The registry-boundary guard: a poisoned or non-string data.version must
 * never be cached, because it flows into the auto-updater's install command.
 * This closes the injection class for every downstream consumer at one point.
 */
async function checkWith(registryVersion: unknown): Promise<{
  latest: string;
  wroteVersion: string | undefined;
}> {
  vi.resetModules();
  const writes: Array<Record<string, unknown>> = [];
  vi.doMock("../telemetry/config.js", () => ({
    readConfig: () => ({}),
    writeConfig: (c: Record<string, unknown>) => writes.push({ ...c }),
  }));
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ version: registryVersion }),
  })) as unknown as typeof fetch;
  try {
    const mod = await import("./updateCheck.js");
    const result = await mod.checkForUpdate(true);
    const lastWrite = writes.at(-1);
    return {
      latest: result.latest,
      wroteVersion: lastWrite ? (lastWrite["latestVersion"] as string | undefined) : undefined,
    };
  } finally {
    globalThis.fetch = origFetch;
  }
}

/**
 * U5: validate/inspect/layout are deprecated in favor of `check`. withMeta's
 * optional `{ deprecated: true }` is the single place that adds `_meta.deprecated`
 * to a --json envelope; every other command (check, lint, ...) calls withMeta
 * with no second argument and must never see the key at all — not even `false`.
 */
describe("withMeta — deprecated flag", () => {
  it("omits _meta.deprecated entirely when no options are passed (check/lint et al.)", () => {
    const wrapped = withMeta({ ok: true });
    expect("deprecated" in wrapped._meta).toBe(false);
  });

  it("omits _meta.deprecated when options.deprecated is false", () => {
    const wrapped = withMeta({ ok: true }, { deprecated: false });
    expect("deprecated" in wrapped._meta).toBe(false);
  });

  it("sets _meta.deprecated === true when requested (validate/inspect/layout)", () => {
    const wrapped = withMeta({ ok: true }, { deprecated: true });
    expect(wrapped._meta.deprecated).toBe(true);
  });

  it("preserves the rest of the _meta envelope alongside the deprecated flag", () => {
    const wrapped = withMeta({ ok: true }, { deprecated: true });
    expect(wrapped._meta.version).toEqual(expect.any(String));
    expect(typeof wrapped._meta.updateAvailable).toBe("boolean");
  });
});

/**
 * The stderr-only deprecation notice: printed once per invocation, never on
 * stdout, so --json output stays pure JSON while humans still see the notice.
 */
describe("printDeprecationNotice", () => {
  it("writes exactly one line to stderr, never stdout", () => {
    const stderrWrites: string[] = [];
    const stdoutWrites: string[] = [];
    const origErrWrite = process.stderr.write.bind(process.stderr);
    const origOutWrite = process.stdout.write.bind(process.stdout);
    process.stderr.write = ((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    process.stdout.write = ((chunk: unknown) => {
      stdoutWrites.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      printDeprecationNotice("validate");
    } finally {
      process.stderr.write = origErrWrite;
      process.stdout.write = origOutWrite;
    }

    expect(stdoutWrites).toEqual([]);
    expect(stderrWrites).toHaveLength(1);
    expect(stderrWrites[0]).toContain("hyperframes validate");
    expect(stderrWrites[0]).toContain("hyperframes check");
  });
});

describe("checkForUpdate — registry boundary guard", () => {
  afterEach(() => {
    vi.doUnmock("../telemetry/config.js");
    vi.resetModules();
  });

  it("caches and returns a valid semver from the registry", async () => {
    const { latest, wroteVersion } = await checkWith("9.9.9");
    expect(latest).toBe("9.9.9");
    expect(wroteVersion).toBe("9.9.9");
  });

  it("rejects a version carrying shell metacharacters (no cache, no surface)", async () => {
    const { latest, wroteVersion } = await checkWith("1.2.3; rm -rf /");
    expect(latest).not.toContain(";");
    expect(latest).not.toBe("1.2.3; rm -rf /");
    expect(wroteVersion).toBeUndefined(); // never written to config
  });

  it("rejects a non-string data.version", async () => {
    const { latest, wroteVersion } = await checkWith({ evil: true });
    expect(typeof latest).toBe("string");
    expect(wroteVersion).toBeUndefined();
  });
});
