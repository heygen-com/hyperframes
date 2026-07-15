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

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  Reflect.deleteProperty(document, "elementFromPoint");
  Reflect.deleteProperty(window, "__hyperframesLayoutAudit");
  clearGeometryCollector();
});

describe("layout-audit.browser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete (window as unknown as { __hyperframesLayoutAudit?: unknown }).__hyperframesLayoutAudit;
    clearGeometryCollector();
  });

  it("changes the sweep fingerprint when visible video pixels advance", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <video id="footage"></video>
      </div>
    `;
    installGeometry({
      root: rect({ left: 0, top: 0, width: 640, height: 360 }),
      footage: rect({ left: 0, top: 0, width: 640, height: 360 }),
    });

    let pixelValue = 20;
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext") as unknown as {
      mockReturnValue(value: CanvasRenderingContext2D): void;
    };
    getContextSpy.mockReturnValue({
      drawImage() {},
      getImageData() {
        return { data: new Uint8ClampedArray(8 * 8 * 4).fill(pixelValue) };
      },
    } as unknown as CanvasRenderingContext2D);

    installAuditScript();
    const collect = (window as unknown as { __hyperframesLayoutGeometry: () => string })
      .__hyperframesLayoutGeometry;
    const before = collect();
    pixelValue = 220;
    const after = collect();

    expect(after).not.toBe(before);
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

  it("suppresses intentional ellipsis clipping under overflow opt-outs", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="overflow-optout">
          <div id="headline" style="width: 100px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">
            Intentional long truncated label
          </div>
        </div>
      </div>
    `;
    const headline = document.querySelector("#headline");
    if (!(headline instanceof HTMLElement)) throw new Error("missing headline");
    Object.defineProperties(headline, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 240 },
      clientHeight: { configurable: true, value: 20 },
      scrollHeight: { configurable: true, value: 20 },
    });
    installGeometry(
      {
        root: rect({ left: 0, top: 0, width: 640, height: 360 }),
        headline: rect({ left: 40, top: 60, width: 100, height: 20 }),
        text: rect({ left: 40, top: 60, width: 240, height: 20 }),
      },
      {
        headline: { overflow: "hidden", overflowX: "hidden", overflowY: "hidden" },
      },
    );

    installAuditScript();
    const textOverflowCodes = () =>
      runAudit()
        .map((issue) => issue.code)
        .filter((code) => code === "clipped_text" || code === "text_box_overflow");

    expect(textOverflowCodes()).toEqual(["clipped_text", "text_box_overflow"]);
    document.querySelector("#overflow-optout")?.setAttribute("data-layout-allow-overflow", "");
    expect(textOverflowCodes()).toEqual([]);
    document.querySelector("#overflow-optout")?.removeAttribute("data-layout-allow-overflow");
    headline.setAttribute("data-layout-bleed", "true");
    expect(textOverflowCodes()).toEqual([]);
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

  it("keeps auditing visible descendants beyond the second element", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="first"></div>
        <div id="second"></div>
        <div id="third"></div>
        <div id="late">Late visible copy</div>
      </div>
    `;
    installGeometry({
      root: rect({ left: 0, top: 0, width: 640, height: 360 }),
      late: rect({ left: 700, top: 100, width: 140, height: 40 }),
      text: rect({ left: 700, top: 100, width: 140, height: 40 }),
    });
    installAuditScript();

    expect(runAudit()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "canvas_overflow", selector: "#late" }),
      ]),
    );
  });

  it("does not expand a parent's overflow geometry to a positioned descendant", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="headline">Visible copy<span id="positioned-copy">Positioned copy</span></div>
      </div>
    `;
    installGeometry(
      {
        root: rect({ left: 0, top: 0, width: 640, height: 360 }),
        headline: rect({ left: 40, top: 60, width: 200, height: 40 }),
        "positioned-copy": rect({ left: 700, top: 60, width: 160, height: 40 }),
        headlineText: rect({ left: 40, top: 60, width: 120, height: 40 }),
        "positioned-copyText": rect({ left: 700, top: 60, width: 160, height: 40 }),
        text: rect({ left: 40, top: 60, width: 820, height: 40 }),
      },
      { "positioned-copy": { position: "absolute" } },
    );
    installAuditScript();

    const parentOverflow = runAudit().find(
      (issue) => issue.code === "canvas_overflow" && issue.selector === "#headline",
    );
    expect(parentOverflow).toBeUndefined();
  });
});

it("is inert unless text or media candidates are explicitly requested", () => {
  document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="copy">Visible copy</div>
      </div>
    `;
  installGeometry({
    root: rect({ left: 0, top: 0, width: 640, height: 360 }),
    copy: rect({ left: 100, top: 100, width: 200, height: 40 }),
    text: rect({ left: 100, top: 100, width: 200, height: 40 }),
  });
  installAuditScript();

  expect(runGeometryCandidates({ text: false, media: false, tolerance: 2 })).toEqual([]);
});

it("returns own-text rects and media overflow while excluding caption layers", () => {
  document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <section data-composition-file="scenes/hero.html">
          <div id="copy" data-layout-name="copy">Own copy <span id="nested">Nested</span></div>
          <img id="image" src="data:image/png;base64,AA==" />
          <svg id="vector"></svg>
        </section>
        <div class="caption-layer"><p id="caption">Authored captions</p></div>
      </div>
    `;
  installGeometry({
    root: rect({ left: 0, top: 0, width: 640, height: 360 }),
    copy: rect({ left: 100, top: 260, width: 180, height: 40 }),
    headline: rect({ left: 100, top: 260, width: 180, height: 40 }),
    nested: rect({ left: 220, top: 260, width: 60, height: 40 }),
    image: rect({ left: 600, top: 40, width: 200, height: 100 }),
    vector: rect({ left: -130, top: 160, width: 100, height: 100 }),
    caption: rect({ left: 200, top: 300, width: 240, height: 40 }),
    text: rect({ left: 100, top: 260, width: 100, height: 40 }),
  });
  installAuditScript();

  const candidates = runGeometryCandidates({ text: true, media: true, tolerance: 2 });

  expect(candidates).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "text",
        tag: "div",
        text: "Own copy",
        selector: "#copy",
        sourceFile: "scenes/hero.html",
        rect: { left: 100, top: 260, right: 200, bottom: 300, width: 100, height: 40 },
        elementRect: { left: 100, top: 260, right: 280, bottom: 300, width: 180, height: 40 },
      }),
      expect.objectContaining({
        kind: "media",
        tag: "img",
        selector: "#image",
        overflow: { right: 160 },
      }),
      expect.objectContaining({
        kind: "media",
        tag: "svg",
        selector: "#vector",
        overflow: { left: 130 },
      }),
    ]),
  );
  expect(candidates.some((candidate) => candidate.selector === "#caption")).toBe(false);
});

