import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  patchOpsToSdkEditOps,
  runShadowDelete,
  runShadowTiming,
  runShadowGsapTween,
  SdkShadowMismatch,
} from "./sdkShadow";
import type { PatchOperation } from "./sourcePatcher";
import { openComposition } from "@hyperframes/sdk";

// Capture sdk_shadow_dispatch telemetry for the non-PatchOperation runners.
const trackedEvents: Array<{ event: string; props: Record<string, unknown> }> = [];
vi.mock("./studioTelemetry", () => ({
  trackStudioEvent: (event: string, props: Record<string, unknown>) =>
    trackedEvents.push({ event, props }),
}));
beforeEach(() => {
  trackedEvents.length = 0;
});
const lastShadow = () =>
  trackedEvents.filter((e) => e.event === "sdk_shadow_dispatch").at(-1)?.props;

const BASE_HTML = /* html */ `<!DOCTYPE html>
<html><body>
  <div data-hf-id="hf-box" style="color: red; width: 100px;" data-name="box">Hello</div>
</body></html>`;

describe("patchOpsToSdkEditOps", () => {
  it("maps inline-style ops to a single setStyle EditOp", () => {
    const ops: PatchOperation[] = [
      { type: "inline-style", property: "color", value: "#00f" },
      { type: "inline-style", property: "opacity", value: "0.5" },
    ];
    const result = patchOpsToSdkEditOps("hf-box", ops);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "setStyle",
      target: "hf-box",
      styles: { color: "#00f", opacity: "0.5" },
    });
  });

  it("maps text-content op to setText EditOp", () => {
    const ops: PatchOperation[] = [{ type: "text-content", property: "text", value: "World" }];
    const result = patchOpsToSdkEditOps("hf-box", ops);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "setText", target: "hf-box", value: "World" });
  });

  it("maps attribute op to setAttribute with data- prefix", () => {
    const ops: PatchOperation[] = [{ type: "attribute", property: "name", value: "hero" }];
    const result = patchOpsToSdkEditOps("hf-box", ops);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "setAttribute",
      target: "hf-box",
      name: "data-name",
      value: "hero",
    });
  });

  it("maps html-attribute op to setAttribute without prefix", () => {
    const ops: PatchOperation[] = [
      { type: "html-attribute", property: "contenteditable", value: "true" },
    ];
    const result = patchOpsToSdkEditOps("hf-box", ops);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "setAttribute",
      target: "hf-box",
      name: "contenteditable",
      value: "true",
    });
  });

  it("handles null value for attribute removal", () => {
    const ops: PatchOperation[] = [{ type: "html-attribute", property: "hidden", value: null }];
    const result = patchOpsToSdkEditOps("hf-box", ops);
    expect(result[0]).toEqual({
      type: "setAttribute",
      target: "hf-box",
      name: "hidden",
      value: null,
    });
  });

  it("returns empty array for unknown op types", () => {
    const ops = [{ type: "unknown-op", property: "x", value: "y" }] as unknown as PatchOperation[];
    expect(patchOpsToSdkEditOps("hf-box", ops)).toHaveLength(0);
  });
});

describe("sdkShadowDispatch (integration)", () => {
  it("applies ops and returns no mismatches when SDK matches expected values", async () => {
    const { sdkShadowDispatch } = await import("./sdkShadow");
    const session = await openComposition(BASE_HTML);

    const ops: PatchOperation[] = [{ type: "inline-style", property: "color", value: "#00f" }];
    const result = sdkShadowDispatch(session, "hf-box", ops);

    expect(result.dispatched).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    expect(session.getElement("hf-box")?.inlineStyles.color).toBe("#00f");
  });

  it("returns dispatched:false when hfId not found in session", async () => {
    const { sdkShadowDispatch } = await import("./sdkShadow");
    const session = await openComposition(BASE_HTML);

    const ops: PatchOperation[] = [{ type: "inline-style", property: "color", value: "#00f" }];
    const result = sdkShadowDispatch(session, "hf-missing", ops);

    expect(result.dispatched).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toMatchObject<SdkShadowMismatch>({
      kind: "element_not_found",
      hfId: "hf-missing",
    });
  });

  it("applies text op and reads back via session.getElement", async () => {
    const { sdkShadowDispatch } = await import("./sdkShadow");
    const session = await openComposition(BASE_HTML);

    const ops: PatchOperation[] = [{ type: "text-content", property: "text", value: "Updated" }];
    sdkShadowDispatch(session, "hf-box", ops);

    expect(session.getElement("hf-box")?.text).toBe("Updated");
  });

  it("applies attribute op and reads back via session.getElement", async () => {
    const { sdkShadowDispatch } = await import("./sdkShadow");
    const session = await openComposition(BASE_HTML);

    const ops: PatchOperation[] = [{ type: "attribute", property: "name", value: "hero" }];
    sdkShadowDispatch(session, "hf-box", ops);

    expect(session.getElement("hf-box")?.attributes["data-name"]).toBe("hero");
  });

  it("returns dispatch_error when dispatch throws — does not propagate", async () => {
    const { sdkShadowDispatch } = await import("./sdkShadow");
    const session = await openComposition(BASE_HTML);
    // Poison dispatch so it throws on any call
    session.dispatch = () => {
      throw new Error("sdk internal error");
    };

    const ops: PatchOperation[] = [{ type: "inline-style", property: "color", value: "red" }];
    let result: ReturnType<typeof sdkShadowDispatch> | undefined;
    expect(() => {
      result = sdkShadowDispatch(session, "hf-box", ops);
    }).not.toThrow();

    expect(result!.dispatched).toBe(false);
    expect(result!.mismatches).toHaveLength(1);
    expect(result!.mismatches[0]).toMatchObject<SdkShadowMismatch>({
      kind: "dispatch_error",
      hfId: "hf-box",
      error: expect.stringContaining("sdk internal error"),
    });
  });
});

