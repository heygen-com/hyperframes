import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dropServiceWorkers,
  refusedPreviewMessage,
  refusedPreviewStatus,
} from "./studioPreviewMark";

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
