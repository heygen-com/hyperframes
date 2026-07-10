import { describe, expect, it } from "bun:test";

const loadSubject = () => import("./runner.js");

describe("Operator Black browser runner", () => {
  it("pins the complete dark/light responsive matrix and its single axe viewport", async () => {
    const { VIEWPORTS, THEMES } = await loadSubject();

    expect(VIEWPORTS).toEqual([
      {
        name: "compact-280",
        width: 280,
        height: 653,
        axe: false,
        allowVerticalScroll: false,
      },
      {
        name: "mobile-360",
        width: 360,
        height: 800,
        axe: false,
        allowVerticalScroll: false,
      },
      {
        name: "small-640",
        width: 640,
        height: 960,
        axe: true,
        allowVerticalScroll: false,
      },
      {
        name: "tablet-1024",
        width: 1024,
        height: 768,
        axe: false,
        allowVerticalScroll: false,
      },
      {
        name: "desktop-1920",
        width: 1920,
        height: 1080,
        axe: false,
        allowVerticalScroll: false,
      },
      {
        name: "short-640",
        width: 640,
        height: 360,
        axe: false,
        allowVerticalScroll: true,
      },
    ]);
    expect(VIEWPORTS.filter((viewport) => viewport.axe)).toEqual([
      expect.objectContaining({ name: "small-640" }),
    ]);
    expect(THEMES).toEqual(["dark", "light"]);
  });

  it("builds every semantic fixture while retaining one deterministic demo pass per item", async () => {
    const { buildRunPlan } = await loadSubject();
    const items = [
      { id: "button", focusTarget: ".button", renderCheckpoints: ["start", "end"] },
      { id: "input", focusTarget: "input", renderCheckpoints: ["start", "focus", "end"] },
    ];

    const plan = buildRunPlan(items);

    expect(plan.canonical).toHaveLength(24);
    expect(plan.canonical[0]).toEqual({
      id: "button",
      focusTarget: ".button",
      theme: "dark",
      viewport: {
        name: "compact-280",
        width: 280,
        height: 653,
        axe: false,
        allowVerticalScroll: false,
      },
    });
    expect(plan.demos).toEqual(items);
  });

  it("builds explicit 200%, 400%, and forced-colors focus gates for every focusable item", async () => {
    const { FORCED_COLORS_VIEWPORT, REFLOW_PROFILES, buildFocusRunPlan } = await loadSubject();
    const plan = buildFocusRunPlan([
      { id: "button", focusTarget: ".button", renderCheckpoints: ["start", "end"] },
      { id: "toast", focusTarget: "none", renderCheckpoints: ["start", "end"] },
    ]);

    expect(REFLOW_PROFILES).toEqual([
      expect.objectContaining({ name: "zoom-200", zoom: 2, baseWidth: 1280, width: 640 }),
      expect.objectContaining({ name: "zoom-400", zoom: 4, baseWidth: 1280, width: 320 }),
    ]);
    expect(
      REFLOW_PROFILES.every((profile) => profile.width === profile.baseWidth / profile.zoom),
    ).toBe(true);
    expect(FORCED_COLORS_VIEWPORT).toEqual(
      expect.objectContaining({ name: "forced-colors-360", width: 360 }),
    );
    expect(plan).toHaveLength(5);
    expect(plan.map((fixture) => `${fixture.theme}:${fixture.viewport.name}`)).toEqual([
      "dark:zoom-200",
      "dark:zoom-400",
      "light:zoom-200",
      "light:zoom-400",
      "dark:forced-colors-360",
    ]);
    expect(plan.filter((fixture) => fixture.forcedColors)).toHaveLength(1);
  });

  it("requires semantic fixtures to match every and only closed inventory item", async () => {
    const { validateClosedStateFixtureCoverage } = await loadSubject();
    const items = [
      {
        id: "accordion",
        focusTarget: "button",
        staticStates: ["open", "closed"],
        renderCheckpoints: ["start", "end"],
      },
    ];

    expect(validateClosedStateFixtureCoverage(items, [{ id: "accordion" }])).toEqual([]);
    expect(
      validateClosedStateFixtureCoverage(items, [{ id: "popover" }]).map(
        (failure) => failure.category,
      ),
    ).toEqual(["state.fixture-coverage"]);
  });

  it("drains runtime evidence once per named pass so shuffled errors cannot go stale", async () => {
    const { drainRuntimeFailures } = await loadSubject();
    const runtime = {
      consoleErrors: ["console exploded"],
      pageErrors: ["page exploded"],
      remoteRequests: ["https://unexpected.example/asset"],
      reset() {
        this.consoleErrors.length = 0;
        this.pageErrors.length = 0;
        this.remoteRequests.length = 0;
      },
    };

    expect(drainRuntimeFailures(runtime, { id: "button", fixture: "demo" }, "shuffled-1")).toEqual([
      {
        id: "button",
        fixture: "demo",
        category: "runtime.console",
        message: "shuffled-1: console exploded",
      },
      {
        id: "button",
        fixture: "demo",
        category: "runtime.page",
        message: "shuffled-1: page exploded",
      },
      {
        id: "button",
        fixture: "demo",
        category: "runtime.network",
        message: "shuffled-1: https://unexpected.example/asset",
      },
    ]);
    expect(drainRuntimeFailures(runtime, { id: "button", fixture: "demo" })).toEqual([]);
  });

  it("adds midpoint and final-frame samples and uses three sequential plus one shuffled pass", async () => {
    const { buildCapturePoints, buildPassSpecs, orderCapturePoints } = await loadSubject();
    const points = buildCapturePoints(
      { id: "button", focusTarget: ".button", renderCheckpoints: ["start", "end"] },
      { duration: 4, fps: 30 },
    );

    expect(points).toEqual([
      { key: "start", position: "start" },
      { key: "end", position: "end" },
      { key: "@midpoint", position: 59 / 30 },
      { key: "@final-frame", position: 119 / 30 },
    ]);
    expect(buildPassSpecs(3, 1)).toEqual([
      { name: "sequential-1", order: "sequential" },
      { name: "sequential-2", order: "sequential" },
      { name: "sequential-3", order: "sequential" },
      { name: "shuffled-1", order: "shuffled" },
    ]);
    expect(orderCapturePoints(points, "shuffled")).not.toEqual(points);
    expect(
      orderCapturePoints(points, "shuffled").toSorted((left, right) =>
        left.key.localeCompare(right.key),
      ),
    ).toEqual(points.toSorted((left, right) => left.key.localeCompare(right.key)));
  });

  it("refuses to publish frame hashes unless all four complete passes match and all gates pass", async () => {
    const { auditFrameHashLock, buildFrameHashArtifact } = await loadSubject();
    const environment = {
      container: {
        image: "ghcr.io/puppeteer/puppeteer:25.3.0",
        digest: "sha256:pinned",
        verified: true,
      },
      puppeteer: "25.3.0",
      chromeForTesting: "150.0.7871.24",
      browser: "Chrome/150.0.7871.24",
      gsap: {
        path: "registry/ui-primitives/vendor/gsap-3.14.2.min.js",
        version: "3.14.2",
        sha256: "gsap-pinned",
      },
      deviceScaleFactor: 1,
      locale: "en-US",
      timezone: "UTC",
      platform: "linux",
      architecture: "x64",
      fontFingerprint: "fonts-pinned-by-container",
    };
    const pass = {
      "button:start": "aaa",
      "button:end": "bbb",
      "button:@midpoint": "ccc",
      "button:@final-frame": "ddd",
    };
    const expectedKeys = Object.keys(pass);
    const matchingPasses = [
      { name: "sequential-1", order: "sequential", frames: pass },
      { name: "sequential-2", order: "sequential", frames: pass },
      { name: "sequential-3", order: "sequential", frames: pass },
      { name: "shuffled-1", order: "shuffled", frames: pass },
    ];

    expect(buildFrameHashArtifact(environment, expectedKeys, matchingPasses, [])).toEqual({
      version: 1,
      environment,
      frames: pass,
    });
    expect(
      buildFrameHashArtifact(
        environment,
        expectedKeys,
        matchingPasses.map((entry, index) =>
          index === 3 ? { ...entry, frames: { ...pass, "button:start": "changed" } } : entry,
        ),
        [],
      ),
    ).toBeNull();
    expect(
      buildFrameHashArtifact(environment, expectedKeys, matchingPasses, [
        { id: "button", category: "layout.paint", message: "not painted" },
      ]),
    ).toBeNull();
    expect(
      buildFrameHashArtifact(environment, [...expectedKeys, "input:start"], matchingPasses, []),
    ).toBeNull();
    const artifact = buildFrameHashArtifact(environment, expectedKeys, matchingPasses, []);
    if (artifact === null) throw new Error("expected complete artifact");
    expect(auditFrameHashLock(artifact, artifact)).toEqual([]);
    expect(
      auditFrameHashLock(
        {
          ...artifact,
          environment: {
            ...artifact.environment,
            browser: "informational browser label",
            osRelease: "different runner kernel",
          },
        },
        artifact,
      ),
    ).toEqual([]);
    expect(
      auditFrameHashLock(
        {
          ...artifact,
          environment: { ...artifact.environment, fontFingerprint: "drift" },
        },
        artifact,
      ).map((failure) => failure.category),
    ).toEqual(["determinism.lock-environment"]);
    expect(
      auditFrameHashLock(
        { ...artifact, frames: { ...artifact.frames, "button:start": "drift" } },
        artifact,
      ).map((failure) => failure.category),
    ).toEqual(["determinism.lock-hash-mismatch"]);
    expect(auditFrameHashLock({}, artifact).map((failure) => failure.category)).toEqual([
      "determinism.lock-invalid",
    ]);
  });

  it("enforces every locally verifiable visual-environment lock field", async () => {
    const { validateVisualLock } = await loadSubject();
    const lock = {
      container: { image: "ghcr.io/puppeteer/puppeteer:25.3.0", digest: "sha256:pinned" },
      puppeteer: "25.3.0",
      chromeForTesting: "150.0.7871.24",
      gsap: {
        path: "registry/ui-primitives/vendor/gsap-3.14.2.min.js",
        version: "3.14.2",
        sha256: "gsap-pinned",
      },
      environment: { deviceScaleFactor: 1, locale: "en-US", timezone: "UTC" },
    };
    const evidence = {
      containerImage: lock.container.image,
      containerDigest: lock.container.digest,
      puppeteer: lock.puppeteer,
      chromeForTesting: lock.chromeForTesting,
      gsapPath: lock.gsap.path,
      gsapVersion: lock.gsap.version,
      gsapSha256: lock.gsap.sha256,
      deviceScaleFactor: 1,
      locale: "en-US",
      timezone: "UTC",
    };

    expect(validateVisualLock(lock, evidence, true)).toEqual([]);
    expect(
      validateVisualLock(
        lock,
        { ...evidence, puppeteer: "25.2.0", gsapSha256: "changed", locale: "fr-FR" },
        true,
      ).map((failure) => failure.category),
    ).toEqual(["environment.puppeteer-version", "environment.gsap-sha256", "environment.locale"]);
    expect(
      validateVisualLock(lock, { ...evidence, containerDigest: null }, true).map(
        (failure) => failure.category,
      ),
    ).toEqual(["environment.container-digest"]);
  });
});
