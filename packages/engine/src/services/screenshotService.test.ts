// @vitest-environment node
// fallow-ignore-file code-duplication
import { describe, it, expect, vi } from "vitest";
import { parseHTML } from "linkedom";
import { type Page } from "puppeteer-core";
import {
  pageScreenshotCapture,
  pageContentExceedsCaptureHeight,
  cdpSessionCache,
  ensureRenderFrameSiblings,
  applyDomLayerMask,
  removeDomLayerMask,
  injectVideoFramesBatch,
  syncVideoFrameVisibility,
  shouldDefaultCaptureBeyondViewport,
  DOM_LAYER_MASK_STYLE_ID,
} from "./screenshotService.js";

// Stub a Page + CDPSession just enough that pageScreenshotCapture can call
// `client.send("Page.captureScreenshot", ...)` and we can inspect the args.
function makeFakePageWithCdp(send: (method: string, params: object) => Promise<{ data: string }>) {
  const fakeSession = { send } as unknown as import("puppeteer-core").CDPSession;
  // Stub a Page object — the WeakMap cache is the only Page-thing used in the
  // path under test, so we can pre-seed it and skip page.createCDPSession().
  const fakePage = {} as Page;
  cdpSessionCache.set(fakePage, fakeSession);
  return fakePage;
}

describe("pageScreenshotCapture supersample plumbing", () => {
  // Minimal 1×1 transparent PNG, base64. The function returns Buffer.from(data, "base64")
  // and we never inspect the bytes — only the params we pass to client.send.
  const ONE_PIXEL_PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

  it("passes `clip` with scale 1 when deviceScaleFactor is undefined (default 1)", async () => {
    const send = vi.fn().mockResolvedValue({ data: ONE_PIXEL_PNG_B64 });
    const page = makeFakePageWithCdp(send);

    await pageScreenshotCapture(page, {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      format: "jpeg",
      quality: 80,
    });

    expect(send).toHaveBeenCalledWith(
      "Page.captureScreenshot",
      expect.objectContaining({
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
      }),
    );
  });

  it("uses captureBeyondViewport only when callers opt in", async () => {
    const send = vi.fn().mockResolvedValue({ data: ONE_PIXEL_PNG_B64 });
    const page = makeFakePageWithCdp(send);

    await pageScreenshotCapture(page, {
      width: 1080,
      height: 1920,
      fps: { num: 30, den: 1 },
      format: "jpeg",
      captureBeyondViewport: true,
    });

    expect(send).toHaveBeenCalledWith(
      "Page.captureScreenshot",
      expect.objectContaining({
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 },
      }),
    );
  });

  it("passes `clip` with scale 1 when deviceScaleFactor is exactly 1", async () => {
    const send = vi.fn().mockResolvedValue({ data: ONE_PIXEL_PNG_B64 });
    const page = makeFakePageWithCdp(send);

    await pageScreenshotCapture(page, {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      format: "jpeg",
      deviceScaleFactor: 1,
    });

    const params = send.mock.calls[0]?.[1] as { clip?: { scale: number } };
    expect(params.clip).toEqual({ x: 0, y: 0, width: 1920, height: 1080, scale: 1 });
  });

  it("passes `clip` with `scale = dpr` when deviceScaleFactor > 1 (the supersample contract)", async () => {
    const send = vi.fn().mockResolvedValue({ data: ONE_PIXEL_PNG_B64 });
    const page = makeFakePageWithCdp(send);

    await pageScreenshotCapture(page, {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      format: "jpeg",
      deviceScaleFactor: 2,
    });

    expect(send).toHaveBeenCalledWith(
      "Page.captureScreenshot",
      expect.objectContaining({
        clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 2 },
      }),
    );
  });

  it("propagates a non-2 supersample factor (e.g. 720p → 4K = 3×)", async () => {
    const send = vi.fn().mockResolvedValue({ data: ONE_PIXEL_PNG_B64 });
    const page = makeFakePageWithCdp(send);

    await pageScreenshotCapture(page, {
      width: 1280,
      height: 720,
      fps: { num: 30, den: 1 },
      format: "jpeg",
      deviceScaleFactor: 3,
    });

    const params = send.mock.calls[0]?.[1] as { clip?: { scale: number } };
    expect(params.clip?.scale).toBe(3);
  });
});

