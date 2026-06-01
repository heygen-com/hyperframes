import { describe, expect, it } from "vitest";

import {
  ASPECT_RATIO_MATCH_TOLERANCE,
  detectAspectRatioFromHtmlString,
} from "./detectAspectRatio.js";

const ROOT_DIV = (width: string | number, height: string | number, extra = "") =>
  `<div data-composition-id="root" data-width="${width}" data-height="${height}"${extra ? " " + extra : ""}></div>`;

describe("detectAspectRatioFromHtmlString — matches", () => {
  it("matches 16:9 on canonical 1920x1080", () => {
    const result = detectAspectRatioFromHtmlString(ROOT_DIV(1920, 1080));
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.aspectRatio).toBe("16:9");
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
    }
  });

  it("matches 9:16 on canonical 1080x1920", () => {
    const result = detectAspectRatioFromHtmlString(ROOT_DIV(1080, 1920));
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.aspectRatio).toBe("9:16");
    }
  });

  it("matches 1:1 on canonical 1080x1080", () => {
    const result = detectAspectRatioFromHtmlString(ROOT_DIV(1080, 1080));
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.aspectRatio).toBe("1:1");
    }
  });

  it("matches 16:9 on 1280x720 (smaller resolution, same ratio)", () => {
    const result = detectAspectRatioFromHtmlString(ROOT_DIV(1280, 720));
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") expect(result.aspectRatio).toBe("16:9");
  });

  it("matches 16:9 on 3840x2160 (4K)", () => {
    const result = detectAspectRatioFromHtmlString(ROOT_DIV(3840, 2160));
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") expect(result.aspectRatio).toBe("16:9");
  });

  it("matches within tolerance for 1916x1080 (16:9 with slight pixel slop)", () => {
    // 1916/1080 = 1.774 — within ±0.05 of 16/9 = 1.778
    const result = detectAspectRatioFromHtmlString(ROOT_DIV(1916, 1080));
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") expect(result.aspectRatio).toBe("16:9");
  });
});

describe("detectAspectRatioFromHtmlString — non-matches surface as warnings", () => {
  it("returns no-match for 4:5 portrait social (864x1080)", () => {
    const result = detectAspectRatioFromHtmlString(ROOT_DIV(864, 1080));
    expect(result.kind).toBe("no-match");
    if (result.kind === "no-match") {
      expect(result.width).toBe(864);
      expect(result.height).toBe(1080);
      expect(result.ratio).toBeCloseTo(0.8, 2);
    }
  });

  it("returns no-match for 5:4 (1350x1080) — outside 1:1 tolerance band", () => {
    const result = detectAspectRatioFromHtmlString(ROOT_DIV(1350, 1080));
    expect(result.kind).toBe("no-match");
    if (result.kind === "no-match") {
      expect(result.ratio).toBeCloseTo(1.25, 2);
    }
  });

  it("returns no-match for 3:2 ratio (1500x1000) — outside all three bands", () => {
    // 1500/1000 = 1.5. 16:9 = 1.778 (Δ ≈ 0.28), 1:1 = 1.0 (Δ = 0.5),
    // 9:16 = 0.5625 (Δ ≈ 0.94). All outside ±0.05. Common ratio for
    // older photo-style compositions; needs the no-match warning so
    // the user opts into a supported ratio explicitly.
    const result = detectAspectRatioFromHtmlString(ROOT_DIV(1500, 1000));
    expect(result.kind).toBe("no-match");
    if (result.kind === "no-match") {
      expect(result.ratio).toBeCloseTo(1.5, 2);
    }
  });

  it("returns no-match for 21:9 ultrawide (2560x1080)", () => {
    // 2560/1080 = 2.37. Outside ±0.05 of 16/9 = 1.778.
    const result = detectAspectRatioFromHtmlString(ROOT_DIV(2560, 1080));
    expect(result.kind).toBe("no-match");
  });

  it("4:5 is genuinely outside the 1:1 tolerance band — sanity-check the cutoff", () => {
    // 4:5 = 0.8; 1:1 = 1.0; difference = 0.2 — well outside 0.05 tolerance.
    // This pins the tolerance choice: if someone tightens or loosens it,
    // 4:5 must still NOT match 1:1, otherwise we silently mis-classify
    // portrait social as square.
    const ratio = 0.8;
    const diffFromOne = Math.abs(ratio - 1.0);
    expect(diffFromOne).toBeGreaterThan(ASPECT_RATIO_MATCH_TOLERANCE);
  });
});

