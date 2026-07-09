// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(__dirname, "layout-audit.browser.js"), "utf-8");
const contrastScript = readFileSync(join(__dirname, "contrast-audit.browser.js"), "utf-8");

interface RectInput {
  left: number;
  top: number;
  width: number;
  height: number;
}

describe("layout-audit.browser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete (window as unknown as { __hyperframesLayoutAudit?: unknown }).__hyperframesLayoutAudit;
  });

  it("uses authored canvas dimensions when the root bounding rect is degenerate", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="bubble"><div id="headline">Quarterly plan overflow</div></div>
      </div>
    `;

    installGeometry({
      root: rect({ left: 0, top: 0, width: 0, height: 0 }),
      bubble: rect({ left: 80, top: 120, width: 400, height: 120 }),
      headline: rect({ left: 96, top: 138, width: 1539, height: 56 }),
      text: rect({ left: 96, top: 138, width: 1539, height: 56 }),
    });

    installAuditScript();

    const issues = runAudit();
    const boxOverflow = issues.find((issue) => issue.code === "text_box_overflow");

    expect(boxOverflow).toMatchObject({
      selector: "#headline",
      containerSelector: "#bubble",
      overflow: { right: 1155 },
    });
    expect(
      issues.some(
        (issue) =>
          issue.code === "text_box_overflow" &&
          issue.selector === "#headline" &&
          issue.containerSelector === "#root",
      ),
    ).toBe(false);
  });

  it("omits tag prefixes for unique data-attribute selectors", () => {
    document.body.innerHTML = `
      <div data-composition-id="main" data-width="640" data-height="360">
        <div id="bubble"><div data-layout-name="headline">Quarterly plan overflow</div></div>
      </div>
    `;

    installGeometry({
      root: rect({ left: 0, top: 0, width: 640, height: 360 }),
      bubble: rect({ left: 80, top: 120, width: 400, height: 120 }),
      headline: rect({ left: 96, top: 138, width: 1539, height: 56 }),
      text: rect({ left: 96, top: 138, width: 1539, height: 56 }),
    });

    installAuditScript();

    const issues = runAudit();

    expect(issues[0]?.selector).toBe('[data-layout-name="headline"]');
  });

  it("respects layout ignore and allow-overflow opt-outs", () => {
    document.body.innerHTML = `
      <div data-composition-id="main" data-width="640" data-height="360">
        <div id="bubble" data-layout-allow-overflow>
          <div id="headline">Quarterly plan overflow</div>
        </div>
        <div id="ignored" data-layout-ignore>Ignored overflow</div>
      </div>
    `;

    installGeometry({
      root: rect({ left: 0, top: 0, width: 640, height: 360 }),
      bubble: rect({ left: 80, top: 120, width: 400, height: 120 }),
      headline: rect({ left: 96, top: 138, width: 1539, height: 56 }),
      ignored: rect({ left: 600, top: 20, width: 500, height: 40 }),
      text: rect({ left: 96, top: 138, width: 1539, height: 56 }),
    });

    installAuditScript();

    expect(runAudit()).toEqual([]);
  });

  it("does not flag glyph-ink vertical spill within the font-metric band on a non-clipping box", () => {
    // A painted, non-clipping caption-word-like box whose glyph ink (text rect) exceeds its snug
    // line-height box by a few px vertically — normal typography, nothing is clipped. (fontSize
    // 36 → vertical tolerance ~7.2px; the ink spills ~5px each side, well within it.)
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="bubble"><div id="headline">crews,</div></div>
      </div>
    `;
    installGeometry({
      root: rect({ left: 0, top: 0, width: 640, height: 360 }),
      bubble: rect({ left: 80, top: 120, width: 400, height: 80 }),
      text: rect({ left: 100, top: 115, width: 300, height: 90 }),
    });
    installAuditScript();

    expect(runAudit().some((issue) => issue.code === "text_box_overflow")).toBe(false);
  });

  it("still flags vertical text overflow beyond the font-metric band", () => {
    // Ink is 40px / 80px beyond the box — far past the ~7px font-metric band: a real overflow.
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="bubble"><div id="headline">two crammed lines</div></div>
      </div>
    `;
    installGeometry({
      root: rect({ left: 0, top: 0, width: 640, height: 360 }),
      bubble: rect({ left: 80, top: 120, width: 400, height: 80 }),
      text: rect({ left: 100, top: 80, width: 300, height: 200 }),
    });
    installAuditScript();

    expect(runAudit().some((issue) => issue.code === "text_box_overflow")).toBe(true);
  });
});

describe("layout-audit.browser content overlap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    delete (window as unknown as { __hyperframesLayoutAudit?: unknown }).__hyperframesLayoutAudit;
  });

  it("flags two solid text blocks that overlap", () => {
    const overlap = auditOverlapScene({
      a: { textRect: rect({ left: 100, top: 100, width: 400, height: 100 }) },
      b: { textRect: rect({ left: 300, top: 120, width: 400, height: 100 }) },
    }).find((issue) => issue.code === "content_overlap");
    expect(overlap).toMatchObject({ selector: "#a", containerSelector: "#b" });
  });

  it("ignores blocks that overlap by less than a fifth of the smaller box", () => {
    const issues = auditOverlapScene({
      a: { textRect: rect({ left: 100, top: 100, width: 400, height: 100 }) },
      b: { textRect: rect({ left: 490, top: 100, width: 400, height: 100 }) },
    });
    expect(issues.some((issue) => issue.code === "content_overlap")).toBe(false);
  });

  it("ignores watermark-style text with low colour alpha", () => {
    expectExemptFromOverlap({ color: "rgba(0, 0, 0, 0.2)" });
  });

  it("respects the data-layout-allow-overlap opt-out", () => {
    expectExemptFromOverlap({ attrs: "data-layout-allow-overlap" });
  });

  // A typewriter span clipped to nothing (clip-path: inset(0 100% 0 0)) keeps a
  // normal box but paints zero pixels; overlapping it must not flag the visible
  // block beneath. The clipped element is unreachable by elementFromPoint, which
  // is how isClippedAway detects it.
  it("excludes a block clipped to nothing by clip-path from overlap", () => {
    const issues = auditOverlapScene({
      a: { textRect: rect({ left: 100, top: 100, width: 400, height: 100 }) },
      b: {
        textRect: rect({ left: 300, top: 120, width: 400, height: 100 }),
        clipPath: "inset(0px 100% 0px 0px)",
      },
    });
    expect(issues.some((issue) => issue.code === "content_overlap")).toBe(false);
  });

  it("still flags overlap when clip-path leaves painted text visible", () => {
    const issues = auditOverlapScene({
      a: { textRect: rect({ left: 100, top: 100, width: 400, height: 100 }) },
      b: {
        textRect: rect({ left: 300, top: 120, width: 400, height: 100 }),
        clipPath: "inset(0px 25% 0px 0px)",
      },
    });
    expect(issues.some((issue) => issue.code === "content_overlap")).toBe(true);
  });
});

describe("contrast-audit.browser clip-path visibility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    delete (
      window as unknown as {
        __contrastAuditPrepare?: unknown;
        __contrastAuditFinish?: unknown;
        __contrastAuditRestoreIfPending?: unknown;
        __contrastAuditRestores?: unknown;
      }
    ).__contrastAuditPrepare;
    delete (window as unknown as { __contrastAuditFinish?: unknown }).__contrastAuditFinish;
    delete (window as unknown as { __contrastAuditRestoreIfPending?: unknown })
      .__contrastAuditRestoreIfPending;
    delete (window as unknown as { __contrastAuditRestores?: unknown }).__contrastAuditRestores;
  });

  it("excludes text clipped to nothing by clip-path from contrast reports", async () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="headline">Hidden text</div>
      </div>
    `;

    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const id = (element as Element).id;
      return {
        display: "block",
        visibility: "visible",
        opacity: "1",
        color: "rgb(0, 0, 0)",
        fontSize: "32px",
        fontWeight: "400",
        clipPath: id === "headline" ? "inset(0px 100% 0px 0px)" : "none",
      } as unknown as CSSStyleDeclaration;
    });

    vi.spyOn(document.getElementById("headline")!, "getBoundingClientRect").mockReturnValue(
      rect({ left: 100, top: 100, width: 400, height: 80 }),
    );
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
      null;

    installContrastScript();

    expect(await runContrastAudit()).toEqual([]);
  });
});

