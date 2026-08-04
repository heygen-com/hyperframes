import { hostname, networkInterfaces } from "node:os";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

// CLI → Studio telemetry identity seeding (Layer 1). Verifies the server only
// hands the browser a distinct id when CLI telemetry is enabled, and passes
// through the anonymous machine id (no PII) otherwise.

const shouldTrack = vi.fn();
const readConfig = vi.fn();
// Pinned rather than using the real registry, so these string assertions
// don't move every time a canary is added, ramped, or retired.
const canaryDecisions = vi.fn<() => Record<string, { enabled: boolean; forced: boolean }>>();

// Every export the module under test imports must be mocked. Omitting
// `resetTelemetryPostureCache` / `readConfigFresh` made `refreshTelemetryPosture`
// throw a missing-export error that its own catch swallowed, so every
// assertion below ran against a refresh that silently did nothing.
const resetPostureCache = vi.fn();
const readConfigFresh = vi.fn();

vi.mock("../telemetry/client.js", () => ({
  shouldTrack: (...args: unknown[]) => shouldTrack(...args),
  resetTelemetryPostureCache: () => resetPostureCache(),
}));
vi.mock("../telemetry/config.js", () => ({
  readConfig: (...args: unknown[]) => readConfig(...args),
  readConfigFresh: () => readConfigFresh(),
}));
vi.mock("../telemetry/canary.js", () => ({
  canaryDecisionsForStudio: () => canaryDecisions(),
}));

const {
  resolveCliTelemetryDistinctId,
  buildCliIdentityScript,
  buildStudioHeadScripts,
  isLoopbackHost,
  buildStudioHeadScriptsForHost,
  refreshTelemetryPosture,
  identityAllowed,
} = await import("./telemetryIdentity.js");

describe("resolveCliTelemetryDistinctId", () => {
  beforeEach(() => {
    shouldTrack.mockReset();
    readConfig.mockReset();
    canaryDecisions.mockReset();
    canaryDecisions.mockReturnValue({});
  });

  it("returns the CLI anonymousId when telemetry is enabled", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid" });
    expect(resolveCliTelemetryDistinctId()).toBe("machine-uuid");
  });

  it("returns null when telemetry is disabled (opt-out / dev / CI)", () => {
    shouldTrack.mockReturnValue(false);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid" });
    expect(resolveCliTelemetryDistinctId()).toBeNull();
    // Must not even read config when suppressed.
    expect(readConfig).not.toHaveBeenCalled();
  });

  it("returns null when there is no anonymousId", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "" });
    expect(resolveCliTelemetryDistinctId()).toBeNull();
  });

  it("never throws — returns null if config reading fails", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockImplementation(() => {
      throw new Error("disk error");
    });
    expect(resolveCliTelemetryDistinctId()).toBeNull();
  });
});

