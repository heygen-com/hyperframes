import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertMotionBlurSupported } from "./motionBlurRoute.js";

describe("assertMotionBlurSupported", () => {
  it("lets the SDR capture routes through", () => {
    expect(() => assertMotionBlurSupported({ samplesPerFrame: 16 }, "sdr_streaming")).not.toThrow();
    expect(() => assertMotionBlurSupported({ samplesPerFrame: 16 }, "sdr_disk")).not.toThrow();
  });

  it("lets any route through when motion blur was not asked for", () => {
    expect(() => assertMotionBlurSupported(undefined, "hdr_layered")).not.toThrow();
  });

  // The defect this locks: the layered HDR compositor captures through its own loop, so a
  // render that asked for motion blur got frames with no blur in them and no error. The
  // engine's own guard cannot catch it, because the session looks supported from inside:
  // screenshot capture mode, PNG frames, and no video injector on a composition with no
  // video.
  // The reason must not blame HDR: this route is also how a composition with shader
  // transitions and no HDR content at all gets captured.
  it("names the route and a reason that covers both ways into it", () => {
    expect(() => assertMotionBlurSupported({}, "hdr_layered")).toThrow(
      /hdr_layered.*shader transitions.*own capture loop/s,
    );
  });

  // Reachability, not mechanism. The unit assertions above pass even if nothing ever calls
  // the function, which is exactly how the blur shipped dead once already. This pins the
  // call to the single place the producer decides the route.
  it("is called on the resolved capture plan, and only there", () => {
    const orchestrator = readFileSync(join(import.meta.dir, "..", "renderOrchestrator.ts"), "utf8");
    const calls = orchestrator.match(/assertMotionBlurSupported\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(orchestrator).toContain(
      "assertMotionBlurSupported(job.config.motionBlur, capturePlan.kind)",
    );
  });
});
