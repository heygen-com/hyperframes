// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openSettledCompositionPage,
  type OpenSettledCompositionPageOptions,
} from "../capture/captureCompositionFrame.js";
import { DEFAULT_CHECK_OPTIONS, runAuditGrid } from "./checkPipeline.js";
import { captureOverviewShot, runBrowserCheck } from "./checkBrowser.js";
import type { ProjectDir } from "./project.js";

const mocks = vi.hoisted(() => ({
  serverClose: vi.fn(async () => undefined),
}));

vi.mock("@hyperframes/core/compiler", () => ({
  bundleToSingleHtml: vi.fn(async () => "<html></html>"),
}));

vi.mock("../capture/captureCompositionFrame.js", async (importOriginal) => ({
  // Partial mock: constants (AUDIT_SEEK_OPTIONS, DEFAULT_ZOOM_*) stay real so
  // they remain single-sourced; only the browser-touching functions are faked.
  ...(await importOriginal<typeof import("../capture/captureCompositionFrame.js")>()),
  openSettledCompositionPage: vi.fn(),
  resolveCliChromeGpuMode: vi.fn(() => "hardware"),
  seekCompositionTimeline: vi.fn(async () => undefined),
  waitForPreferredSeekTarget: vi.fn(async () => undefined),
}));

vi.mock("../commands/validate.js", async (importOriginal) => ({
  // Partial mock: shouldIgnoreRequestFailure stays real; the clip audit is
  // faked so tests control its findings without loading real media.
  ...(await importOriginal<typeof import("../commands/validate.js")>()),
  auditClipDurations: vi.fn(async () => [] as Array<{ level: "error" | "warning"; text: string }>),
}));

vi.mock("./staticProjectServer.js", () => ({
  serveStaticProjectHtml: vi.fn(async () => ({
    url: "http://127.0.0.1:3000",
    close: mocks.serverClose,
  })),
}));

const PROJECT: ProjectDir = {
  dir: "/project",
  name: "project",
  indexPath: "/project/index.html",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "__hyperframesGeometryCandidates");
  Reflect.deleteProperty(window, "__hyperframesLayoutAudit");
  Reflect.deleteProperty(window, "__contrastAuditPrepare");
  Reflect.deleteProperty(window, "__contrastAuditFinish");
  Reflect.deleteProperty(window, "__contrastAuditRestores");
  Reflect.deleteProperty(window, "__contrastAuditRestoreIfPending");
});

function installSessionMock(page: ReturnType<typeof fakePage>): void {
  const browser = Object.assign(Object.create(null), {
    close: vi.fn(async () => undefined),
  });
  vi.mocked(openSettledCompositionPage).mockImplementation(
    async (_html: string, _url: string, options: OpenSettledCompositionPageOptions) => {
      await options.beforeNavigate?.(page);
      return { page, browser, renderReadyTimedOut: false };
    },
  );
}

function mountCanvasFixture(inner = ""): void {
  document.body.innerHTML = `
    <div data-composition-id="main" data-duration="10" data-width="640" data-height="360">${inner}</div>
  `;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 640 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 360 });
}

it("carries raw browser geometry through the page driver and pipeline", async () => {
  vi.spyOn(Date, "now")
    .mockReturnValueOnce(100)
    .mockReturnValueOnce(160)
    .mockReturnValueOnce(200)
    .mockReturnValueOnce(240);
  mountCanvasFixture(`
      <section data-composition-file="scenes/hero.html">
        <img id="hero-image" data-layout-name="hero" src="data:image/png;base64,AA==" />
      </section>
  `);
  installRects();
  const page = fakePage();
  installSessionMock(page);

  const result = await runBrowserCheck(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: false, frameCheck: {} },
    { kind: "none" },
    runAuditGrid,
  );

  expect(result.layoutIssues).toEqual([
    expect.objectContaining({
      code: "frame_out_of_frame",
      severity: "warning",
      selector: "#hero-image",
      sourceFile: "scenes/hero.html",
      dataAttributes: { "data-layout-name": "hero" },
      bbox: { x: 600, y: 80, width: 200, height: 100 },
      rect: { left: 600, top: 80, right: 800, bottom: 180, width: 200, height: 100 },
      overflow: { right: 160 },
      time: 5,
    }),
  ]);
  expect(result.timings).toEqual({ launchSettleMs: 60, seekLoopMs: 40, contrastMs: 0 });
  expect(mocks.serverClose).toHaveBeenCalledOnce();
});

