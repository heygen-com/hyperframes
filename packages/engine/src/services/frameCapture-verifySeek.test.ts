import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import { seekDeVerifyTruth } from "./frameCapture.js";

const pageOf = () =>
  ({
    evaluate: async (fn: (t: number, s: boolean) => void, t: number, s: boolean) => fn(t, s),
  }) as unknown as Page;

describe("seekDeVerifyTruth", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs timeline callbacks when asked, as the render's own seek does", async () => {
    const seek = vi.fn();
    vi.stubGlobal("window", { __hf: { seek } });

    await seekDeVerifyTruth(pageOf(), 5, false);

    expect(seek).toHaveBeenCalledWith(5, { suppressEvents: false });
  });

  it("suppresses them on the render's own page, where a callback would change what it draws", async () => {
    const seek = vi.fn();
    vi.stubGlobal("window", { __hf: { seek } });

    await seekDeVerifyTruth(pageOf(), 5, true);

    expect(seek).toHaveBeenCalledWith(5, { suppressEvents: true });
  });

  it("does nothing on a page without the seek protocol", async () => {
    vi.stubGlobal("window", {});

    await expect(seekDeVerifyTruth(pageOf(), 5, false)).resolves.toBeUndefined();
  });
});