const TIMING_HTML = /* html */ `<!DOCTYPE html>
<html><body>
  <div data-hf-id="hf-clip" data-start="0" data-duration="1" data-track="0">clip</div>
</body></html>`;

const GSAP_HTML = `<div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px">
  <div data-hf-id="hf-box" style="opacity:0"></div>
  <script>var tl = gsap.timeline({ paused: true });
tl.to("[data-hf-id=\\"hf-box\\"]", { opacity: 1, duration: 0.5 }, 0.2);
window.__timelines["t"] = tl;</script>
</div>`;

const NO_TIMELINE_HTML = `<div data-hf-id="hf-stage" data-hf-root>
  <div data-hf-id="hf-box"></div>
  <script>gsap.defaults({ ease: "power1.out" });
window.__timelines = {};</script>
</div>`;

describe("runShadowDelete", () => {
  it("removes the element from the SDK session and reports parity", async () => {
    const session = await openComposition(BASE_HTML);
    runShadowDelete(session, "hf-box");
    expect(session.getElement("hf-box")).toBeNull();
    expect(lastShadow()).toMatchObject({ op: "delete", dispatched: true, mismatchCount: 0 });
  });

  it("reports no_hf_id when selection has no hf-id", async () => {
    const session = await openComposition(BASE_HTML);
    runShadowDelete(session, null);
    expect(lastShadow()).toMatchObject({ op: "delete", dispatched: false, reason: "no_hf_id" });
  });

  it("reports cannot_dispatch when the element is not addressable", async () => {
    const session = await openComposition(BASE_HTML);
    runShadowDelete(session, "hf-missing");
    expect(lastShadow()).toMatchObject({
      op: "delete",
      dispatched: false,
      reason: "cannot_dispatch",
    });
  });
});

describe("runShadowTiming", () => {
  it("applies timing and reports parity against the snapshot", async () => {
    const session = await openComposition(TIMING_HTML);
    runShadowTiming(session, "hf-clip", { start: 2, duration: 3, trackIndex: 1 });
    const el = session.getElement("hf-clip");
    expect(el?.start).toBe(2);
    expect(el?.duration).toBe(3);
    expect(el?.trackIndex).toBe(1);
    expect(lastShadow()).toMatchObject({ op: "timing", dispatched: true, mismatchCount: 0 });
  });
});

describe("runShadowGsapTween", () => {
  it("dispatches add against a real timeline and reports success", async () => {
    const session = await openComposition(GSAP_HTML);
    runShadowGsapTween(session, {
      kind: "add",
      target: "hf-box",
      tween: { method: "to", properties: { x: 100 }, duration: 0.5 },
    });
    expect(lastShadow()).toMatchObject({ op: "gsap", dispatched: true, mismatchCount: 0 });
  });

  it("reports cannot_dispatch (E_NO_GSAP_TIMELINE) when the script has no timeline", async () => {
    const session = await openComposition(NO_TIMELINE_HTML);
    runShadowGsapTween(session, {
      kind: "add",
      target: "hf-box",
      tween: { method: "to", properties: { x: 100 } },
    });
    expect(lastShadow()).toMatchObject({
      op: "gsap",
      dispatched: false,
      reason: "cannot_dispatch",
      code: "E_NO_GSAP_TIMELINE",
    });
  });
});