describe("contrast-audit.browser background sampling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    delete (window as unknown as { __contrastAuditPrepare?: unknown }).__contrastAuditPrepare;
    delete (window as unknown as { __contrastAuditFinish?: unknown }).__contrastAuditFinish;
    delete (window as unknown as { __contrastAuditRestoreIfPending?: unknown })
      .__contrastAuditRestoreIfPending;
    delete (window as unknown as { __contrastAuditRestores?: unknown }).__contrastAuditRestores;
  });

  // Locks in the "already correct" finding from investigating the
  // solid-fill-pill/button false-positive report: a rounded pill/button
  // with its own solid background, sitting on a busy/bright page
  // background, must NOT be flagged even though the two-phase
  // prepare()/finish() path (hide text, sample the real pixels directly
  // inside the element's own bbox) replaced the ring+own-background-walk
  // heuristic this used to rely on. The pixel buffer here is real per-pixel
  // data (not the flat-white default), with a dark region standing in for
  // the pill sitting inside a bright page background, so this exercises the
  // actual bbox-sampling logic in __contrastAuditFinish rather than a fixed
  // stub value.
  it("does not flag a solid-fill pill/button with adequate contrast", async () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="pill">
          <span id="label">Click me</span>
        </div>
      </div>
    `;

    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const id = (element as Element).id;
      return {
        display: "block",
        visibility: "visible",
        opacity: "1",
        color: id === "label" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)",
        fontSize: "20px",
        fontWeight: "400",
        clipPath: "none",
      } as unknown as CSSStyleDeclaration;
    });

    const labelRect = { left: 50, top: 50, width: 100, height: 30 };
    vi.spyOn(document.getElementById("label")!, "getBoundingClientRect").mockReturnValue(
      rect(labelRect),
    );
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
      null;

    // Dark pill (rgb 10,10,10) covering the label's bbox and a small margin
    // around it; everything else is a bright, busy page background
    // (rgb 255,45,85) — the kind of scene that flagged false positives when
    // the old algorithm sampled a ring OUTSIDE the bbox instead of the
    // pixels actually inside it.
    const pixels = pixelsWithRegion(
      { left: 30, top: 30, width: 140, height: 70 },
      [10, 10, 10],
      [255, 45, 85],
    );
    installContrastScript(pixels);

    const result = await runContrastAudit();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ selector: "#label", wcagAA: true, bg: "rgb(10,10,10)" });
  });
});

// Both blocks overlap heavily; only the exemption on block A should suppress
// the finding, so a missing exemption would surface as a failure here.
function expectExemptFromOverlap(aOverrides: { color?: string; attrs?: string }): void {
  const issues = auditOverlapScene({
    a: { textRect: rect({ left: 100, top: 100, width: 400, height: 100 }), ...aOverrides },
    b: { textRect: rect({ left: 300, top: 120, width: 400, height: 100 }) },
  });
  expect(issues.some((issue) => issue.code === "content_overlap")).toBe(false);
}

function auditOverlapScene(options: {
  a: { textRect: DOMRect; color?: string; attrs?: string; clipPath?: string };
  b: { textRect: DOMRect; color?: string; attrs?: string; clipPath?: string };
}): ReturnType<typeof runAudit> {
  document.body.innerHTML = `
    <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
      <div id="a" ${options.a.attrs ?? ""}>Block A copy</div>
      <div id="b" ${options.b.attrs ?? ""}>Block B copy</div>
    </div>
  `;
  const colors: Record<string, string> = {
    a: options.a.color ?? "rgb(0, 0, 0)",
    b: options.b.color ?? "rgb(0, 0, 0)",
  };
  const clipPaths: Record<string, string> = {
    a: options.a.clipPath ?? "none",
    b: options.b.clipPath ?? "none",
  };
  const textRects: Record<string, DOMRect> = { a: options.a.textRect, b: options.b.textRect };

  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const id = (element as Element).id;
    return {
      display: "block",
      visibility: "visible",
      opacity: "1",
      color: colors[id] ?? "rgb(0, 0, 0)",
      clipPath: clipPaths[id] ?? "none",
    } as unknown as CSSStyleDeclaration;
  });

  // A clipped-to-nothing element is unreachable by elementFromPoint; mimic that
  // by returning the topmost non-clipped block at any probe point.
  (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => {
    if (!isFullyClipped(clipPaths.b ?? "none")) return document.getElementById("b");
    if (!isFullyClipped(clipPaths.a ?? "none")) return document.getElementById("a");
    return null;
  };

  for (const element of Array.from(document.querySelectorAll("*"))) {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
      textRects[element.id] ?? rect({ left: 0, top: 0, width: 1920, height: 1080 }),
    );
  }

  vi.spyOn(document, "createRange").mockImplementation(() => {
    let selected: Node | null = null;
    return {
      selectNodeContents(node: Node) {
        selected = node;
      },
      getClientRects() {
        const id = (selected as Element | null)?.id ?? "";
        return textRects[id]
          ? ([textRects[id]] as unknown as DOMRectList)
          : ([] as unknown as DOMRectList);
      },
      detach() {},
    } as unknown as Range;
  });

  installAuditScript();
  return runAudit();
}

function isFullyClipped(clipPath: string): boolean {
  return /inset\([^)]*100%|circle\(0px/i.test(clipPath);
}

describe("layout-audit.browser occlusion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    delete (window as unknown as { __hyperframesLayoutAudit?: unknown }).__hyperframesLayoutAudit;
  });

  it("flags text painted over by an opaque sibling overlay", () => {
    const occluded = auditOcclusionScene({
      overlayStyle: { backgroundColor: "rgb(10, 10, 10)" },
      topmostId: "overlay",
    }).find((issue) => issue.code === "text_occluded");
    expect(occluded).toMatchObject({ selector: "#headline", containerSelector: "#overlay" });
  });

  it("reports occlusion only on the covered text, not the text itself when on top", () => {
    // elementFromPoint returns the headline itself (it is on top), so nothing
    // occludes it — the topmost-hit-is-self path must NOT flag.
    const issues = auditOcclusionScene({
      overlayStyle: { backgroundColor: "rgb(10, 10, 10)" },
      topmostId: "headline",
    });
    expect(issues.some((issue) => issue.code === "text_occluded")).toBe(false);
  });

  it("ignores low-opacity overlays such as scrims and grain", () => {
    const issues = auditOcclusionScene({
      overlayStyle: { backgroundColor: "rgb(10, 10, 10)", opacity: "0.3" },
      topmostId: "overlay",
    });
    expect(issues.some((issue) => issue.code === "text_occluded")).toBe(false);
  });

  it("respects the data-layout-allow-occlusion opt-out", () => {
    const issues = auditOcclusionScene({
      headlineAttrs: "data-layout-allow-occlusion",
      overlayStyle: { backgroundColor: "rgb(10, 10, 10)" },
      topmostId: "overlay",
    });
    expect(issues.some((issue) => issue.code === "text_occluded")).toBe(false);
  });
});

function auditOcclusionScene(options: {
  headlineAttrs?: string;
  overlayStyle: Partial<Record<string, string>>;
  topmostId: string;
}): ReturnType<typeof runAudit> {
  document.body.innerHTML = `
    <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
      <div id="headline" ${options.headlineAttrs ?? ""}>Headline copy</div>
      <div id="overlay"></div>
    </div>
  `;
  installOcclusionGeometry({
    styleOverrides: { overlay: options.overlayStyle },
    headlineTextRect: rect({ left: 200, top: 500, width: 600, height: 80 }),
    topmostId: options.topmostId,
  });
  installAuditScript();
  return runAudit();
}

function installOcclusionGeometry(options: {
  styleOverrides: Record<string, Partial<Record<string, string>>>;
  headlineTextRect: DOMRect;
  topmostId: string;
}): void {
  const baseStyle: Record<string, string> = {
    display: "block",
    visibility: "visible",
    opacity: "1",
    overflow: "visible",
    overflowX: "visible",
    overflowY: "visible",
    backgroundColor: "rgba(0, 0, 0, 0)",
    backgroundImage: "none",
    borderTopWidth: "0px",
    borderRightWidth: "0px",
    borderBottomWidth: "0px",
    borderLeftWidth: "0px",
    borderTopLeftRadius: "0px",
    borderTopRightRadius: "0px",
    borderBottomRightRadius: "0px",
    borderBottomLeftRadius: "0px",
    paddingTop: "0px",
    paddingRight: "0px",
    paddingBottom: "0px",
    paddingLeft: "0px",
    fontSize: "36px",
  };

  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const id = (element as Element).id;
    return {
      ...baseStyle,
      ...(options.styleOverrides[id] ?? {}),
    } as unknown as CSSStyleDeclaration;
  });

  for (const element of Array.from(document.querySelectorAll("*"))) {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
      rect({ left: 0, top: 0, width: 1920, height: 1080 }),
    );
  }

  vi.spyOn(document, "createRange").mockImplementation(() => {
    let selected: Node | null = null;
    return {
      selectNodeContents(node: Node) {
        selected = node;
      },
      getClientRects() {
        return (selected as Element | null)?.id === "headline"
          ? ([options.headlineTextRect] as unknown as DOMRectList)
          : ([] as unknown as DOMRectList);
      },
      detach() {},
    } as unknown as Range;
  });

  (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
    document.getElementById(options.topmostId);
}

function installAuditScript(): void {
  window.eval(script);
}

// `pixels`, when provided, replaces the flat-white default screenshot buffer
// — used by tests that need the "hidden text" screenshot to actually vary by
// position (e.g. a solid-fill pill sitting on a busy page background) so the
// two-phase prepare/finish sampling has something real to distinguish.
function installContrastScript(pixels?: Uint8ClampedArray): void {
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
      return { data: pixels ?? new Uint8ClampedArray(640 * 360 * 4).fill(255) };
    },
  } as unknown as CanvasRenderingContext2D);
  window.eval(contrastScript);
}

// Builds a 640×360 RGBA buffer that's `fillColor` inside `insideRect` and
// `outsideColor` everywhere else — models a solid-fill pill/button (a dark
// rounded rect) sitting on a busy/bright page background, so a test can
// assert the two-phase prepare/finish path samples the pill's own pixels
// (inside the element's bbox) rather than whatever's outside it.
function pixelsWithRegion(
  insideRect: RectInput,
  fillColor: [number, number, number],
  outsideColor: [number, number, number],
): Uint8ClampedArray {
  const width = 640;
  const height = 360;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside =
        x >= insideRect.left &&
        x < insideRect.left + insideRect.width &&
        y >= insideRect.top &&
        y < insideRect.top + insideRect.height;
      const [r, g, b] = inside ? fillColor : outsideColor;
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return data;
}

async function runContrastAudit(): Promise<Array<Record<string, unknown>>> {
  const w = window as unknown as {
    __contrastAuditPrepare: () => Array<Record<string, unknown>>;
    __contrastAuditFinish: (
      imgBase64: string,
      time: number,
      candidates: Array<Record<string, unknown>>,
    ) => Promise<Array<Record<string, unknown>>>;
  };
  const candidates = w.__contrastAuditPrepare();
  return w.__contrastAuditFinish("stub", 0, candidates);
}

function runAudit(): Array<{
  code: string;
  selector: string;
  containerSelector?: string;
  overflow?: Record<string, number>;
  message?: string;
}> {
  const audit = (
    window as unknown as {
      __hyperframesLayoutAudit: (options: { time: number; tolerance: number }) => Array<{
        code: string;
        selector: string;
        containerSelector?: string;
        overflow?: Record<string, number>;
        message?: string;
      }>;
    }
  ).__hyperframesLayoutAudit;
  return audit({ time: 1, tolerance: 2 });
}

function installGeometry(rects: Record<string, DOMRect>): void {
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const el = element as Element;
    const isBubble = el.id === "bubble";
    return {
      display: "block",
      visibility: "visible",
      opacity: "1",
      overflow: "visible",
      overflowX: "visible",
      overflowY: "visible",
      backgroundColor: isBubble ? "rgb(255, 255, 255)" : "rgba(0, 0, 0, 0)",
      backgroundImage: "none",
      borderTopWidth: "0px",
      borderRightWidth: "0px",
      borderBottomWidth: "0px",
      borderLeftWidth: "0px",
      borderTopLeftRadius: isBubble ? "28px" : "0px",
      borderTopRightRadius: isBubble ? "28px" : "0px",
      borderBottomRightRadius: isBubble ? "28px" : "0px",
      borderBottomLeftRadius: isBubble ? "28px" : "0px",
      paddingTop: isBubble ? "16px" : "0px",
      paddingRight: isBubble ? "16px" : "0px",
      paddingBottom: isBubble ? "16px" : "0px",
      paddingLeft: isBubble ? "16px" : "0px",
      fontSize: "36px",
    } as unknown as CSSStyleDeclaration;
  });

  for (const element of Array.from(document.querySelectorAll("*"))) {
    const key =
      element.id === "root" || element.hasAttribute("data-composition-id")
        ? "root"
        : element.id === "headline" || element.hasAttribute("data-layout-name")
          ? "headline"
          : element.id;
    const rectValue = rects[key] ?? rect({ left: 0, top: 0, width: 10, height: 10 });
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rectValue);
  }

  vi.spyOn(document, "createRange").mockImplementation(() => {
    let selected: Node | null = null;
    return {
      selectNodeContents(node: Node) {
        selected = node;
      },
      getClientRects() {
        const element = selected as Element | null;
        const textRect = element?.id === "ignored" ? rects.ignored : rects.text;
        return textRect ? ([textRect] as unknown as DOMRectList) : ([] as unknown as DOMRectList);
      },
      detach() {},
    } as unknown as Range;
  });
}

function rect({ left, top, width, height }: RectInput): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON() {
      return this;
    },
  } as DOMRect;
}