describe("buildCliIdentityScript", () => {
  beforeEach(() => {
    shouldTrack.mockReset();
    readConfig.mockReset();
    canaryDecisions.mockReset();
    canaryDecisions.mockReturnValue({});
  });

  it("emits a script that sets window.__HF_CLI_DISTINCT_ID when telemetry is on", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid" });
    expect(buildCliIdentityScript()).toBe(
      '<script>window.__HF_CLI_DISTINCT_ID="machine-uuid";</script>',
    );
  });

  it("also seeds window.__HF_CLI_BUCKET_SEED when the config carries a bucket seed", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid", bucketSeed: "seed-uuid" });
    expect(buildCliIdentityScript()).toBe(
      '<script>window.__HF_CLI_DISTINCT_ID="machine-uuid";window.__HF_CLI_BUCKET_SEED="seed-uuid";</script>',
    );
  });

  it("emits an empty string when telemetry is off and there are no canaries", () => {
    shouldTrack.mockReturnValue(false);
    expect(buildCliIdentityScript()).toBe("");
  });

  // The cross-surface fix: with telemetry off the CLI resolves every canary
  // to telemetry_opt_out, and Studio cannot see that from its own separate
  // localStorage flag. Publishing the DECISIONS (not the identity) is what
  // stops Studio evaluating independently and enrolling anyway.
  it("still publishes canary decisions when telemetry is off, but no identity", () => {
    shouldTrack.mockReturnValue(false);
    canaryDecisions.mockReturnValue({ "de-parallel-router": { enabled: false, forced: false } });
    const script = buildCliIdentityScript();
    expect(script).toBe(
      "<script>window.__HF_CLI_CANARY_DECISIONS=" +
        '{"de-parallel-router":{"enabled":false,"forced":false}};</script>',
    );
    expect(script).not.toContain("__HF_CLI_DISTINCT_ID");
    expect(script).not.toContain("__HF_CLI_BUCKET_SEED");
  });

  it("publishes decisions alongside the identity when telemetry is on", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid", bucketSeed: "seed-uuid" });
    canaryDecisions.mockReturnValue({ "de-parallel-router": { enabled: true, forced: true } });
    expect(buildCliIdentityScript()).toBe(
      '<script>window.__HF_CLI_DISTINCT_ID="machine-uuid";' +
        'window.__HF_CLI_BUCKET_SEED="seed-uuid";' +
        "window.__HF_CLI_CANARY_DECISIONS=" +
        '{"de-parallel-router":{"enabled":true,"forced":true}};</script>',
    );
  });

  it("escapes a canary name that tries to close the script tag", () => {
    shouldTrack.mockReturnValue(false);
    canaryDecisions.mockReturnValue({
      "</script><script>alert(1)": { enabled: true, forced: false },
    });
    const script = buildCliIdentityScript();
    expect(script).not.toContain("</script><script>alert(1)");
    expect(script).toContain("__HF_CLI_CANARY_DECISIONS");
  });

  it("survives a throwing canary resolver — telemetry must never break preview", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid" });
    canaryDecisions.mockImplementation(() => {
      throw new Error("registry blew up");
    });
    expect(buildCliIdentityScript()).toBe(
      '<script>window.__HF_CLI_DISTINCT_ID="machine-uuid";</script>',
    );
  });

  it("JSON-encodes the id so it can't break out of the script literal", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "</script><script>alert(1)" });
    const script = buildCliIdentityScript();
    // The raw closing tag must be escaped by JSON.stringify, not emitted literally.
    expect(script).not.toContain("</script><script>alert(1)");
    expect(script).toContain("window.__HF_CLI_DISTINCT_ID=");
  });
});

describe("buildStudioHeadScripts", () => {
  beforeEach(() => {
    shouldTrack.mockReset();
    readConfig.mockReset();
    canaryDecisions.mockReset();
    canaryDecisions.mockReturnValue({});
  });

  const ENV_SCRIPT = "<script>window.__HF_STUDIO_ENV__={};</script>";

  it("places the CLI identity script before the env script so the global is set first", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid" });
    const head = buildStudioHeadScripts(ENV_SCRIPT);
    expect(head.indexOf("__HF_CLI_DISTINCT_ID")).toBeGreaterThanOrEqual(0);
    expect(head.indexOf("__HF_CLI_DISTINCT_ID")).toBeLessThan(head.indexOf("__HF_STUDIO_ENV__"));
  });

  it("returns just the env script when there is no identity and no canary", () => {
    shouldTrack.mockReturnValue(false);
    expect(buildStudioHeadScripts(ENV_SCRIPT)).toBe(ENV_SCRIPT);
  });
});