it("round-trips the browser script's raw contrast candidates back into finish", async () => {
  // The U2 regression class: Node parses prepare's candidates for reporting,
  // but must hand the UNTOUCHED objects back to __contrastAuditFinish — the
  // page script samples pixels via its own bbox shape (w/h). A normalized
  // candidate (width/height) makes every sample rect NaN and the audit
  // silently reports zero checked elements as green.
  vi.spyOn(Date, "now").mockReturnValue(100);
  mountCanvasFixture(`
      <div id="headline">Readable copy</div>
  `);
  const root = document.querySelector("[data-composition-id]");
  const headline = document.querySelector("#headline");
  if (!root || !headline) throw new Error("Contrast fixture failed to mount");
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 640, 360));
  vi.spyOn(headline, "getBoundingClientRect").mockReturnValue(new DOMRect(50, 50, 300, 40));
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () =>
      ({
        display: "block",
        visibility: "visible",
        opacity: "1",
        color: "rgb(255,255,255)",
        fill: "",
        backgroundColor: "rgba(0,0,0,0)",
        backgroundImage: "none",
        fontSize: "32px",
        fontWeight: "700",
      }) as unknown as CSSStyleDeclaration,
  );

  // happy-dom can't decode PNGs: stub Image (sync onload) and the canvas 2D
  // context the way layout-audit.browser.test.ts's contrast harness does, so
  // the REAL __contrastAuditFinish runs its sampling path end to end.
  class MockImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 640;
    naturalHeight = 360;

    set src(_value: string) {
      this.onload?.();
    }
  }
  vi.stubGlobal("Image", MockImage);
  const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext") as unknown as {
    mockReturnValue(value: CanvasRenderingContext2D): void;
  };
  getContextSpy.mockReturnValue({
    drawImage() {},
    getImageData() {
      return { data: new Uint8ClampedArray(640 * 360 * 4).fill(255) };
    },
  } as unknown as CanvasRenderingContext2D);

  const received: Array<Record<string, unknown>> = [];
  const page = fakePage();
  const injectScript = page.addScriptTag;
  page.addScriptTag = vi.fn(async (arg: { content: string }) => {
    await injectScript(arg);
    const w = window as unknown as {
      __contrastAuditFinish?: ((...args: unknown[]) => Promise<unknown>) & { wrapped?: boolean };
    };
    const finish = w.__contrastAuditFinish;
    if (finish && !finish.wrapped) {
      const wrapper = Object.assign(
        async (...args: unknown[]) => {
          const candidates = args[2];
          if (Array.isArray(candidates)) {
            received.push(...(candidates as Array<Record<string, unknown>>));
          }
          return finish(...args);
        },
        { wrapped: true },
      );
      w.__contrastAuditFinish = wrapper;
    }
  });
  page.screenshot = vi.fn(async () => "c3R1Yg==");
  installSessionMock(page);

  await runBrowserCheck(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: true },
    { kind: "none" },
    runAuditGrid,
  );

  expect(received.length).toBeGreaterThan(0);
  for (const candidate of received) {
    const bbox = candidate.bbox as Record<string, unknown>;
    // The page script's own shape (w/h), not Node's envelope shape (width/height):
    expect(typeof bbox.w).toBe("number");
    expect(typeof bbox.h).toBe("number");
  }
});

