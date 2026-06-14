import { describe, expect, it, vi } from "vitest";
import { shouldUseSdkCutover, sdkCutoverPersist } from "./sdkCutover";
import type { PatchOperation } from "./sourcePatcher";
import type { MutableRefObject } from "react";

vi.mock("../components/editor/manualEditingAvailability", () => ({
  STUDIO_SDK_CUTOVER_ENABLED: true,
}));
vi.mock("./studioTelemetry", () => ({
  trackStudioEvent: vi.fn(),
}));

const styleOp = (property: string, value: string): PatchOperation => ({
  type: "inline-style",
  property,
  value,
});

const textOp = (value: string): PatchOperation => ({
  type: "text-content",
  property: "text",
  value,
});

const attrOp = (property: string, value: string): PatchOperation => ({
  type: "attribute",
  property,
  value,
});

const htmlAttrOp = (property: string, value: string): PatchOperation => ({
  type: "html-attribute",
  property,
  value,
});

describe("shouldUseSdkCutover", () => {
  it("returns false when flag disabled", () => {
    expect(shouldUseSdkCutover(false, true, "hf-abc", [styleOp("color", "red")])).toBe(false);
  });

  it("returns false when no session", () => {
    expect(shouldUseSdkCutover(true, false, "hf-abc", [styleOp("color", "red")])).toBe(false);
  });

  it("returns false when no hfId", () => {
    expect(shouldUseSdkCutover(true, true, null, [styleOp("color", "red")])).toBe(false);
    expect(shouldUseSdkCutover(true, true, undefined, [styleOp("color", "red")])).toBe(false);
  });

  it("returns false when ops empty", () => {
    expect(shouldUseSdkCutover(true, true, "hf-abc", [])).toBe(false);
  });

  it("returns true for inline-style ops", () => {
    expect(shouldUseSdkCutover(true, true, "hf-abc", [styleOp("color", "red")])).toBe(true);
  });

  it("returns true for text-content ops", () => {
    expect(shouldUseSdkCutover(true, true, "hf-abc", [textOp("hello")])).toBe(true);
  });

  it("returns true for attribute ops", () => {
    expect(shouldUseSdkCutover(true, true, "hf-abc", [attrOp("data-x", "10")])).toBe(true);
  });

  it("returns true for html-attribute ops", () => {
    expect(shouldUseSdkCutover(true, true, "hf-abc", [htmlAttrOp("class", "foo")])).toBe(true);
  });

  it("returns true when ops mix all supported types", () => {
    expect(
      shouldUseSdkCutover(true, true, "hf-abc", [
        styleOp("color", "red"),
        textOp("hello"),
        attrOp("x", "1"),
        htmlAttrOp("class", "foo"),
      ]),
    ).toBe(true);
  });
});

describe("sdkCutoverPersist", () => {
  const makeRef = <T>(val: T): MutableRefObject<T> => ({ current: val });

  const makeDeps = (overrides: Partial<Parameters<typeof sdkCutoverPersist>[5]> = {}) => ({
    editHistory: { recordEdit: vi.fn().mockResolvedValue(undefined) },
    writeProjectFile: vi.fn().mockResolvedValue(undefined),
    reloadPreview: vi.fn(),
    domEditSaveTimestampRef: makeRef(0),
    ...overrides,
  });

  const makeSession = (hasEl = true) =>
    ({
      getElement: vi.fn().mockReturnValue(hasEl ? { inlineStyles: {} } : null),
      dispatch: vi.fn(),
      serialize: vi.fn().mockReturnValue("<html></html>"),
    }) as unknown as Parameters<typeof sdkCutoverPersist>[4];

  it("returns false when session is null", async () => {
    const deps = makeDeps();
    const sel = { hfId: "hf-abc" } as never;
    const result = await sdkCutoverPersist(
      sel,
      [styleOp("color", "red")],
      "before",
      "/path.html",
      null,
      deps,
    );
    expect(result).toBe(false);
  });

  it("returns false when element not found in session", async () => {
    const deps = makeDeps();
    const session = makeSession(false);
    const sel = { hfId: "hf-abc" } as never;
    const result = await sdkCutoverPersist(
      sel,
      [styleOp("color", "red")],
      "before",
      "/path.html",
      session,
      deps,
    );
    expect(result).toBe(false);
  });

  it("dispatches setStyle for inline-style ops", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    const sel = { hfId: "hf-abc" } as never;
    const result = await sdkCutoverPersist(
      sel,
      [styleOp("color", "red"), styleOp("opacity", "0.5")],
      "before",
      "/comp.html",
      session,
      deps,
    );
    expect(result).toBe(true);
    expect(session!.dispatch).toHaveBeenCalledWith({
      type: "setStyle",
      target: "hf-abc",
      styles: { color: "red", opacity: "0.5" },
    });
    expect(deps.writeProjectFile).toHaveBeenCalledWith("/comp.html", "<html></html>");
    expect(deps.reloadPreview).toHaveBeenCalled();
  });

  it("dispatches setText for text-content op", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    const sel = { hfId: "hf-abc" } as never;
    const result = await sdkCutoverPersist(
      sel,
      [textOp("Hello world")],
      "before",
      "/comp.html",
      session,
      deps,
    );
    expect(result).toBe(true);
    expect(session!.dispatch).toHaveBeenCalledWith({
      type: "setText",
      target: "hf-abc",
      value: "Hello world",
    });
  });

  it("dispatches setAttribute for attribute op with data- prefix", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    const sel = { hfId: "hf-abc" } as never;
    const result = await sdkCutoverPersist(
      sel,
      [attrOp("x", "42")],
      "before",
      "/comp.html",
      session,
      deps,
    );
    expect(result).toBe(true);
    expect(session!.dispatch).toHaveBeenCalledWith({
      type: "setAttribute",
      target: "hf-abc",
      name: "data-x",
      value: "42",
    });
  });

  it("dispatches setAttribute for html-attribute op", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    const sel = { hfId: "hf-abc" } as never;
    const result = await sdkCutoverPersist(
      sel,
      [htmlAttrOp("class", "foo bar")],
      "before",
      "/comp.html",
      session,
      deps,
    );
    expect(result).toBe(true);
    expect(session!.dispatch).toHaveBeenCalledWith({
      type: "setAttribute",
      target: "hf-abc",
      name: "class",
      value: "foo bar",
    });
  });

  it("returns false and does not throw on dispatch error", async () => {
    const deps = makeDeps();
    const session = makeSession(true);
    (session!.dispatch as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("dispatch failed");
    });
    const sel = { hfId: "hf-abc" } as never;
    const result = await sdkCutoverPersist(
      sel,
      [styleOp("color", "red")],
      "before",
      "/comp.html",
      session,
      deps,
    );
    expect(result).toBe(false);
    expect(deps.reloadPreview).not.toHaveBeenCalled();
  });
});
