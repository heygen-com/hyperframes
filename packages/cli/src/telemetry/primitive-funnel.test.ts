import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const trackEvent = vi.fn();
const shouldTrack = vi.fn(() => true);
vi.mock("./client.js", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
  shouldTrack: () => shouldTrack(),
  flush: () => Promise.resolve(true),
}));

const { PrimitiveFunnel } = await import("./primitive-funnel.js");
const { claimPrimitiveFunnelEvent, readPrimitiveFunnelContext, writePrimitiveFunnelContext } =
  await import("./primitive-funnel-state.js");

async function runSynchronizedClaims(
  projectDir: string,
  eventId: string,
  processCount: number,
): Promise<number> {
  const workerPath = join(projectDir, "primitive-funnel-claim.worker.ts");
  const gatePath = join(projectDir, "primitive-funnel-claim.gate");
  const stateModuleUrl = new URL("./primitive-funnel-state.ts", import.meta.url).href;
  writeFileSync(
    workerPath,
    [
      'import { existsSync, writeFileSync } from "node:fs";',
      `import { claimPrimitiveFunnelEvent } from ${JSON.stringify(stateModuleUrl)};`,
      "const [projectDir, eventId, gatePath, readyPath] = process.argv.slice(2);",
      "writeFileSync(readyPath, String(process.pid));",
      "while (!existsSync(gatePath)) await Bun.sleep(1);",
      'process.stdout.write(claimPrimitiveFunnelEvent(projectDir, eventId) ? "true" : "false");',
    ].join("\n"),
  );

  const readyPaths = Array.from({ length: processCount }, (_, index) =>
    join(projectDir, `primitive-funnel-claim.ready-${index}`),
  );
  const exits = readyPaths.map((readyPath) => {
    const child = spawn("bun", [workerPath, projectDir, eventId, gatePath, readyPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    return new Promise<string>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
        else reject(new Error(`claim worker exited ${code}: ${Buffer.concat(stderr)}`));
      });
    });
  });

  const readinessDeadline = Date.now() + 10_000;
  while (!readyPaths.every((path) => existsSync(path))) {
    if (Date.now() >= readinessDeadline) throw new Error("claim workers did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  writeFileSync(gatePath, "go");
  const outputs = await Promise.all(exits);
  return outputs.filter((output) => output === "true").length;
}

// Funnel contract assertions intentionally share one mocked telemetry boundary.
// fallow-ignore-next-line unit-size
describe("primitive discovery funnel", () => {
  beforeEach(() => {
    trackEvent.mockClear();
    shouldTrack.mockReturnValue(true);
  });

  it("uses one stable funnel id, identifies once, and deduplicates terminal ids", () => {
    const funnel = new PrimitiveFunnel({
      funnelId: "funnel-1",
      installId: "install-1",
      primitiveId: "thread-message-stack",
      artifactId: "artifact-1",
      versionId: "version-1",
      catalogVersion: "catalog-1",
      queryFingerprint: "sha256:query",
    });
    funnel.catalogSearched(4);
    funnel.catalogResultSelected(2);
    funnel.authStarted();
    funnel.authCompleted("account-1", "oauth", 17);
    funnel.authCompleted("account-1", "oauth", 17);
    funnel.installStarted();
    funnel.installCompleted("event-install", 23);
    funnel.installCompleted("event-install", 23);
    funnel.previewSucceeded("event-preview", 31);
    funnel.renderFailed("event-render", "capture_failed", 41);

    const calls = trackEvent.mock.calls;
    expect(calls.filter(([name]) => name !== "$identify").map(([name]) => name)).toEqual([
      "primitive_catalog_searched",
      "primitive_catalog_result_selected",
      "primitive_auth_started",
      "primitive_auth_completed",
      "primitive_install_started",
      "primitive_install_completed",
      "primitive_preview_succeeded",
      "primitive_render_failed",
    ]);
    expect(calls.filter(([name]) => name === "$identify")).toHaveLength(1);
    expect(calls.filter(([name]) => name === "primitive_auth_completed")).toHaveLength(1);
    expect(calls.find(([name]) => name === "$identify")?.[2]).toBe("account-1");
    expect(calls.filter(([name]) => name === "primitive_install_completed")).toHaveLength(1);
    expect(calls.every(([, props]) => props.funnel_id === "funnel-1")).toBe(true);
    expect(calls.find(([name]) => name === "primitive_catalog_searched")?.[1]).toMatchObject({
      primitive_id: "thread-message-stack",
      result_count: 4,
      auth_state: "anonymous",
      event_id: "funnel-1:catalog-searched",
    });
    expect(calls.find(([name]) => name === "primitive_catalog_result_selected")?.[1]).toMatchObject(
      { result_rank: 2, event_id: "funnel-1:catalog-result-selected" },
    );
    expect(calls.find(([name]) => name === "primitive_install_completed")?.[1]).toMatchObject({
      duration_ms: 23,
      auth_state: "authenticated",
      event_id: "event-install",
    });
  });

  it("emits only allowlisted non-content properties and bounded errors", () => {
    const funnel = new PrimitiveFunnel({
      funnelId: "funnel-2",
      installId: "install-2",
      primitiveId: "thread-message-stack",
      artifactId: "artifact-2",
      versionId: "version-2",
      catalogVersion: "catalog-2",
      queryFingerprint: "sha256:query",
    });
    funnel.installFailed("event-1", "invalid_payload", Number.POSITIVE_INFINITY);

    const payload = trackEvent.mock.lastCall?.[1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      [
        "artifact_id",
        "catalog_version",
        "error_code",
        "event_id",
        "funnel_id",
        "funnel_step",
        "install_id",
        "primitive_id",
        "query_fingerprint",
        "version_id",
        "auth_state",
        "duration_ms",
      ].sort(),
    );
    expect(payload.duration_ms).toBe(86_400_000);
    expect(JSON.stringify(payload)).not.toMatch(
      /messages|html|css|javascript|asset|token|raw_error/,
    );
  });

  it("does not enqueue or identify when telemetry is opted out", () => {
    shouldTrack.mockReturnValue(false);
    const funnel = new PrimitiveFunnel({
      funnelId: "funnel-3",
      installId: "install-3",
      primitiveId: "thread-message-stack",
      artifactId: "artifact-3",
      versionId: "version-3",
      catalogVersion: "catalog-3",
      queryFingerprint: "sha256:query",
    });
    funnel.catalogSearched(1);
    funnel.authCompleted("account-3", "existing_session", 0);
    funnel.renderSucceeded("event-3", 0);
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("bridges commands with only allowlisted non-content metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-funnel-"));
    const context = {
      funnelId: "funnel-4",
      installId: "install-4",
      primitiveId: "thread-message-stack",
      artifactId: "artifact-4",
      versionId: "version-4",
      catalogVersion: "catalog-4",
      queryFingerprint: "sha256:query",
    };
    writePrimitiveFunnelContext(dir, context);
    expect(readPrimitiveFunnelContext(dir)).toEqual(context);
    expect(claimPrimitiveFunnelEvent(dir, "install-4:preview")).toBe(true);
    expect(claimPrimitiveFunnelEvent(dir, "install-4:preview")).toBe(false);
    expect(readFileSync(join(dir, ".hyperframes", "primitive-funnel.json"), "utf8")).not.toMatch(
      /messages|html|css|javascript|asset|token|raw_error/,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("repeatedly claims one shared preview and render event across independent processes", async () => {
    for (const suffix of ["preview", "render"] as const) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const dir = mkdtempSync(join(tmpdir(), `hf-funnel-${suffix}-race-`));
        try {
          const installId = `race-install-${suffix}-${attempt}`;
          writePrimitiveFunnelContext(dir, {
            funnelId: `race-funnel-${suffix}-${attempt}`,
            installId,
            primitiveId: "thread-message-stack",
            artifactId: "race-artifact",
            versionId: "race-version",
            catalogVersion: "race-catalog",
            queryFingerprint: "sha256:race",
          });
          const trueCount = await runSynchronizedClaims(dir, `${installId}:${suffix}`, 32);
          console.log(
            `primitive-funnel ${suffix} race ${attempt} observed true-count=${trueCount}`,
          );
          expect(trueCount).toBe(1);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
  }, 30_000);
});
