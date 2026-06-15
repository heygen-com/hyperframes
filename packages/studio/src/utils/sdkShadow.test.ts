import { describe, expect, it } from "vitest";
import { patchOpsToSdkEditOps, SdkShadowMismatch } from "./sdkShadow";
import type { PatchOperation } from "./sourcePatcher";
import { openComposition } from "@hyperframes/sdk";

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