it("scans body-level composition siblings and includes a media boundary root", () => {
  document.body.innerHTML = `
    <canvas id="boundary" data-composition-id="background" data-width="640" data-height="360"></canvas>
    <div id="root" data-composition-id="main" data-width="640" data-height="360">
      <p id="portal-copy">Portal copy</p>
    </div>
    <img id="portal-image" src="data:image/png;base64,AA==" />
  `;
  installGeometry({
    root: rect({ left: 0, top: 0, width: 640, height: 360 }),
    "portal-copy": rect({ left: 100, top: 260, width: 180, height: 40 }),
    "portal-image": rect({ left: 600, top: 80, width: 180, height: 100 }),
    text: rect({ left: 100, top: 260, width: 180, height: 40 }),
  });
  installAuditScript();

  const candidates = runGeometryCandidates({ text: true, media: true, tolerance: 2 });

  expect(candidates.map((candidate) => candidate.selector)).toEqual(
    expect.arrayContaining(["#boundary", "#portal-copy", "#portal-image"]),
  );
});

it("returns unique structural selectors for repeated class-only media", () => {
  document.body.innerHTML = `
    <div id="root" data-composition-id="main" data-width="640" data-height="360">
      <img class="tile" src="data:image/png;base64,AA==" />
      <img class="tile" src="data:image/png;base64,AA==" />
    </div>
  `;
  installGeometry({
    root: rect({ left: 0, top: 0, width: 640, height: 360 }),
    "": rect({ left: 100, top: 100, width: 100, height: 100 }),
  });
  installAuditScript();

  const candidates = runGeometryCandidates({ text: false, media: true, tolerance: 2 });
  const images = Array.from(document.querySelectorAll("img"));

  expect(candidates).toHaveLength(2);
  expect(new Set(candidates.map((candidate) => candidate.selector)).size).toBe(2);
  expect(document.querySelector(candidates[0]?.selector ?? "")).toBe(images[0]);
  expect(document.querySelector(candidates[1]?.selector ?? "")).toBe(images[1]);
});

it("keeps visible clip-path text when pointer events do not participate in hit testing", () => {
  document.body.innerHTML = `
    <div id="root" data-composition-id="main" data-width="640" data-height="360">
      <p id="clipped-copy">Visible clipped copy</p>
    </div>
  `;
  installGeometry(
    {
      root: rect({ left: 0, top: 0, width: 640, height: 360 }),
      "clipped-copy": rect({ left: 100, top: 100, width: 200, height: 40 }),
      text: rect({ left: 100, top: 100, width: 200, height: 40 }),
    },
    { "clipped-copy": { clipPath: "inset(0 10% 0 0)", pointerEvents: "none" } },
  );
  Reflect.set(
    document,
    "elementFromPoint",
    vi.fn(() => document.getElementById("root")),
  );
  installAuditScript();

  const candidates = runGeometryCandidates({ text: true, media: false, tolerance: 2 });

  expect(candidates).toEqual(
    expect.arrayContaining([expect.objectContaining({ selector: "#clipped-copy" })]),
  );
});

it("uses the bridge opacity floor across the ancestor chain", () => {
  document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="faint-parent"><p id="hidden-copy">Hidden copy</p></div>
        <div id="soft-parent"><p id="visible-copy">Visible copy</p></div>
        <div id="stacked-parent"><p id="stacked-copy">Stacked opacity copy</p></div>
      </div>
    `;
  installGeometry(
    {
      root: rect({ left: 0, top: 0, width: 640, height: 360 }),
      "faint-parent": rect({ left: 40, top: 40, width: 200, height: 40 }),
      "hidden-copy": rect({ left: 40, top: 40, width: 200, height: 40 }),
      "soft-parent": rect({ left: 40, top: 120, width: 200, height: 40 }),
      "visible-copy": rect({ left: 40, top: 120, width: 200, height: 40 }),
      "stacked-parent": rect({ left: 40, top: 200, width: 200, height: 40 }),
      "stacked-copy": rect({ left: 40, top: 200, width: 200, height: 40 }),
      text: rect({ left: 40, top: 120, width: 200, height: 40 }),
    },
    {
      "faint-parent": { opacity: "0.04" },
      "soft-parent": { opacity: "0.1" },
      "stacked-parent": { opacity: "0.2" },
      "stacked-copy": { opacity: "0.2" },
    },
  );
  installAuditScript();

  const candidates = runGeometryCandidates({ text: true, media: false, tolerance: 2 });

  expect(candidates.some((candidate) => candidate.selector === "#hidden-copy")).toBe(false);
  expect(candidates.some((candidate) => candidate.selector === "#visible-copy")).toBe(true);
  expect(candidates.some((candidate) => candidate.selector === "#stacked-copy")).toBe(true);
});

describe("layout-audit.browser invisible text", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete (window as unknown as { __hyperframesLayoutAudit?: unknown }).__hyperframesLayoutAudit;
    clearGeometryCollector();
  });

  // The mock resolves computed style per element, so setting `webkitTextFillColor`
  // on the headline models exactly what the browser computes there — whether the
  // value was authored on the element or inherited from an ancestor.
  function invisibleTextScene(
    headlineStyle: Partial<CSSStyleDeclaration>,
    text = "Headline copy",
  ): AuditIssue[] {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="headline">${text}</div>
      </div>
    `;
    installGeometry(
      {
        root: rect({ left: 0, top: 0, width: 640, height: 360 }),
        headline: rect({ left: 40, top: 150, width: 300, height: 56 }),
        text: rect({ left: 40, top: 150, width: 300, height: 56 }),
      },
      { headline: headlineStyle },
    );
    installAuditScript();
    return runAudit();
  }

  const flagged = (issues: AuditIssue[]) =>
    issues.some((issue) => issue.code === "text_not_painted");
  const style = (s: Record<string, string>) => s as unknown as Partial<CSSStyleDeclaration>;

  it("flags a directly transparent -webkit-text-fill-color", () => {
    const issues = invisibleTextScene(
      style({ color: "rgb(255, 255, 255)", webkitTextFillColor: "rgba(0, 0, 0, 0)" }),
    );
    expect(issues.find((i) => i.code === "text_not_painted")).toMatchObject({
      selector: "#headline",
      severity: "error",
    });
  });

  it("flags an inherited transparent fill overriding the child's opaque color", () => {
    // getComputedStyle on the child resolves the inherited fill to transparent
    // (browsers always return the rgba() form), even though the child sets its
    // own opaque `color`.
    expect(
      flagged(
        invisibleTextScene(
          style({ color: "rgb(255, 255, 255)", webkitTextFillColor: "rgba(0, 0, 0, 0)" }),
        ),
      ),
    ).toBe(true);
  });

  it("flags color:transparent when no explicit fill is set (color fallback)", () => {
    // -webkit-text-fill-color unset → resolves to `color`; a transparent color
    // must still be caught via the `|| cs.color` fallback.
    expect(flagged(invisibleTextScene(style({ color: "rgba(0, 0, 0, 0)" })))).toBe(true);
  });

  it("does not flag opaque text with a default fill", () => {
    expect(flagged(invisibleTextScene(style({ color: "rgb(255, 255, 255)" })))).toBe(false);
  });

  it("does not flag gradient text (transparent fill clipped over a real background)", () => {
    expect(
      flagged(
        invisibleTextScene(
          style({
            color: "rgb(255, 255, 255)",
            webkitTextFillColor: "rgba(0, 0, 0, 0)",
            webkitBackgroundClip: "text",
            backgroundImage: "linear-gradient(90deg, rgb(255, 0, 0), rgb(0, 0, 255))",
          }),
        ),
      ),
    ).toBe(false);
  });

  it("still flags background-clip:text when no background actually paints the glyphs", () => {
    // A clipped-to-text fill with no gradient/image and a transparent background
    // paints nothing — a broken gradient must remain reportable.
    expect(
      flagged(
        invisibleTextScene(
          style({
            webkitTextFillColor: "rgba(0, 0, 0, 0)",
            webkitBackgroundClip: "text",
            backgroundImage: "none",
            backgroundColor: "rgba(0, 0, 0, 0)",
          }),
        ),
      ),
    ).toBe(true);
  });

  it("does not flag an element with a transparent fill but no text content", () => {
    expect(
      flagged(invisibleTextScene(style({ webkitTextFillColor: "rgba(0, 0, 0, 0)" }), "")),
    ).toBe(false);
  });
});

