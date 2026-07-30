// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { Page } from "puppeteer-core";
import { injectDrawElementCanvas } from "./drawElementService.js";

describe("injectDrawElementCanvas", () => {
  afterEach(() => {
    document.body.replaceChildren();
    Reflect.deleteProperty(window, "__HF_ROOT_BASE_OPACITY__");
  });

  it("preserves a zero composition root opacity", async () => {
    const root = document.createElement("main");
    root.dataset.compositionId = "test";
    root.style.opacity = "0";
    document.body.appendChild(root);

    const page = {
      evaluate: async <T, A>(callback: (arg: A) => T, arg: A) => callback(arg),
    } as unknown as Page;

    await injectDrawElementCanvas(page, 1920, 1080);

    expect(
      (window as unknown as { __HF_ROOT_BASE_OPACITY__?: number }).__HF_ROOT_BASE_OPACITY__,
    ).toBe(0);
  });
});
