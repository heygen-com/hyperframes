import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dropServiceWorkers,
  refusedPreviewMessage,
  refusedPreviewStatus,
  previewElementSourceFile,
} from "./studioPreviewMark";

// fails without the fix: an authored data-composition-src chose the file a timeline edit was written to
describe("previewElementSourceFile", () => {
  it("keeps the stamped file under an authored host that names another file", () => {
    document.body.innerHTML = `
      <div data-composition-id="scene" data-composition-file="compositions/scene.html">
        <div data-composition-id="wrapper" data-composition-src="index.html"><p id="t"></p></div>
      </div>`;
    expect(previewElementSourceFile(document.getElementById("t")!)).toBe("compositions/scene.html");
    document.body.innerHTML = "";
  });

  it("names no file for an element under only authored markup", () => {
    document.body.innerHTML = `<div data-composition-id="wrapper" data-composition-src=""><p id="t"></p></div>`;
    expect(previewElementSourceFile(document.getElementById("t")!)).toBeUndefined();
    document.body.innerHTML = "";
  });
});

describe("refusedPreviewStatus", () => {
  it.each([404, 410, 500])("reads %i back out of the refused page's message", (status) => {
    expect(refusedPreviewStatus(refusedPreviewMessage(status))).toBe(status);
  });

  it.each([
    "Composition timeline not found after 8s",
    "it took too long to load",
    "x The preview page could not be loaded (HTTP 404).",
  ])("finds no status in %j", (cause) => {
    expect(refusedPreviewStatus(cause)).toBeNull();
  });
});

describe("dropServiceWorkers", () => {
  const stub = (workers: unknown) => vi.stubGlobal("navigator", { serviceWorker: workers });
  afterEach(() => vi.unstubAllGlobals());

  it("unregisters every worker on the origin, and resolves when there is none or the browser refuses", async () => {
    const all = [{ unregister: vi.fn(async () => true) }, { unregister: vi.fn(async () => true) }];
    stub({ getRegistrations: async () => all });
    await dropServiceWorkers();
    for (const each of all) expect(each.unregister).toHaveBeenCalledOnce();
    stub(undefined);
    await expect(dropServiceWorkers()).resolves.toBeUndefined();
    stub({ getRegistrations: async () => Promise.reject(new Error("SecurityError")) });
    await expect(dropServiceWorkers()).resolves.toBeUndefined();
  });
});