describe("isLoopbackHost (DNS-rebinding guard on the identity endpoint)", () => {
  it.each([
    "localhost",
    "localhost:5173",
    "127.0.0.1",
    "127.0.0.1:5173",
    "127.1.2.3",
    "[::1]",
    "[::1]:5173",
    "LOCALHOST:5173",
  ])("accepts the loopback host %s", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each([
    undefined,
    "",
    // The rebinding case: an attacker hostname resolving to 127.0.0.1 still
    // arrives with ITS name in Host, which is what makes this catchable.
    "evil.example.com",
    "evil.example.com:5173",
    "127.0.0.1.evil.com",
    "notlocalhost",
    "localhost.evil.com",
    "192.168.1.10",
    "0.0.0.0",
  ])("rejects %s", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe("buildStudioHeadScriptsForHost — Host split", () => {
  const ENV = "<script>window.__HF_STUDIO_ENV__={};</script>";

  beforeEach(() => {
    shouldTrack.mockReset();
    readConfig.mockReset();
    canaryDecisions.mockReset();
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "machine-uuid", bucketSeed: "seed-uuid" });
    canaryDecisions.mockReturnValue({ "de-parallel-router": { enabled: true, forced: false } });
  });

  it("publishes identity and decisions on a loopback Host", () => {
    const head = buildStudioHeadScriptsForHost(ENV, "127.0.0.1:5173");
    expect(head).toContain("__HF_CLI_DISTINCT_ID");
    expect(head).toContain("__HF_CLI_BUCKET_SEED");
    expect(head).toContain("__HF_CLI_CANARY_DECISIONS");
  });

  // DNS rebinding: identity must not be readable from a hostile origin.
  it("withholds identity and seed from a hostile Host", () => {
    const head = buildStudioHeadScriptsForHost(ENV, "evil.example.com");
    expect(head).not.toContain("__HF_CLI_DISTINCT_ID");
    expect(head).not.toContain("__HF_CLI_BUCKET_SEED");
  });

  // ...but the decisions map is NOT identifying, and withholding it would send
  // a supported LAN preview (HYPERFRAMES_PREVIEW_HOST=0.0.0.0) back to
  // re-deriving locally and disagreeing with the CLI.
  it.each(["evil.example.com", "192.168.1.10:5173", "my-dev-box.local:5173", undefined])(
    "still publishes canary decisions for non-loopback Host %s",
    (host) => {
      const head = buildStudioHeadScriptsForHost(ENV, host);
      expect(head).toContain("__HF_CLI_CANARY_DECISIONS");
      expect(head).not.toContain("__HF_CLI_DISTINCT_ID");
    },
  );

  it("always keeps the env script, whatever the Host", () => {
    expect(buildStudioHeadScriptsForHost(ENV, "evil.example.com")).toContain("__HF_STUDIO_ENV__");
    expect(buildStudioHeadScriptsForHost(ENV, "localhost")).toContain("__HF_STUDIO_ENV__");
  });
});

/**
 * Non-loopback names this machine answers to. Computed, not hardcoded: the
 * rule under test is "an address/name this host actually has", so a literal
 * like `192.168.1.10` would pass only by accident on one developer's laptop.
 */
function localHostCandidates(): string[] {
  const names = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (!entry.internal && entry.family === "IPv4") names.add(entry.address);
    }
  }
  const self = hostname().split(".")[0];
  if (self !== undefined && self !== "") names.add(`${self}.local`);
  return [...names];
}