describe("shouldDefaultCaptureBeyondViewport", () => {
  it("guards regular Chrome on macOS", () => {
    expect(shouldDefaultCaptureBeyondViewport("Chrome/149.0.7827.155", "darwin")).toBe(true);
  });

  it("keeps chrome-headless-shell on the faster viewport-bound path", () => {
    expect(shouldDefaultCaptureBeyondViewport("HeadlessChrome/148.0.7778.97", "darwin")).toBe(
      false,
    );
  });

  it("does not change regular Chrome defaults on non-macOS platforms", () => {
    expect(shouldDefaultCaptureBeyondViewport("Chrome/149.0.7827.155", "linux")).toBe(false);
  });
});

describe("pageContentExceedsCaptureHeight", () => {
  function makeFakePageWithScrollHeight(scrollHeight: number): Page {
    return { evaluate: vi.fn().mockResolvedValue(scrollHeight) } as unknown as Page;
  }

  it("is false when the page fits exactly within the requested height", async () => {
    const page = makeFakePageWithScrollHeight(1920);
    await expect(pageContentExceedsCaptureHeight(page, 1920)).resolves.toBe(false);
  });

  it("tolerates subpixel rounding just past the requested height", async () => {
    const page = makeFakePageWithScrollHeight(1920.5);
    await expect(pageContentExceedsCaptureHeight(page, 1920)).resolves.toBe(false);
  });

  it("tolerates exactly one CSS pixel past the requested height", async () => {
    const page = makeFakePageWithScrollHeight(1921);
    await expect(pageContentExceedsCaptureHeight(page, 1920)).resolves.toBe(false);
  });

  it("detects content just beyond the rounding tolerance", async () => {
    const page = makeFakePageWithScrollHeight(1922);
    await expect(pageContentExceedsCaptureHeight(page, 1920)).resolves.toBe(true);
  });

  it("is true when the page genuinely overflows the requested height", async () => {
    const page = makeFakePageWithScrollHeight(2007);
    await expect(pageContentExceedsCaptureHeight(page, 1920)).resolves.toBe(true);
  });
});

describe("injectVideoFramesBatch replacement layout", () => {
  it("does not copy opposing inset constraints onto the injected frame image", async () => {
    const { window, document } = parseHTML(
      '<html><body><div id="root"><video id="clip" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video></div></body></html>',
    );

    Object.defineProperty(window.HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: () => Promise.resolve(),
    });

    const video = document.getElementById("clip") as HTMLVideoElement;
    Object.defineProperties(video, {
      offsetLeft: { configurable: true, get: () => 0 },
      offsetTop: { configurable: true, get: () => 0 },
      offsetWidth: { configurable: true, get: () => 1920 },
      offsetHeight: { configurable: true, get: () => 1080 },
    });
    video.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 1920,
        bottom: 1080,
        width: 1920,
        height: 1080,
        toJSON: () => ({}),
      }) as DOMRect;

    const computedStyle = document.createElement("div").style;
    computedStyle.position = "absolute";
    computedStyle.width = "1920px";
    computedStyle.height = "1080px";
    computedStyle.top = "0px";
    computedStyle.left = "0px";
    computedStyle.right = "0px";
    computedStyle.bottom = "0px";
    computedStyle.inset = "0px";
    computedStyle.objectFit = "cover";
    computedStyle.objectPosition = "center center";
    computedStyle.zIndex = "3";
    computedStyle.opacity = "1";
    Object.defineProperty(window, "getComputedStyle", {
      configurable: true,
      value: () => computedStyle,
    });

    const globals = globalThis as unknown as {
      window?: typeof window;
      document?: Document;
    };
    const previousWindow = globals.window;
    const previousDocument = globals.document;
    globals.window = window;
    globals.document = document;
    try {
      const page = {
        evaluate: async (
          fn: (
            updates: Array<{ videoId: string; dataUri: string }>,
            visualProperties: string[],
          ) => Promise<void>,
          updates: Array<{ videoId: string; dataUri: string }>,
          visualProperties: string[],
        ) => fn(updates, visualProperties),
      } as unknown as Page;

      await injectVideoFramesBatch(page, [
        {
          videoId: "clip",
          dataUri:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
        },
      ]);
    } finally {
      globals.window = previousWindow;
      globals.document = previousDocument;
    }

    const img = video.nextElementSibling as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.style.position).toBe("absolute");
    expect(img?.style.left).toBe("0px");
    expect(img?.style.top).toBe("0px");
    expect(img?.style.width).toBe("1920px");
    expect(img?.style.height).toBe("1080px");
    expect(img?.style.right).toBe("auto");
    expect(img?.style.bottom).toBe("auto");
    expect(img?.style.inset).toBe("auto");
  });
});

