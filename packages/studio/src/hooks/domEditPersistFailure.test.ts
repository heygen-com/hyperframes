import { describe, expect, it, vi } from "vitest";
import type { PatchOperation } from "../utils/sourcePatcher";
import { StudioSaveHttpError } from "../utils/studioSaveDiagnostics";
import {
  DomEditPersistUnresolvableError,
  DomEditPersistUnsafeValueError,
  reportDomEditPersistFailure,
  warnDomEditPersistNoOp,
} from "./domEditPersistFailure";

const selection = {
  label: "Hero title",
  hfId: "hf-hero",
  id: "hero",
  selector: ".hero",
  selectorIndex: 0,
  sourceFile: "index.html",
};

const operations: PatchOperation[] = [{ type: "inline-style", property: "color", value: "red" }];

describe("reportDomEditPersistFailure", () => {
  it("toasts with the selected label and underlying error detail", () => {
    const showToast = vi.fn<(message: string, tone?: "error" | "info") => void>();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    reportDomEditPersistFailure(selection, operations, new Error("network down"), showToast);

    expect(showToast).toHaveBeenCalledWith(
      'Couldn\'t save "Hero title": network down',
      "error",
      "unknown",
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[Studio] DOM edit persist failed",
      expect.objectContaining({
        target: {
          hfId: "hf-hero",
          id: "hero",
          selector: ".hero",
          selectorIndex: 0,
          sourceFile: "index.html",
        },
        operations: "inline-style:color",
        error: "network down",
      }),
    );

    warnSpy.mockRestore();
  });

  it("toasts StudioSaveHttpError and unmarked unsafe errors", () => {
    const showToast = vi.fn<(message: string, tone?: "error" | "info") => void>();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    reportDomEditPersistFailure(
      selection,
      operations,
      new StudioSaveHttpError("Failed to patch index.html (500)", 500),
      showToast,
    );
    reportDomEditPersistFailure(
      selection,
      operations,
      new DomEditPersistUnsafeValueError("DOM patch contains unsafe values: style.width"),
      showToast,
    );

    expect(showToast).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("Failed to patch index.html"),
      "error",
      "http",
    );
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("DOM patch contains unsafe values: style.width"),
      "error",
      "unsafe-value",
    );
    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });

  // fails without the fix: a dom-save toast carried no cause, and an element missing from the source read as unknown.
  it("a failed save names its cause beside the toast, from a closed list", () => {
    const showToast = vi.fn<(message: string, tone?: "error" | "info", cause?: string) => void>();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    reportDomEditPersistFailure(
      selection,
      operations,
      new DomEditPersistUnresolvableError("index.html"),
      showToast,
    );

    expect(showToast).toHaveBeenCalledWith(
      "Couldn't save \"Hero title\": Couldn't find this element in the source file (index.html)",
      "error",
      "unresolvable",
    );
    warnSpy.mockRestore();
  });

  it("does not toast errors explicitly marked as already toasted", () => {
    const showToast = vi.fn<(message: string, tone?: "error" | "info") => void>();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new DomEditPersistUnsafeValueError(
      "DOM patch contains unsafe values: style.width",
    );
    Object.defineProperty(error, "alreadyToasted", { value: true });

    reportDomEditPersistFailure(selection, operations, error, showToast);

    expect(showToast).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[Studio] DOM edit persist failed",
      expect.objectContaining({
        target: expect.objectContaining({ hfId: "hf-hero", sourceFile: "index.html" }),
      }),
    );

    warnSpy.mockRestore();
  });
});

describe("warnDomEditPersistNoOp", () => {
  it("logs a structured breadcrumb without requiring a toast callback", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnDomEditPersistNoOp(selection, operations);

    expect(warnSpy).toHaveBeenCalledWith(
      "[Studio] DOM edit persist no-op",
      expect.objectContaining({
        target: {
          hfId: "hf-hero",
          id: "hero",
          selector: ".hero",
          selectorIndex: 0,
          sourceFile: "index.html",
        },
        operations: "inline-style:color",
      }),
    );

    warnSpy.mockRestore();
  });
});