describe("layout-audit.browser coordinate-frame findings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete (window as unknown as { __hyperframesLayoutAudit?: unknown }).__hyperframesLayoutAudit;
    clearGeometryCollector();
  });

  it("flags a positioned element rendering far outside its offset parent", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="diagram"><div id="node"></div><div id="badge"></div><div id="callout"></div></div>
      </div>
    `;
    installGeometry(
      {
        root: rect({ left: 0, top: 0, width: 1920, height: 1080 }),
        diagram: rect({ left: 610, top: 130, width: 700, height: 700 }),
        node: rect({ left: 1490, top: 170, width: 160, height: 160 }),
        badge: rect({ left: 580, top: 160, width: 120, height: 120 }),
        callout: rect({ left: 700, top: 60, width: 160, height: 56 }),
      },
      {
        node: { position: "absolute" },
        badge: { position: "absolute" },
        callout: { position: "absolute" },
      },
    );
    installOffsetParents({ node: "diagram", badge: "diagram", callout: "diagram" });
    installAuditScript();

    const issues = runAudit().filter((issue) => issue.code === "escaped_container");
    // The node is 180px away in a foreign frame; the badge overlaps its parent; the callout hangs 14px above it.
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: "warning",
      selector: "#node",
      containerSelector: "#diagram",
    });
    expect(issues[0]?.message).toContain("computed in a different frame");
    expect(issues[0]?.fixHint).toContain("offset parent's frame");
  });

  it("respects the allow-overflow opt-out and skips fixed elements", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="diagram">
          <div id="node" data-layout-allow-overflow></div>
          <div id="hud"></div>
        </div>
      </div>
    `;
    installGeometry(
      {
        root: rect({ left: 0, top: 0, width: 1920, height: 1080 }),
        diagram: rect({ left: 610, top: 130, width: 700, height: 700 }),
        node: rect({ left: 1490, top: 170, width: 160, height: 160 }),
        hud: rect({ left: 24, top: 900, width: 200, height: 100 }),
      },
      {
        node: { position: "absolute" },
        hud: { position: "fixed" },
      },
    );
    installOffsetParents({ node: "diagram", hud: "diagram" });
    installAuditScript();

    expect(runAudit().filter((issue) => issue.code === "escaped_container")).toEqual([]);
  });

  it("flags painted panels crossing the canvas, hero-sized as warning and bleeds as info", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="hero"></div>
        <div id="bleed"></div>
        <div id="glow"></div>
        <div id="spotlight"></div>
        <div id="goldframe"></div>
        <div id="parked"></div>
      </div>
    `;
    installGeometry(
      {
        root: rect({ left: 0, top: 0, width: 1920, height: 1080 }),
        hero: rect({ left: 1400, top: 300, width: 800, height: 600 }),
        bleed: rect({ left: -150, top: -150, width: 300, height: 300 }),
        glow: rect({ left: 1800, top: 0, width: 400, height: 400 }),
        spotlight: rect({ left: 560, top: -216, width: 800, height: 1200 }),
        goldframe: rect({ left: 660, top: -150, width: 620, height: 820 }),
        parked: rect({ left: 2200, top: 300, width: 600, height: 400 }),
      },
      {
        // Paint alone qualifies — a flat solid panel with no padding/border is still content.
        hero: { backgroundColor: "rgb(20, 20, 30)" },
        bleed: { backgroundColor: "rgb(200, 180, 120)" },
        // Gradient-only paint is decoration; a border is content even with pointer-events:none.
        spotlight: {
          backgroundImage: "radial-gradient(ellipse at top, rgba(212,175,55,0.15), transparent)",
        },
        goldframe: { borderTopWidth: "10px", borderBottomWidth: "10px" },
        parked: { backgroundColor: "rgb(20, 20, 30)" },
      },
    );
    installAuditScript();

    const issues = runAudit().filter((issue) => issue.code === "panel_out_of_canvas");
    // The unpainted glow, gradient-only spotlight, and fully off-canvas parked entrance stay silent.
    expect(issues).toHaveLength(3);
    expect(issues.some((issue) => issue.selector === "#goldframe")).toBe(true);
    expect(issues.some((issue) => issue.selector === "#spotlight")).toBe(false);
    expect(issues.find((issue) => issue.selector === "#hero")).toMatchObject({
      severity: "warning",
      overflow: { right: 280 },
      message: "Painted panel extends outside the composition canvas.",
    });
    expect(issues.find((issue) => issue.selector === "#hero")?.fixHint).toContain(
      "data-layout-allow-overflow",
    );
    expect(issues.find((issue) => issue.selector === "#bleed")).toMatchObject({ severity: "info" });
  });

  it("flags a gradient-content hero but not an all-translucent gradient glow", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="gradient-hero"></div>
      </div>
    `;
    installGeometry(
      {
        root: rect({ left: 0, top: 0, width: 1920, height: 1080 }),
        "gradient-hero": rect({ left: 1400, top: 300, width: 800, height: 600 }),
      },
      {
        // Opaque gradient stops read as content — miguel's regression case.
        "gradient-hero": {
          backgroundImage: "linear-gradient(90deg, rgb(16, 24, 40), rgb(52, 64, 84))",
        },
      },
    );
    installAuditScript();

    const issues = runAudit().filter((issue) => issue.code === "panel_out_of_canvas");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", selector: "#gradient-hero" });
  });

  it("cedes ownership to canvas_overflow even for a shallow text breach", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="hero">Barely breaching title</div>
      </div>
    `;
    installGeometry(
      {
        root: rect({ left: 0, top: 0, width: 1920, height: 1080 }),
        hero: rect({ left: 1400, top: 300, width: 800, height: 600 }),
        // Text breaches 20px: past canvas_overflow's 2px tolerance, under the 27px panel floor.
        text: rect({ left: 1740, top: 340, width: 200, height: 50 }),
      },
      {
        hero: { backgroundColor: "rgb(20, 20, 30)" },
      },
    );
    installAuditScript();

    const issues = runAudit();
    expect(issues.filter((issue) => issue.code === "panel_out_of_canvas")).toEqual([]);
    expect(issues.some((issue) => issue.code === "canvas_overflow")).toBe(true);
  });

  it("flags a painted hero whose box breaches while its direct text stays in-bounds", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="hero">Title</div>
      </div>
    `;
    installGeometry(
      {
        root: rect({ left: 0, top: 0, width: 1920, height: 1080 }),
        hero: rect({ left: 1400, top: 300, width: 800, height: 600 }),
        text: rect({ left: 1450, top: 340, width: 200, height: 50 }),
      },
      {
        hero: { backgroundColor: "rgb(20, 20, 30)" },
      },
    );
    installAuditScript();

    const issues = runAudit();
    expect(issues.filter((issue) => issue.code === "panel_out_of_canvas")).toHaveLength(1);
    expect(issues.filter((issue) => issue.code === "canvas_overflow")).toEqual([]);
  });

  it("leaves a breaching panel to canvas_overflow when its own text breaches too", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="hero">Very long breaching title</div>
      </div>
    `;
    installGeometry(
      {
        root: rect({ left: 0, top: 0, width: 1920, height: 1080 }),
        hero: rect({ left: 1400, top: 300, width: 800, height: 600 }),
        text: rect({ left: 1450, top: 340, width: 700, height: 50 }),
      },
      {
        hero: { backgroundColor: "rgb(20, 20, 30)" },
      },
    );
    installAuditScript();

    const issues = runAudit();
    expect(issues.filter((issue) => issue.code === "panel_out_of_canvas")).toEqual([]);
    expect(issues.some((issue) => issue.code === "canvas_overflow")).toBe(true);
  });

  it("flags connector paths drawn in a foreign frame and passes anchored ones", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="n1"></div>
        <div id="n2"></div>
        <svg id="connector-svg">
          <defs><marker id="arrow"><path id="tip" d="M 0 0 L 8 4 L 0 8" /></marker></defs>
          <path id="detached" class="connector-line" d="M 980 580 L 380 280" />
          <path id="anchored" class="connector-line" d="M 900 353 L 300 53" />
        </svg>
      </div>
    `;
    installGeometry(
      {
        root: rect({ left: 0, top: 0, width: 1920, height: 1080 }),
        n1: rect({ left: 900, top: 500, width: 160, height: 160 }),
        n2: rect({ left: 300, top: 200, width: 160, height: 160 }),
        "connector-svg": rect({ left: 80, top: 227, width: 1740, height: 830 }),
      },
      {
        n1: { backgroundColor: "rgb(30, 40, 50)" },
        n2: { backgroundColor: "rgb(30, 40, 50)" },
      },
    );
    // Screen CTM translates svg user space by the svg's offset (80, 227): the detached path's
    // start (980, 580) renders at (1060, 807) — 147px below #n1's box — while the anchored
    // path's start (900, 353) renders at (980, 580), inside #n1.
    installConnectorGeometry({ e: 80, f: 227 });
    installAuditScript();

    const issues = runAudit().filter((issue) => issue.code === "connector_detached");
    // The marker tip path is skipped outright; only the detached line reports.
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", selector: "#detached" });
    expect(issues[0]?.message).toContain("drawn into an SVG with a different origin");
    expect(issues[0]?.fixHint).toContain("Subtract the SVG's own rect");
  });

  it("skips svgs and paths without connector intent", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="n1"></div>
        <div id="n2"></div>
        <svg id="knowledge-overflow"><path id="squiggle" d="M 10 10 L 200 200" /></svg>
      </div>
    `;
    installGeometry(
      {
        root: rect({ left: 0, top: 0, width: 1920, height: 1080 }),
        n1: rect({ left: 900, top: 500, width: 160, height: 160 }),
        n2: rect({ left: 300, top: 200, width: 160, height: 160 }),
        "knowledge-overflow": rect({ left: 1400, top: 100, width: 400, height: 400 }),
      },
      {
        n1: { backgroundColor: "rgb(30, 40, 50)" },
        n2: { backgroundColor: "rgb(30, 40, 50)" },
      },
    );
    installConnectorGeometry({ e: 0, f: 0 });
    installAuditScript();

    // "knowledge-overflow" contains conn-family substrings only across word boundaries — no match.
    expect(runAudit().filter((issue) => issue.code === "connector_detached")).toEqual([]);
  });
});

describe("layout-audit.browser content overlap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    delete (window as unknown as { __hyperframesLayoutAudit?: unknown }).__hyperframesLayoutAudit;
    clearGeometryCollector();
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

  it("ignores another block placed only in a multiline text block's empty line gap", () => {
    const issues = auditOverlapScene({
      a: {
        textRect: [
          rect({ left: 100, top: 100, width: 400, height: 60 }),
          rect({ left: 100, top: 260, width: 400, height: 60 }),
        ],
      },
      b: { textRect: rect({ left: 180, top: 180, width: 240, height: 50 }) },
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

  it("excludes data-layout-ignore set dressing from contrast reports", async () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div data-layout-ignore>
          <div id="rail-label">SHAPE</div>
        </div>
        <div id="headline">Readable copy</div>
      </div>
    `;

    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          display: "block",
          visibility: "visible",
          opacity: "1",
          color: "rgb(30, 30, 42)",
          fontSize: "32px",
          fontWeight: "400",
          clipPath: "none",
        }) as unknown as CSSStyleDeclaration,
    );
    for (const id of ["rail-label", "headline"]) {
      vi.spyOn(document.getElementById(id)!, "getBoundingClientRect").mockReturnValue(
        rect({ left: 100, top: id === "headline" ? 200 : 100, width: 400, height: 40 }),
      );
    }
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
      null;

    installContrastScript();

    const entries = await runContrastAudit();
    const selectors = entries.map((entry) => entry.selector);
    expect(selectors).toContain("#headline");
    expect(selectors).not.toContain("#rail-label");
  });

  it("excludes intentionally occluded text from contrast reports", async () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="headline" data-layout-allow-occlusion>Covered copy</div>
        <div id="cover"></div>
      </div>
    `;

    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          display: "block",
          visibility: "visible",
          opacity: "1",
          color: "rgb(255, 255, 255)",
          fontSize: "32px",
          fontWeight: "400",
          clipPath: "none",
        }) as unknown as CSSStyleDeclaration,
    );
    vi.spyOn(document.getElementById("headline")!, "getBoundingClientRect").mockReturnValue(
      rect({ left: 100, top: 100, width: 400, height: 40 }),
    );
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
      document.getElementById("cover");

    installContrastScript();

    expect(await runContrastAudit()).toEqual([]);
  });

  it("still audits visible text that allows occlusion", async () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="headline" data-layout-allow-occlusion>Visible copy</div>
      </div>
    `;

    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          display: "block",
          visibility: "visible",
          opacity: "1",
          color: "rgb(255, 255, 255)",
          fontSize: "32px",
          fontWeight: "400",
          clipPath: "none",
        }) as unknown as CSSStyleDeclaration,
    );
    vi.spyOn(document.getElementById("headline")!, "getBoundingClientRect").mockReturnValue(
      rect({ left: 100, top: 100, width: 400, height: 40 }),
    );
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
      document.getElementById("headline");

    installContrastScript();

    const entries = await runContrastAudit();
    expect(entries.map((entry) => entry.selector)).toContain("#headline");
  });

  it("excludes text that has left the canvas from contrast reports", async () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="exited">You</div>
        <div id="headline">Readable copy</div>
      </div>
    `;

    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          display: "block",
          visibility: "visible",
          opacity: "1",
          color: "rgb(255, 255, 255)",
          fontSize: "32px",
          fontWeight: "400",
          clipPath: "none",
        }) as unknown as CSSStyleDeclaration,
    );
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 640 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 360 });
    // The cursor-exit shape: element parked far past the top-left corner.
    vi.spyOn(document.getElementById("exited")!, "getBoundingClientRect").mockReturnValue(
      rect({ left: -1420, top: -500, width: 60, height: 24 }),
    );
    vi.spyOn(document.getElementById("headline")!, "getBoundingClientRect").mockReturnValue(
      rect({ left: 100, top: 200, width: 400, height: 40 }),
    );
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
      null;

    installContrastScript();

    const entries = await runContrastAudit();
    const selectors = entries.map((entry) => entry.selector);
    expect(selectors).toContain("#headline");
    expect(selectors).not.toContain("#exited");
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

  it("resolves color-mix() foregrounds before computing contrast", async () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <span id="label">Mixed color</span>
      </div>
    `;

    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          display: "block",
          visibility: "visible",
          opacity: "1",
          color: "color-mix(in srgb, rgb(37, 99, 235) 20%, rgb(255, 255, 255) 80%)",
          fontSize: "20px",
          fontWeight: "400",
          clipPath: "none",
        }) as unknown as CSSStyleDeclaration,
    );
    vi.spyOn(document.getElementById("label")!, "getBoundingClientRect").mockReturnValue(
      rect({ left: 50, top: 50, width: 120, height: 30 }),
    );
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
      null;

    installContrastScript(
      pixelsWithRegion(
        rect({ left: 0, top: 0, width: 640, height: 360 }),
        [10, 10, 10],
        [10, 10, 10],
      ),
    );

    const result = await runContrastAudit();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      selector: "#label",
      fg: "rgb(211,224,251)",
      bg: "rgb(10,10,10)",
      ratio: 14.92,
      wcagAA: true,
    });
  });

  it("accepts outlined text when its stroke has adequate background contrast", async () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="640" data-height="360">
        <div id="caption">Outlined white caption</div>
      </div>
    `;

    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          display: "block",
          visibility: "visible",
          opacity: "1",
          color: "rgb(255, 255, 255)",
          webkitTextStrokeWidth: "8px",
          webkitTextStrokeColor: "rgb(0, 0, 0)",
          fontSize: "40px",
          fontWeight: "700",
          clipPath: "none",
        }) as unknown as CSSStyleDeclaration,
    );
    vi.spyOn(document.getElementById("caption")!, "getBoundingClientRect").mockReturnValue(
      rect({ left: 50, top: 50, width: 300, height: 60 }),
    );
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
      null;

    installContrastScript();

    const result = await runContrastAudit();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      selector: "#caption",
      fg: "rgb(0,0,0)",
      bg: "rgb(255,255,255)",
      wcagAA: true,
    });
  });

  it("skips text whose sampled backdrop remains transparent", async () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="overlay" data-width="640" data-height="360">
        <span id="label">Live</span>
      </div>
    `;

    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          display: "block",
          visibility: "visible",
          opacity: "1",
          color: "rgb(255, 255, 255)",
          fontSize: "20px",
          fontWeight: "700",
          clipPath: "none",
        }) as unknown as CSSStyleDeclaration,
    );
    vi.spyOn(document.getElementById("label")!, "getBoundingClientRect").mockReturnValue(
      rect({ left: 50, top: 50, width: 100, height: 30 }),
    );
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
      null;

    installContrastScript(new Uint8ClampedArray(640 * 360 * 4));

    expect(await runContrastAudit()).toEqual([]);
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
  a: { textRect: DOMRect | DOMRect[]; color?: string; attrs?: string; clipPath?: string };
  b: { textRect: DOMRect | DOMRect[]; color?: string; attrs?: string; clipPath?: string };
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
  const textRects: Record<string, DOMRect[]> = {
    a: normalizeTextRects(options.a.textRect),
    b: normalizeTextRects(options.b.textRect),
  };

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
      boundingTextRect(textRects[element.id]) ??
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
        const element =
          selected?.nodeType === Node.TEXT_NODE
            ? selected.parentElement
            : (selected as Element | null);
        const id = element?.id ?? "";
        return (textRects[id] ?? []) as unknown as DOMRectList;
      },
      detach() {},
    } as unknown as Range;
  });

  installAuditScript();
  return runAudit();
}