describe("video-frame injection respects ancestor visibility", () => {
  // Regression guard: the runtime's `[data-start]` lifecycle hides
  // out-of-window sub-composition hosts with `visibility:hidden`, but the
  // injector used to ignore that and paint a replacement <img> for every
  // active `<video data-start>` element. Inner-PIP videos inside *other*
  // moments still appear active in the raw time-window check (their auto-
  // injected `data-start="0"` + probed full-source duration cover the
  // whole timeline), so the bug produced one full-bleed speaker overlay
  // per inactive sub-comp — covering whichever moment was actually visible.
  //
  // The skip is intentionally narrow: `visibility:hidden` on a regular
  // `[data-start]` container must NOT skip injection, because the
  // replacement <img>'s explicit `visibility:visible` overrides the
  // ancestor (CSS spec) and consumers rely on that to hold the final
  // GSAP-driven frame when an authored `data-duration` outlives the
  // composition's GSAP timeline. We therefore only treat
  // `visibility:hidden` as a skip signal on sub-composition hosts
  // (`[data-composition-src]` / `[data-composition-file]`). `display:none`,
  // by contrast, takes the whole subtree out of layout regardless of any
  // child override, so it always triggers the skip.

  type StyleLike = {
    display?: string;
    visibility?: string;
    opacity?: string;
    objectFit?: string;
    objectPosition?: string;
    zIndex?: string;
  };

  type HostAttribute = "data-composition-src" | "data-composition-file" | "data-start";

  function setupHostHiddenScenario(
    hostStyle: StyleLike,
    options: { hostAttribute?: HostAttribute; videoStyle?: StyleLike } = {},
  ) {
    const hostAttribute = options.hostAttribute ?? "data-composition-src";
    const hostAttrMarkup =
      hostAttribute === "data-start"
        ? 'data-start="0" data-duration="10"'
        : `${hostAttribute}="sub.html"`;
    const { window, document } = parseHTML(
      `<html><body><div id="host" ${hostAttrMarkup}><div id="pip-frame"><video id="pip" data-start="0" data-duration="10"></video></div></div></body></html>`,
    );

    Object.defineProperty(window.HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: () => Promise.resolve(),
    });

    const host = document.getElementById("host") as HTMLElement;
    const pipFrame = document.getElementById("pip-frame") as HTMLElement;
    const video = document.getElementById("pip") as HTMLVideoElement;

    Object.defineProperties(video, {
      offsetLeft: { configurable: true, get: () => 0 },
      offsetTop: { configurable: true, get: () => 0 },
      offsetWidth: { configurable: true, get: () => 1080 },
      offsetHeight: { configurable: true, get: () => 1920 },
    });
    video.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 1080,
        bottom: 1920,
        width: 1080,
        height: 1920,
        toJSON: () => ({}),
      }) as DOMRect;

    const styles = new Map<Element, StyleLike>();
    styles.set(host, hostStyle);
    styles.set(pipFrame, {});
    styles.set(video, {
      opacity: "1",
      objectFit: "cover",
      objectPosition: "center",
      zIndex: "1",
      ...options.videoStyle,
    });

    Object.defineProperty(window, "getComputedStyle", {
      configurable: true,
      value: (el: Element) => {
        const declared = styles.get(el) ?? {};
        return {
          display: declared.display ?? "block",
          visibility: declared.visibility ?? "visible",
          opacity: declared.opacity ?? "1",
          objectFit: declared.objectFit ?? "fill",
          objectPosition: declared.objectPosition ?? "50% 50%",
          zIndex: declared.zIndex ?? "auto",
          getPropertyValue: (prop: string) => {
            const camel = prop.replace(/-([a-z])/g, (_, c: string) =>
              c.toUpperCase(),
            ) as keyof StyleLike;
            return declared[camel] ?? "";
          },
        };
      },
    });

    return { window, document, video, host, pipFrame };
  }

  function withGlobals<T extends { window: Window; document: Document; video: HTMLVideoElement }>(
    setup: T,
  ): { teardown: () => void; setup: T } {
    const globals = globalThis as unknown as { window?: Window; document?: Document };
    const previousWindow = globals.window;
    const previousDocument = globals.document;
    globals.window = setup.window;
    globals.document = setup.document;
    return {
      setup,
      teardown: () => {
        globals.window = previousWindow;
        globals.document = previousDocument;
      },
    };
  }

  function passthroughPage(): Page {
    return {
      evaluate: async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        // The implementation is built to run inside the page sandbox via
        // `page.evaluate`, but linkedom gives us a DOM compatible enough to
        // execute the function body directly in Node.
        Promise.resolve((fn as (...a: unknown[]) => unknown)(...args)),
    } as unknown as Page;
  }

  function installDomMaskGlobals(setup: { window: Window; document: Document }): () => void {
    const globals = globalThis as unknown as {
      window?: Window;
      document?: Document;
      HTMLElement?: typeof HTMLElement;
      CSS?: typeof CSS;
    };
    const previousWindow = globals.window;
    const previousDocument = globals.document;
    const previousHTMLElement = globals.HTMLElement;
    const previousCSS = globals.CSS;
    globals.window = setup.window;
    globals.document = setup.document;
    globals.HTMLElement = setup.window.HTMLElement;
    globals.CSS = { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&") } as CSS;
    return () => {
      globals.window = previousWindow;
      globals.document = previousDocument;
      globals.HTMLElement = previousHTMLElement;
      globals.CSS = previousCSS;
    };
  }

  it("skips replacement-frame creation when the video's host has visibility:hidden", async () => {
    const { teardown, setup } = withGlobals(setupHostHiddenScenario({ visibility: "hidden" }));
    try {
      await injectVideoFramesBatch(passthroughPage(), [
        {
          videoId: "pip",
          dataUri:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
        },
      ]);
    } finally {
      teardown();
    }

    // No replacement <img> should be injected next to the video — the host is
    // currently hidden, so painting a frame over it would bleed onto whichever
    // sibling host is actually visible on this seek.
    const sibling = setup.video.nextElementSibling as HTMLElement | null;
    expect(sibling).toBeNull();
  });

  it("skips replacement-frame creation when the video's host has display:none", async () => {
    const { teardown, setup } = withGlobals(setupHostHiddenScenario({ display: "none" }));
    try {
      await injectVideoFramesBatch(passthroughPage(), [
        {
          videoId: "pip",
          dataUri:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
        },
      ]);
    } finally {
      teardown();
    }

    const sibling = setup.video.nextElementSibling as HTMLElement | null;
    expect(sibling).toBeNull();
  });

  it("hides an existing replacement <img> when the host becomes visibility:hidden", async () => {
    // First seed an existing __render_frame__ <img> next to the video (the
    // state the page is in after a previous seek when the host was visible).
    const { teardown, setup } = withGlobals(setupHostHiddenScenario({ visibility: "hidden" }));
    const seededImg = setup.document.createElement("img");
    seededImg.classList.add("__render_frame__");
    seededImg.style.visibility = "visible";
    setup.video.parentNode?.insertBefore(seededImg, setup.video.nextSibling);

    try {
      await injectVideoFramesBatch(passthroughPage(), [
        {
          videoId: "pip",
          dataUri:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
        },
      ]);
    } finally {
      teardown();
    }

    expect(seededImg.style.visibility).toBe("hidden");
  });

  it("syncVideoFrameVisibility hides the replacement <img> for ancestor-hidden actives", async () => {
    const { teardown, setup } = withGlobals(setupHostHiddenScenario({ visibility: "hidden" }));
    const seededImg = setup.document.createElement("img");
    seededImg.classList.add("__render_frame__");
    seededImg.style.visibility = "visible";
    setup.video.parentNode?.insertBefore(seededImg, setup.video.nextSibling);

    try {
      // "pip" IS in the active set (per the raw time-window check) but the
      // host is hidden. sync must keep the <img> hidden, not flip it to
      // `visibility: visible`.
      await syncVideoFrameVisibility(passthroughPage(), ["pip"]);
    } finally {
      teardown();
    }

    expect(seededImg.style.visibility).toBe("hidden");
  });

  it("still injects when a plain [data-start] host is visibility:hidden (CSS-escapable)", async () => {
    // Regression guard for the style-9-prod symptom: a regular
    // `[data-start]` container whose GSAP timeline is shorter than its
    // authored `data-duration` ends up `visibility: hidden` past the
    // timeline end. The replacement <img>'s explicit `visibility: visible`
    // correctly overrides that per CSS spec, so the injector must NOT
    // short-circuit — it would otherwise drop the final-state frame and
    // produce blank tail frames.
    const { teardown, setup } = withGlobals(
      setupHostHiddenScenario({ visibility: "hidden" }, { hostAttribute: "data-start" }),
    );

    try {
      await injectVideoFramesBatch(passthroughPage(), [
        {
          videoId: "pip",
          dataUri:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
        },
      ]);
    } finally {
      teardown();
    }

    const sibling = setup.video.nextElementSibling as HTMLElement | null;
    expect(sibling).not.toBeNull();
    expect(sibling?.classList.contains("__render_frame__")).toBe(true);
    expect(sibling?.style.visibility).toBe("visible");
  });

  it("does not copy color-grading source suppression opacity to the injected frame", async () => {
    const { teardown, setup } = withGlobals(
      setupHostHiddenScenario({}, { videoStyle: { opacity: "0" } }),
    );
    setup.video.setAttribute("data-hf-color-grading-source-hidden", "true");

    try {
      await injectVideoFramesBatch(passthroughPage(), [
        {
          videoId: "pip",
          dataUri:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
        },
      ]);
    } finally {
      teardown();
    }

    const sibling = setup.video.nextElementSibling as HTMLElement | null;
    expect(sibling?.classList.contains("__render_frame__")).toBe(true);
    expect(sibling?.style.opacity).toBe("1");
  });

  it("repairs stale injected-frame opacity while syncing color-graded active videos", async () => {
    const { teardown, setup } = withGlobals(setupHostHiddenScenario({}));
    setup.video.setAttribute("data-hf-color-grading-source-hidden", "true");
    const seededImg = setup.document.createElement("img");
    seededImg.classList.add("__render_frame__");
    seededImg.style.opacity = "0";
    setup.video.parentNode?.insertBefore(seededImg, setup.video.nextSibling);

    try {
      await syncVideoFrameVisibility(passthroughPage(), ["pip"]);
    } finally {
      teardown();
    }

    expect(seededImg.style.opacity).toBe("1");
    expect(seededImg.style.visibility).toBe("visible");
  });

  it("syncVideoFrameVisibility shows the replacement <img> when a plain [data-start] host is visibility:hidden", async () => {
    const { teardown, setup } = withGlobals(
      setupHostHiddenScenario({ visibility: "hidden" }, { hostAttribute: "data-start" }),
    );
    const seededImg = setup.document.createElement("img");
    seededImg.classList.add("__render_frame__");
    seededImg.style.visibility = "hidden";
    setup.video.parentNode?.insertBefore(seededImg, setup.video.nextSibling);

    try {
      await syncVideoFrameVisibility(passthroughPage(), ["pip"]);
    } finally {
      teardown();
    }

    // The host's `visibility: hidden` is escapable; sync must flip the
    // <img> to `visibility: visible` so it overrides the ancestor.
    expect(seededImg.style.visibility).toBe("visible");
  });

  // Regression for the layered/HDR mask path: `applyDomLayerMask` writes an
  // `!important` stylesheet rule `#${showId} *{visibility:visible !important}`
  // which, if a sub-comp host id appears in the show set, would revive a
  // plain (non-important) inline `visibility: hidden` on a descendant
  // `__render_frame__` — the cascade rule is "important stylesheet author
  // beats non-important inline author". To stay safe regardless of which
  // layer ends up in `show`, the ancestor-hidden hide must be written with
  // `!important` so inline `!important` beats stylesheet `!important`.
  //
  // linkedom strips `!important` from `cssText`/`getPropertyPriority`, so we
  // pin the contract on the API call site instead: a `setProperty(name,
  // value, "important")` invocation on the live `<img>`'s style.
  it("injectVideoFramesBatch hides a stale <img> with !important so the layer mask cannot revive it", async () => {
    const { teardown, setup } = withGlobals(setupHostHiddenScenario({ visibility: "hidden" }));
    const seededImg = setup.document.createElement("img");
    seededImg.classList.add("__render_frame__");
    seededImg.style.visibility = "visible";
    setup.video.parentNode?.insertBefore(seededImg, setup.video.nextSibling);
    const setPropertySpy = vi.spyOn(seededImg.style, "setProperty");

    try {
      await injectVideoFramesBatch(passthroughPage(), [
        {
          videoId: "pip",
          dataUri:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
        },
      ]);
    } finally {
      teardown();
    }

    expect(seededImg.style.visibility).toBe("hidden");
    expect(setPropertySpy).toHaveBeenCalledWith("visibility", "hidden", "important");
  });

  it("syncVideoFrameVisibility hides an existing <img> with !important so the layer mask cannot revive it", async () => {
    const { teardown, setup } = withGlobals(setupHostHiddenScenario({ visibility: "hidden" }));
    const seededImg = setup.document.createElement("img");
    seededImg.classList.add("__render_frame__");
    seededImg.style.visibility = "visible";
    setup.video.parentNode?.insertBefore(seededImg, setup.video.nextSibling);
    const setPropertySpy = vi.spyOn(seededImg.style, "setProperty");

    try {
      await syncVideoFrameVisibility(passthroughPage(), ["pip"]);
    } finally {
      teardown();
    }

    expect(seededImg.style.visibility).toBe("hidden");
    expect(setPropertySpy).toHaveBeenCalledWith("visibility", "hidden", "important");
  });

  it("applyDomLayerMask does not revive hidden idless timed descendants of a shown layer", async () => {
    const { window, document } = parseHTML(
      `<html><head></head><body>
        <div id="scene" data-start="0" data-duration="6">
          <div class="label" data-start="4.5" data-duration="1.5">late label</div>
        </div>
      </body></html>`,
    );
    const scene = document.getElementById("scene") as HTMLElement;
    const label = document.querySelector(".label") as HTMLElement;
    label.style.visibility = "hidden";

    Object.defineProperty(window, "getComputedStyle", {
      configurable: true,
      value: (el: Element) => ({
        display: (el as HTMLElement).style.display || "block",
        visibility: (el as HTMLElement).style.visibility || "visible",
      }),
    });

    const teardown = installDomMaskGlobals({ window, document });
    try {
      await applyDomLayerMask(passthroughPage(), ["scene"], []);
      expect(scene.style.visibility || "").toBe("");
      expect(label.style.visibility).toBe("hidden");

      await removeDomLayerMask(passthroughPage(), []);
      expect(label.style.visibility).toBe("hidden");
      expect(label.hasAttribute("data-hf-dom-layer-mask-hidden")).toBe(false);
    } finally {
      teardown();
    }
  });

  it("removeDomLayerMask keeps hidden timed descendants hidden when they are also extraHideIds", async () => {
    const { window, document } = parseHTML(
      `<html><head></head><body>
        <div id="scene" data-start="0" data-duration="6">
          <div id="caption" data-start="4.5" data-duration="1.5">late label</div>
        </div>
      </body></html>`,
    );
    const caption = document.getElementById("caption") as HTMLElement;
    caption.style.visibility = "hidden";

    Object.defineProperty(window, "getComputedStyle", {
      configurable: true,
      value: (el: Element) => ({
        display: (el as HTMLElement).style.display || "block",
        visibility: (el as HTMLElement).style.visibility || "visible",
      }),
    });

    const teardown = installDomMaskGlobals({ window, document });
    try {
      await applyDomLayerMask(passthroughPage(), ["scene"], ["caption"]);
      await removeDomLayerMask(passthroughPage(), ["caption"]);

      expect(caption.style.visibility).toBe("hidden");
      expect(caption.hasAttribute("data-hf-dom-layer-mask-hidden")).toBe(false);
    } finally {
      teardown();
    }
  });

  it("removeDomLayerMask restores extraHideIds and render frames to previous visibility", async () => {
    const { window, document } = parseHTML(
      `<html><head></head><body>
        <div id="visible-caption" data-start="0" data-duration="1">current</div>
        <video id="clip" data-start="0" data-duration="1"></video>
        <img id="__render_frame_clip__" />
      </body></html>`,
    );
    const visibleCaption = document.getElementById("visible-caption") as HTMLElement;
    const clip = document.getElementById("clip") as HTMLElement;
    const renderFrame = document.getElementById("__render_frame_clip__") as HTMLElement;
    visibleCaption.style.visibility = "visible";
    clip.style.visibility = "hidden";
    renderFrame.style.setProperty("visibility", "hidden", "important");

    Object.defineProperty(window, "getComputedStyle", {
      configurable: true,
      value: (el: Element) => ({
        display: (el as HTMLElement).style.display || "block",
        visibility: (el as HTMLElement).style.visibility || "visible",
      }),
    });

    const teardown = installDomMaskGlobals({ window, document });
    try {
      await applyDomLayerMask(passthroughPage(), [], ["visible-caption", "clip"]);
      await removeDomLayerMask(passthroughPage(), ["visible-caption", "clip"]);

      expect(visibleCaption.style.visibility).toBe("visible");
      expect(clip.style.visibility).toBe("hidden");
      expect(renderFrame.style.visibility).toBe("hidden");
    } finally {
      teardown();
    }
  });

  it("applyDomLayerMask carries color grading canvases with their media element", async () => {
    const { window, document } = parseHTML(
      '<html><head></head><body><div id="root"><video id="pip"></video><canvas id="__hf_color_grading_pip"></canvas></div></body></html>',
    );
    const teardown = installDomMaskGlobals({ window, document });
    try {
      await applyDomLayerMask(passthroughPage(), ["pip"], []);
      expect(document.getElementById(DOM_LAYER_MASK_STYLE_ID)?.textContent).toContain(
        "#__hf_color_grading_pip",
      );

      await applyDomLayerMask(passthroughPage(), ["root"], ["pip"]);
      const canvas = document.getElementById("__hf_color_grading_pip") as HTMLCanvasElement;
      expect(canvas.style.visibility).toBe("hidden");

      await removeDomLayerMask(passthroughPage(), ["pip"]);
      expect(canvas.style.getPropertyValue("visibility") || "").toBe("");
    } finally {
      teardown();
    }
  });
});