describe("detectAspectRatioFromHtmlString — structural edge cases", () => {
  it("returns no-root-div when HTML has no composition root", () => {
    const html = "<html><body><h1>no composition here</h1></body></html>";
    expect(detectAspectRatioFromHtmlString(html).kind).toBe("no-root-div");
  });

  it("returns no-dims when root div is missing data-width", () => {
    const html = `<div data-composition-id="root" data-height="1080"></div>`;
    expect(detectAspectRatioFromHtmlString(html).kind).toBe("no-dims");
  });

  it("returns no-dims when root div is missing data-height", () => {
    const html = `<div data-composition-id="root" data-width="1920"></div>`;
    expect(detectAspectRatioFromHtmlString(html).kind).toBe("no-dims");
  });

  it("returns invalid-dims when width/height are zero", () => {
    const result = detectAspectRatioFromHtmlString(ROOT_DIV(0, 1080));
    expect(result.kind).toBe("invalid-dims");
    if (result.kind === "invalid-dims") expect(result.width).toBe(0);
  });

  it("returns no-dims when data-width includes a sign character", () => {
    // The attribute extractor only captures unsigned numbers — a negative
    // value (`-1920`) doesn't match the regex at all and the field reads
    // as "missing". That's the desired outcome; we don't want to surface
    // negative dims as a separate failure mode the user has to interpret.
    const result = detectAspectRatioFromHtmlString(ROOT_DIV(-1920, 1080));
    expect(result.kind).toBe("no-dims");
  });

  it("handles unquoted attribute values", () => {
    const html = `<div data-composition-id=root data-width=1920 data-height=1080></div>`;
    const result = detectAspectRatioFromHtmlString(html);
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") expect(result.aspectRatio).toBe("16:9");
  });

  it("handles single-quoted attribute values", () => {
    const html = `<div data-composition-id='root' data-width='1920' data-height='1080'></div>`;
    expect(detectAspectRatioFromHtmlString(html).kind).toBe("matched");
  });

  it("ignores attributes on the wrong tag", () => {
    // A non-composition div has the dims; the actual root has neither. The
    // extractor must NOT swap attributes across tags.
    const html = `
      <div class="header" data-width="100" data-height="100"></div>
      <div data-composition-id="root"></div>
    `;
    expect(detectAspectRatioFromHtmlString(html).kind).toBe("no-dims");
  });

  it("uses the FIRST composition root encountered (the page root)", () => {
    // Sub-compositions also have data-composition-id; the regex finds the
    // first match, which by HF convention is the page-level root.
    const html = `
      <div data-composition-id="root" data-width="1920" data-height="1080">
        <div data-composition-id="sub" data-width="1080" data-height="1080"></div>
      </div>
    `;
    const result = detectAspectRatioFromHtmlString(html);
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.aspectRatio).toBe("16:9");
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
    }
  });

  it("handles attributes in arbitrary order", () => {
    const html = `<div data-width="1080" id="root" data-height="1920" data-composition-id="root" class="bg"></div>`;
    const result = detectAspectRatioFromHtmlString(html);
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") expect(result.aspectRatio).toBe("9:16");
  });

  it("handles whitespace + newlines inside the opening tag", () => {
    const html = `<div
      data-composition-id="root"
      data-width="1080"
      data-height="1080"
    ></div>`;
    expect(detectAspectRatioFromHtmlString(html).kind).toBe("matched");
  });

  it("handles a self-closing-style tag (rare but valid in MDX/JSX-flavored input)", () => {
    const html = `<div data-composition-id="root" data-width="1920" data-height="1080"/>`;
    expect(detectAspectRatioFromHtmlString(html).kind).toBe("matched");
  });
});