function normalizeTextRects(value: DOMRect | DOMRect[]): DOMRect[] {
  return Array.isArray(value) ? value : [value];
}

function boundingTextRect(rects: DOMRect[] | undefined): DOMRect | undefined {
  if (!rects?.length) return undefined;
  const left = Math.min(...rects.map((item) => item.left));
  const top = Math.min(...rects.map((item) => item.top));
  const right = Math.max(...rects.map((item) => item.right));
  const bottom = Math.max(...rects.map((item) => item.bottom));
  return rect({ left, top, width: right - left, height: bottom - top });
}

function isFullyClipped(clipPath: string): boolean {
  return /inset\([^)]*100%|circle\(0px/i.test(clipPath);
}

describe("layout-audit.browser occlusion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint;
    delete (window as unknown as { __hyperframesLayoutAudit?: unknown }).__hyperframesLayoutAudit;
    clearGeometryCollector();
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

  it("does not treat transparent pixels in an image as text occlusion", () => {
    const issues = auditImageOcclusionScene(0);
    expect(issues.some((issue) => issue.code === "text_occluded")).toBe(false);
  });

  it("still treats opaque pixels in an image as text occlusion", () => {
    const occluded = auditImageOcclusionScene(255).find((issue) => issue.code === "text_occluded");
    expect(occluded).toMatchObject({ selector: "#headline", containerSelector: "#overlay" });
  });

  it("does not treat object-fit letterboxing as image occlusion", () => {
    const issues = auditImageOcclusionScene(255, {
      objectFit: "contain",
      headlineTextRect: rect({ left: 50, top: 500, width: 200, height: 80 }),
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

  it("does not treat a visible container as painted text when its only text child is hidden", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="caption-container"><span id="caption">Hidden caption</span></div>
        <div id="overlay"></div>
      </div>
    `;
    installOcclusionGeometry({
      styleOverrides: {
        caption: { opacity: "0" },
        overlay: { backgroundColor: "rgb(10, 10, 10)" },
      },
      headlineTextRect: rect({ left: 200, top: 500, width: 600, height: 80 }),
      topmostId: "overlay",
      textRectElementId: "caption-container",
    });
    installAuditScript();

    const issues = runAudit();
    expect(issues.some((issue) => issue.code === "text_occluded")).toBe(false);
  });

  it("carries the fully-covered fraction when the occluder hits every probe point", () => {
    const occluded = auditOcclusionScene({
      overlayStyle: { backgroundColor: "rgb(10, 10, 10)" },
      topmostId: "overlay",
    }).find((issue) => issue.code === "text_occluded");
    expect(occluded?.coveredFraction).toBe(1);
  });

  // #U10: a 2-point hit on the 27-point probe grid (3 rows x 9 columns) is a
  // sliver of edge cover — reports ~0.07 coverage either way, but only GATES
  // (produces a finding) for short atomic labels; ordinary prose survives it.
  it("reports ~0.07 coverage for a 2-of-27 grid hit and flags an atomic label at that coverage", () => {
    const issues = auditCoverageScene({ text: "SUBSCRIBE", hitCount: 2 });
    const occluded = issues.find((issue) => issue.code === "text_occluded");
    expect(occluded).toBeDefined();
    expect(occluded?.coveredFraction).toBe(0.07);
  });

  it("does not flag ordinary prose at the same ~0.07 coverage a label would flag at", () => {
    const issues = auditCoverageScene({
      text: "This paragraph is long enough to read as ordinary prose, not a label.",
      hitCount: 2,
    });
    expect(issues.some((issue) => issue.code === "text_occluded")).toBe(false);
  });

  it("flags prose once coverage clears the 0.15 floor", () => {
    // 5/27 ≈ 0.185, comfortably over the ~0.15 prose floor.
    const issues = auditCoverageScene({
      text: "This paragraph is long enough to read as ordinary prose, not a label.",
      hitCount: 5,
    });
    expect(issues.some((issue) => issue.code === "text_occluded")).toBe(true);
  });

  it("does not sample opaque content in the gap between multiline text fragments", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="headline">First line of prose<br />Second line of prose</div>
        <div id="overlay"></div>
      </div>
    `;
    const lineRects = [
      rect({ left: 200, top: 500, width: 600, height: 40 }),
      rect({ left: 200, top: 580, width: 600, height: 40 }),
    ];
    installOcclusionGeometry({
      styleOverrides: { overlay: { backgroundColor: "rgb(10, 10, 10)" } },
      headlineTextRect: lineRects,
      topmostId: "headline",
    });
    (
      document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }
    ).elementFromPoint = (_x, y) =>
      document.getElementById(y > 540 && y < 580 ? "overlay" : "headline");

    installAuditScript();
    expect(runAudit().some((issue) => issue.code === "text_occluded")).toBe(false);
  });

  it("does not flag visible text carrying pointer-events:none (probe restores hit-testing)", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="headline">Headline copy</div>
        <div id="overlay"></div>
      </div>
    `;
    installOcclusionGeometry({
      styleOverrides: {
        headline: { pointerEvents: "none" },
        overlay: { backgroundColor: "rgb(10, 10, 10)" },
      },
      headlineTextRect: rect({ left: 200, top: 500, width: 600, height: 80 }),
      topmostId: "overlay",
    });
    // Simulate real hit-testing: with hit-testing restored (inline auto), the topmost hit IS the text.
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => {
      const headline = document.getElementById("headline");
      return headline?.style.getPropertyValue("pointer-events") === "auto"
        ? headline
        : document.getElementById("overlay");
    };
    installAuditScript();
    expect(runAudit().some((issue) => issue.code === "text_occluded")).toBe(false);
  });

  it("audits only a container's direct text when a hidden descendant also has text", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="headline">Visible copy<span id="hidden-copy">Hidden copy</span></div>
        <div id="overlay"></div>
      </div>
    `;
    installOcclusionGeometry({
      styleOverrides: {
        "hidden-copy": { opacity: "0" },
        overlay: { backgroundColor: "rgb(10, 10, 10)" },
      },
      headlineTextRect: rect({ left: 200, top: 500, width: 600, height: 80 }),
      topmostId: "overlay",
    });
    installAuditScript();
    const issue = runAudit().find((candidate) => candidate.code === "text_occluded");
    expect(issue?.text).toBe("Visible copy");
  });

  it("does not expand a container's text audit to a positioned descendant", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="headline">Visible copy<span id="positioned-copy">Positioned copy</span></div>
        <div id="overlay"></div>
      </div>
    `;
    installOcclusionGeometry({
      styleOverrides: {
        "positioned-copy": { position: "absolute" },
        overlay: { backgroundColor: "rgb(10, 10, 10)" },
      },
      headlineTextRect: rect({ left: 200, top: 500, width: 600, height: 80 }),
      topmostId: "overlay",
    });
    installAuditScript();
    const issues = runAudit().filter((candidate) => candidate.code === "text_occluded");
    const headlineIssue = issues.find((candidate) => candidate.selector === "#headline");
    expect(headlineIssue?.text).toBe("Visible copy");
  });

  it("does not count a low-alpha gradient overlay (grid/scrim) as an opaque occluder", () => {
    const issues = auditOcclusionScene({
      overlayStyle: {
        backgroundImage:
          "repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.04) 0px, transparent 1px)",
      },
      topmostId: "overlay",
    });
    expect(issues.some((issue) => issue.code === "text_occluded")).toBe(false);
  });

  it("walks past a transparent layer sharing the text's 3D context to a deeper occluder", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="stage">
          <div id="headline">Headline copy</div>
          <div id="decor"></div>
        </div>
        <div id="panel"></div>
      </div>
    `;
    installOcclusionGeometry({
      styleOverrides: {
        stage: { transformStyle: "preserve-3d" },
        panel: { backgroundColor: "rgb(10, 10, 10)" },
      },
      headlineTextRect: rect({ left: 200, top: 500, width: 600, height: 80 }),
      topmostId: "decor",
    });
    (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () =>
      ["decor", "panel"].map((id) => document.getElementById(id) as Element);
    installAuditScript();
    expect(runAudit().some((issue) => issue.code === "text_occluded")).toBe(true);
  });

  it("composites stacked translucent gradient layers (two 0.5-alpha layers occlude)", () => {
    const occluded = auditOcclusionScene({
      overlayStyle: {
        backgroundImage:
          "linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5))",
      },
      topmostId: "overlay",
    }).find((issue) => issue.code === "text_occluded");
    expect(occluded).toBeDefined();
  });

  it("does not count a single 0.5-alpha gradient layer as an occluder", () => {
    const issues = auditOcclusionScene({
      overlayStyle: { backgroundImage: "linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5))" },
      topmostId: "overlay",
    });
    expect(issues.some((issue) => issue.code === "text_occluded")).toBe(false);
  });

  it("probes text whose ink sits just above the 0.05 opacity floor", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="headline">
          <span id="inner">Headline copy</span>
        </div>
        <div id="overlay"></div>
      </div>
    `;
    installOcclusionGeometry({
      styleOverrides: {
        inner: { opacity: "0.06" },
        overlay: { backgroundColor: "rgb(10, 10, 10)" },
      },
      headlineTextRect: rect({ left: 200, top: 500, width: 600, height: 80 }),
      topmostId: "overlay",
      textRectElementId: "inner",
    });
    installAuditScript();
    expect(runAudit().some((issue) => issue.code === "text_occluded")).toBe(true);
  });

  it("still counts an opaque gradient panel as an occluder", () => {
    const occluded = auditOcclusionScene({
      overlayStyle: { backgroundImage: "linear-gradient(rgb(10, 10, 10), rgb(40, 40, 40))" },
      topmostId: "overlay",
    }).find((issue) => issue.code === "text_occluded");
    expect(occluded).toBeDefined();
  });

  it("still flags text buried under an occluder that itself has pointer-events:none", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="headline">Headline copy</div>
        <div id="overlay"></div>
      </div>
    `;
    installOcclusionGeometry({
      styleOverrides: {
        overlay: { backgroundColor: "rgb(10, 10, 10)", pointerEvents: "none" },
      },
      headlineTextRect: rect({ left: 200, top: 500, width: 600, height: 80 }),
      topmostId: "overlay",
    });
    // Simulate hit-testing: the scrim is only hittable once the audit restores its pointer-events.
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => {
      const overlay = document.getElementById("overlay");
      return overlay?.style.getPropertyValue("pointer-events") === "auto"
        ? overlay
        : document.getElementById("headline");
    };
    installAuditScript();
    const occluded = runAudit().find((issue) => issue.code === "text_occluded");
    expect(occluded).toMatchObject({ selector: "#headline", containerSelector: "#overlay" });
  });

  it("does not probe text whose every text node is still at opacity 0 (whitespace-indented markup)", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
        <div id="headline">
          <span id="inner">Headline copy</span>
        </div>
        <div id="overlay"></div>
      </div>
    `;
    installOcclusionGeometry({
      styleOverrides: {
        inner: { opacity: "0" },
        overlay: { backgroundColor: "rgb(10, 10, 10)" },
      },
      headlineTextRect: rect({ left: 200, top: 500, width: 600, height: 80 }),
      topmostId: "overlay",
    });
    installAuditScript();
    expect(runAudit().some((issue) => issue.code === "text_occluded")).toBe(false);
  });
});

// Mirrors OCCLUSION_PROBE_Y_FRACTIONS / OCCLUSION_PROBE_X_FRACTIONS in
// layout-audit.browser.js, so a test can force an exact number of grid hits
// against the same probe coordinates the audit itself sweeps.
const OCCLUSION_PROBE_Y_FRACTIONS = [0.25, 0.5, 0.75];
const OCCLUSION_PROBE_X_FRACTIONS = [0.03, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.97];

function occlusionProbePoints(textRect: RectInput): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (const yFraction of OCCLUSION_PROBE_Y_FRACTIONS) {
    const y = textRect.top + textRect.height * yFraction;
    for (const xFraction of OCCLUSION_PROBE_X_FRACTIONS) {
      points.push({ x: textRect.left + textRect.width * xFraction, y });
    }
  }
  return points;
}

// Builds an occlusion scene where exactly `hitCount` of the 27 probe points
// are covered by an opaque overlay and the rest hit the headline itself
// (self-hit — not foreign, so not counted as occluded).
function auditCoverageScene(options: {
  text: string;
  hitCount: number;
}): ReturnType<typeof runAudit> {
  const textRect = { left: 200, top: 500, width: 600, height: 80 };
  document.body.innerHTML = `
    <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
      <div id="headline">${options.text}</div>
      <div id="overlay"></div>
    </div>
  `;
  installOcclusionGeometry({
    styleOverrides: { overlay: { backgroundColor: "rgb(10, 10, 10)" } },
    headlineTextRect: rect(textRect),
    topmostId: "headline",
  });
  const hitPoints = occlusionProbePoints(textRect).slice(0, options.hitCount);
  (
    document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }
  ).elementFromPoint = (x, y) => {
    const isHit = hitPoints.some(
      (point) => Math.abs(point.x - x) < 0.01 && Math.abs(point.y - y) < 0.01,
    );
    return document.getElementById(isHit ? "overlay" : "headline");
  };
  installAuditScript();
  return runAudit();
}

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

function auditImageOcclusionScene(
  alpha: number,
  options: { objectFit?: string; headlineTextRect?: DOMRect } = {},
): ReturnType<typeof runAudit> {
  document.body.innerHTML = `
    <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
      <div id="headline">Headline copy</div>
      <img id="overlay" src="paper.png" alt="" />
    </div>
  `;
  const overlay = document.getElementById("overlay") as HTMLImageElement;
  Object.defineProperties(overlay, {
    naturalWidth: { configurable: true, value: 100 },
    naturalHeight: { configurable: true, value: 100 },
  });
  const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext") as unknown as {
    mockReturnValue(value: CanvasRenderingContext2D): void;
  };
  getContextSpy.mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, alpha]) })),
  } as unknown as CanvasRenderingContext2D);
  installOcclusionGeometry({
    styleOverrides: { overlay: { objectFit: options.objectFit ?? "fill" } },
    headlineTextRect:
      options.headlineTextRect ?? rect({ left: 200, top: 500, width: 600, height: 80 }),
    topmostId: "overlay",
  });
  overlay.getBoundingClientRect = () => rect({ left: 0, top: 0, width: 1920, height: 1080 });
  installAuditScript();
  return runAudit();
}

function installOcclusionGeometry(options: {
  styleOverrides: Record<string, Partial<Record<string, string>>>;
  headlineTextRect: DOMRect | DOMRect[];
  topmostId: string;
  textRectElementId?: string;
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
        const selectedElement =
          selected?.nodeType === Node.TEXT_NODE
            ? (selected.parentElement as Element | null)
            : (selected as Element | null);
        return selectedElement?.id === (options.textRectElementId ?? "headline")
          ? (normalizeTextRects(options.headlineTextRect) as unknown as DOMRectList)
          : ([] as unknown as DOMRectList);
      },
      detach() {},
    } as unknown as Range;
  });

  (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
    document.getElementById(options.topmostId);
}

function installOffsetParents(map: Record<string, string>): void {
  for (const [childId, parentId] of Object.entries(map)) {
    const child = document.getElementById(childId);
    const parent = document.getElementById(parentId);
    if (child && parent) Object.defineProperty(child, "offsetParent", { value: parent });
  }
}

interface CtmTranslate {
  e: number;
  f: number;
}

// happy-dom has no SVG geometry APIs; endpoints come from the path's `d`, the CTM is a pure translate.
function installConnectorGeometry(translate: CtmTranslate): void {
  const matrix = { a: 1, b: 0, c: 0, d: 1, e: translate.e, f: translate.f };
  for (const svg of Array.from(document.querySelectorAll("svg"))) {
    Object.defineProperty(svg, "createSVGPoint", {
      value: () => ({
        x: 0,
        y: 0,
        matrixTransform(m: typeof matrix) {
          return { x: this.x * m.a + this.y * m.c + m.e, y: this.x * m.b + this.y * m.d + m.f };
        },
      }),
    });
    for (const path of Array.from(svg.querySelectorAll("path"))) {
      const numbers = (path.getAttribute("d")?.match(/-?\d*\.?\d+/g) || []).map(Number);
      const start = { x: numbers[0] ?? 0, y: numbers[1] ?? 0 };
      const end = { x: numbers[numbers.length - 2] ?? 0, y: numbers[numbers.length - 1] ?? 0 };
      Object.defineProperty(path, "getTotalLength", { value: () => 100 });
      Object.defineProperty(path, "getPointAtLength", {
        value: (length: number) => (length === 0 ? start : end),
      });
      Object.defineProperty(path, "getScreenCTM", { value: () => matrix });
    }
  }
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

interface AuditIssue {
  code: string;
  selector: string;
  text?: string;
  containerSelector?: string;
  overflow?: Record<string, number>;
  message?: string;
  fixHint?: string;
  coveredFraction?: number;
}

function runAudit(): AuditIssue[] {
  const audit = (
    window as unknown as {
      __hyperframesLayoutAudit: (options: { time: number; tolerance: number }) => AuditIssue[];
    }
  ).__hyperframesLayoutAudit;
  return audit({ time: 1, tolerance: 2 });
}

function selectedRangeElement(selected: Node | null): Element | null {
  return selected?.nodeType === Node.TEXT_NODE
    ? (selected.parentElement as Element | null)
    : (selected as Element | null);
}

function rangeTextRect(selected: Node | null, rects: Record<string, DOMRect>): DOMRect | undefined {
  const element = selectedRangeElement(selected);
  if (element?.id === "ignored") return rects.ignored;
  if (selected?.nodeType === Node.TEXT_NODE && element?.id)
    return rects[`${element.id}Text`] ?? rects.text;
  return rects.text;
}

function installGeometry(
  rects: Record<string, DOMRect>,
  styleOverrides: Record<string, Partial<CSSStyleDeclaration>> = {},
): void {
  // Style-fixture branching mirrors the audit's per-property reads; splitting
  // it would scatter one mock across helpers.
  // fallow-ignore-next-line complexity
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
      ...styleOverrides[el.id],
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
        const textRect = rangeTextRect(selected, rects);
        return textRect ? ([textRect] as unknown as DOMRectList) : ([] as unknown as DOMRectList);
      },
      detach() {},
    } as unknown as Range;
  });
}

interface GeometryCandidateResult {
  kind: "text" | "media";
  tag: string;
  text: string;
  selector: string;
  sourceFile: string;
  rect: Record<string, number>;
  elementRect: Record<string, number>;
  overflow?: Record<string, number>;
}

declare global {
  interface Window {
    __hyperframesGeometryCandidates?: (options: {
      text: boolean;
      media: boolean;
      tolerance: number;
    }) => GeometryCandidateResult[];
  }
}

function runGeometryCandidates(options: {
  text: boolean;
  media: boolean;
  tolerance: number;
}): GeometryCandidateResult[] {
  const collector = window.__hyperframesGeometryCandidates;
  if (!collector) throw new Error("Geometry collector was not installed");
  return collector(options);
}

function clearGeometryCollector(): void {
  delete window.__hyperframesGeometryCandidates;
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
