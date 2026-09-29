import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { classifyIcon, classifyRasterIcon, classifySvgIcon } from "./iconClassifier.js";

/**
 * openai.com's `/favicon.svg`, trimmed to the structure that decides the verdict: a full-bleed
 * rounded rect, then the mark knocked out of it. Both fills are CSS custom properties behind a
 * `prefers-color-scheme` query, which is why this is classified from markup — librvsg resolves
 * neither and rasterises the whole file to transparent.
 */
const OPENAI_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" fill="none">
  <style>:root { --primary-fill: #fff; --secondary-fill: #000; }</style>
  <g clip-path="url(#a)">
    <rect width="180" height="180" fill="var(--primary-fill)" rx="90" />
    <g clip-path="url(#b)"><path fill="var(--secondary-fill)" d="M75.91 73.6V62.2l22.9-13.2Z" /></g>
  </g>
  <defs><clipPath id="a"><path d="M0 0h180v180H0z" /></clipPath></defs>
</svg>`;

const BARE_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">
  <path fill="#000" d="M40 40h100v100H40z" />
</svg>`;

/** A square canvas that is uniformly transparent or uniformly opaque. */
function solidPng(alpha: number): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 20, g: 20, b: 20, alpha } },
  })
    .png()
    .toBuffer();
}

/** An opaque disc that touches all four edges on an otherwise transparent canvas. */
function discPng(): Promise<Buffer> {
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="32" fill="#000"/></svg>`,
  );
  return sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: mask }])
    .png()
    .toBuffer();
}

describe("classifySvgIcon", () => {
  it("calls a mark knocked out of a full-bleed rounded rect a badge", () => {
    const verdict = classifySvgIcon(OPENAI_FAVICON_SVG);
    expect(verdict.shape).toBe("badge");
    expect(verdict.reason).toContain("full-bleed");
  });

  it("calls a single shape with margins a bare mark", () => {
    expect(classifySvgIcon(BARE_MARK_SVG).shape).toBe("bare-mark");
  });

  it("does not mistake a clipPath's own rect for the backdrop", () => {
    // The `<defs>` in the openai file contains a full-bleed `<path>`; reading elements in
    // document order without skipping non-painting containers would judge that one.
    const clipOnly = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">
      <defs><clipPath id="a"><rect width="180" height="180" /></clipPath></defs>
      <path fill="#000" d="M40 40h100v100H40z" />
    </svg>`;
    expect(classifySvgIcon(clipOnly).shape).toBe("bare-mark");
  });

  it("treats a full-bleed circle as a badge", () => {
    const disc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill="#000" /><path d="M30 30h40v40H30z" fill="#fff" />
    </svg>`;
    expect(classifySvgIcon(disc).shape).toBe("badge");
  });

  it("reports unknown rather than guessing when there is nothing to measure against", () => {
    const noCanvas = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0z" /></svg>`;
    expect(classifySvgIcon(noCanvas).shape).toBe("unknown");
  });
});

describe("classifyRasterIcon", () => {
  it("calls an opaque square a badge", async () => {
    expect((await classifyRasterIcon(await solidPng(1))).shape).toBe("badge");
  });

  it("calls a transparent canvas a bare mark", async () => {
    expect((await classifyRasterIcon(await solidPng(0))).shape).toBe("bare-mark");
  });

  it("calls a full-bleed disc a badge, which sampling only the corners would miss", async () => {
    // All four corners of an inscribed disc are transparent. The edge midpoints are not.
    expect((await classifyRasterIcon(await discPng())).shape).toBe("badge");
  });

  it("reports unknown for a format it cannot decode rather than throwing", async () => {
    // .ico is the real case: libvips ships no decoder for it.
    const verdict = await classifyRasterIcon(Buffer.from("not an image"));
    expect(verdict.shape).toBe("unknown");
    expect(verdict.reason).toContain("could not be decoded");
  });
});

describe("classifyIcon", () => {
  it("routes .svg to markup inspection and everything else to pixels", async () => {
    expect((await classifyIcon(Buffer.from(BARE_MARK_SVG), ".svg")).shape).toBe("bare-mark");
    expect((await classifyIcon(await solidPng(1), ".png")).shape).toBe("badge");
  });
});