it("captures check overview snapshots after contrast restores hidden text", async () => {
  vi.spyOn(Date, "now").mockReturnValue(100);
  mountCanvasFixture(`<div id="headline">Readable copy</div>`);
  const root = document.querySelector("[data-composition-id]");
  const headline = document.querySelector<HTMLElement>("#headline");
  if (!root || !headline) throw new Error("Contrast fixture failed to mount");
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 640, 360));
  vi.spyOn(headline, "getBoundingClientRect").mockReturnValue(new DOMRect(50, 50, 300, 40));
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () =>
      ({
        display: "block",
        visibility: "visible",
        opacity: "1",
        color: "rgb(255,255,255)",
        fill: "",
        clipPath: "none",
        fontSize: "32px",
        fontWeight: "700",
      }) as unknown as CSSStyleDeclaration,
  );

  const page = fakePage();
  const injectScript = page.addScriptTag;
  page.addScriptTag = vi.fn(async (arg: { content: string }) => {
    await injectScript(arg);
    const w = window as unknown as {
      __contrastAuditFinish?: (...args: unknown[]) => Promise<unknown>;
      __contrastAuditRestoreIfPending?: () => void;
    };
    if (w.__contrastAuditFinish) {
      w.__contrastAuditFinish = async () => {
        w.__contrastAuditRestoreIfPending?.();
        return [];
      };
    }
  });
  page.screenshot = vi.fn(async () =>
    headline.style.getPropertyValue("color") === "transparent"
      ? "text-hidden-base64"
      : "text-visible-base64",
  );
  installSessionMock(page);

  const result = await runBrowserCheck(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: true, snapshots: true },
    { kind: "none" },
    runAuditGrid,
  );

  expect(page.screenshot).toHaveBeenCalledTimes(2);
  expect(result.screenshots[0]?.pngBase64).toBe("text-visible-base64");
});

it("carries validate's clip-duration audit into the runtime findings", async () => {
  vi.spyOn(Date, "now").mockReturnValue(100);
  mountCanvasFixture();
  const validateModule = await import("../commands/validate.js");
  vi.mocked(validateModule.auditClipDurations).mockResolvedValue([
    {
      level: "warning",
      text: "Audio is 22.10s but its slot (data-duration) is 30.00s — the slot is shortened to the media length when rendered.",
    },
  ]);
  const page = fakePage();
  installSessionMock(page);

  const result = await runBrowserCheck(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: false },
    { kind: "none" },
    runAuditGrid,
  );

  expect(result.runtimeFindings).toEqual([
    expect.objectContaining({
      code: "clip_media_fit",
      severity: "warning",
      message: expect.stringContaining("slot is shortened"),
    }),
  ]);
});

describe("captureOverviewShot", () => {
  it("injects the annotation overlay before the overview shot and removes it right after", async () => {
    const calls: string[] = [];
    const evaluate = vi.fn(async (fn: unknown, ...args: unknown[]) => {
      calls.push("evaluate");
      return typeof fn === "function" ? Reflect.apply(fn, undefined, args) : undefined;
    });
    const screenshot = vi.fn(async () => {
      calls.push("screenshot");
      return "annotated-base64";
    });
    const page = Object.assign(Object.create(null), { evaluate, screenshot });

    const result = await captureOverviewShot(
      page,
      [{ label: "1 clipped_text", bbox: { x: 0, y: 0, width: 10, height: 10 } }],
      "measurement-base64",
    );

    // inject overlay -> take the shot -> remove overlay, in that order —
    // never present while any audit (which runs before this is called) collects.
    expect(calls).toEqual(["evaluate", "screenshot", "evaluate"]);
    expect(result).toBe("annotated-base64");
  });

  it("skips the overlay entirely and returns the plain screenshot when there's nothing to annotate", async () => {
    const evaluate = vi.fn();
    const screenshot = vi.fn();
    const page = Object.assign(Object.create(null), { evaluate, screenshot });

    const result = await captureOverviewShot(page, [], "measurement-base64");

    expect(evaluate).not.toHaveBeenCalled();
    expect(screenshot).not.toHaveBeenCalled();
    expect(result).toBe("measurement-base64");
  });
});

function installRects(): void {
  const root = document.querySelector("[data-composition-id]");
  const image = document.querySelector("#hero-image");
  if (!root || !image) throw new Error("Geometry fixture failed to mount");
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 640, 360));
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue(new DOMRect(600, 80, 200, 100));
}

function fakePage() {
  return Object.assign(Object.create(null), {
    on: vi.fn(),
    addScriptTag: vi.fn(async ({ content }: { content: string }) => {
      window.eval(content);
    }),
    evaluate: vi.fn(async (callback: unknown, ...args: unknown[]) => {
      if (typeof callback !== "function") throw new Error("Expected an evaluate callback");
      return Reflect.apply(callback, window, args);
    }),
  });
}