describe("ensureRenderFrameSiblings", () => {
  function passthroughPage(): Page {
    return {
      evaluate: async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        Promise.resolve((fn as (...a: unknown[]) => unknown)(...args)),
    } as unknown as Page;
  }

  function withGlobalDom(setup: { window: Window; document: Document }): { teardown: () => void } {
    const globals = globalThis as unknown as { window?: Window; document?: Document };
    const previousWindow = globals.window;
    const previousDocument = globals.document;
    globals.window = setup.window;
    globals.document = setup.document;
    return {
      teardown: () => {
        globals.window = previousWindow;
        globals.document = previousDocument;
      },
    };
  }

  it("creates a hidden __render_frame__ sibling for every video[data-start]", async () => {
    const { window, document } = parseHTML(
      `<html><body>
        <div id="root">
          <video id="v1" data-start="0" data-duration="2"></video>
          <video id="v2" data-start="2" data-duration="2"></video>
        </div>
      </body></html>`,
    );
    const { teardown } = withGlobalDom({ window, document });
    try {
      await ensureRenderFrameSiblings(passthroughPage());
    } finally {
      teardown();
    }

    for (const id of ["v1", "v2"]) {
      const video = document.getElementById(id) as HTMLVideoElement;
      const sibling = video.nextElementSibling as HTMLElement | null;
      expect(sibling).not.toBeNull();
      expect(sibling?.tagName.toLowerCase()).toBe("img");
      expect(sibling?.classList.contains("__render_frame__")).toBe(true);
      expect(sibling?.id).toBe(`__render_frame_${id}__`);
      expect(sibling?.style.visibility).toBe("hidden");
    }
  });

  it("skips videos that already have a __render_frame__ sibling", async () => {
    const { window, document } = parseHTML(
      `<html><body>
        <div id="root">
          <video id="clip" data-start="0" data-duration="2"></video>
          <img id="__render_frame_clip__" class="__render_frame__">
        </div>
      </body></html>`,
    );
    const preExisting = document.getElementById("__render_frame_clip__") as HTMLImageElement;
    const { teardown } = withGlobalDom({ window, document });
    try {
      await ensureRenderFrameSiblings(passthroughPage());
    } finally {
      teardown();
    }

    const video = document.getElementById("clip") as HTMLVideoElement;
    expect(video.nextElementSibling).toBe(preExisting);
    expect(document.querySelectorAll(".__render_frame__").length).toBe(1);
  });

  it("does not touch <video> elements without data-start", async () => {
    const { window, document } = parseHTML(
      `<html><body><div id="root"><video id="raw"></video></div></body></html>`,
    );
    const { teardown } = withGlobalDom({ window, document });
    try {
      await ensureRenderFrameSiblings(passthroughPage());
    } finally {
      teardown();
    }

    const video = document.getElementById("raw") as HTMLVideoElement;
    expect(video.nextElementSibling).toBeNull();
  });
});