describe("identityAllowed — loopback-bound vs explicitly LAN-bound", () => {
  const original = process.env["HYPERFRAMES_PREVIEW_HOST"];

  afterEach(() => {
    if (original === undefined) delete process.env["HYPERFRAMES_PREVIEW_HOST"];
    else process.env["HYPERFRAMES_PREVIEW_HOST"] = original;
  });

  describe("loopback-bound (the default)", () => {
    beforeEach(() => {
      delete process.env["HYPERFRAMES_PREVIEW_HOST"];
    });

    it.each(["localhost:5173", "127.0.0.1", "[::1]:3000"])("allows %s", (host) => {
      expect(identityAllowed(host)).toBe(true);
    });

    // A rebinding page cannot forge Host, so it arrives carrying its own name.
    it.each(["evil.example.com", "127.0.0.1.evil.com", "192.168.1.10:3000", undefined])(
      "refuses %s",
      (host) => {
        expect(identityAllowed(host)).toBe(false);
      },
    );
  });

  describe("explicitly LAN-bound", () => {
    beforeEach(() => {
      process.env["HYPERFRAMES_PREVIEW_HOST"] = "0.0.0.0";
    });

    // The mode this regressed: browsing your own LAN-exposed Studio lost the
    // CLI stitch entirely, so the same human became two PostHog persons. The
    // names come from this machine, because that is now the actual rule —
    // a hardcoded `192.168.1.10` asserted only that the check was absent.
    it.each(["0.0.0.0:3000", ...localHostCandidates().map((n) => `${n}:3000`)])(
      "allows %s once the operator opted into LAN exposure",
      (host) => {
        expect(identityAllowed(host)).toBe(true);
      },
    );

    // Setting the env var opted into LAN exposure, NOT into handing identity
    // to whatever name a rebinding page invents. This is the hole: the old
    // rule returned true for every one of these.
    it.each(["evil.example.com", "127.0.0.1.evil.com", "attacker.test:3000", undefined])(
      "still refuses hostile Host %s",
      (host) => {
        expect(identityAllowed(host)).toBe(false);
      },
    );

    it("refuses a LAN address this machine does not answer on", () => {
      expect(identityAllowed("203.0.113.7:3000")).toBe(false);
    });
  });

  // A loopback bind exposes nothing, so the Host check stays a live rebinding
  // mitigation — previously ANY non-empty value disabled it wholesale.
  describe("bound to loopback explicitly", () => {
    beforeEach(() => {
      process.env["HYPERFRAMES_PREVIEW_HOST"] = "127.0.0.1";
    });

    it.each(["localhost:5173", "127.0.0.1"])("still allows %s", (host) => {
      expect(identityAllowed(host)).toBe(true);
    });

    it.each(["evil.example.com", "192.168.1.10:3000"])("still refuses %s", (host) => {
      expect(identityAllowed(host)).toBe(false);
    });
  });
});

// A long-lived preview server: the posture it cached at boot must not outlive
// an opt-out run in another terminal. Studio has no poller for
// /api/telemetry-identity, so the refresh has to happen on the paths that
// actually run — the SPA document and the render boundary.
describe("cross-process opt-out refresh", () => {
  beforeEach(() => {
    resetPostureCache.mockClear();
    readConfigFresh.mockClear();
  });

  it("actually invalidates both caches — the mocks used to swallow this", () => {
    refreshTelemetryPosture();
    expect(readConfigFresh).toHaveBeenCalledTimes(1);
    expect(resetPostureCache).toHaveBeenCalledTimes(1);
  });

  it("refreshes before building a head script", () => {
    shouldTrack.mockReturnValue(true);
    readConfig.mockReturnValue({ anonymousId: "id-1", bucketSeed: "seed-1" });
    canaryDecisions.mockReturnValue({});
    buildStudioHeadScriptsForHost("", "localhost:3000");
    expect(resetPostureCache).toHaveBeenCalled();
  });

  it("stops publishing identity once another process disables telemetry", () => {
    canaryDecisions.mockReturnValue({});
    readConfig.mockReturnValue({ anonymousId: "id-1", bucketSeed: "seed-1" });

    shouldTrack.mockReturnValue(true);
    expect(buildStudioHeadScriptsForHost("", "localhost:3000")).toContain("__HF_CLI_DISTINCT_ID");

    // `hyperframes telemetry disable` in another terminal.
    shouldTrack.mockReturnValue(false);
    const after = buildStudioHeadScriptsForHost("", "localhost:3000");
    expect(after).not.toContain("__HF_CLI_DISTINCT_ID");
    expect(after).not.toContain("__HF_CLI_BUCKET_SEED");
  });
});
