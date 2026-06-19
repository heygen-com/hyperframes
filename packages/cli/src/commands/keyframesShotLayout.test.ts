import { describe, expect, it } from "vitest";
import {
  buildOnionSvg,
  fitTransform,
  parseAngle,
  sampleTimes,
  stripCells,
  type OnionElement,
} from "./keyframesShotLayout.js";

describe("sampleTimes", () => {
  it("spreads N equal-time steps across the full duration", () => {
    expect(sampleTimes(4, 5, null, null)).toEqual([0, 1, 2, 3, 4]);
  });
  it("samples only the requested window", () => {
    expect(sampleTimes(4, 3, 2, 3)).toEqual([2, 2.5, 3]);
  });
  it("returns a single point at the window start when n=1", () => {
    expect(sampleTimes(4, 1, 1.5, 3)).toEqual([1.5]);
  });
  it("clamps the window to [0, dur]", () => {
    expect(sampleTimes(4, 2, -5, 99)).toEqual([0, 4]);
  });
});

describe("fitTransform", () => {
  it("centres on the bbox midpoint", () => {
    const { cx, cy } = fitTransform(
      [
        { x: 100, y: 200 },
        { x: 300, y: 400 },
      ],
      1000,
      1000,
    );
    expect(cx).toBe(200);
    expect(cy).toBe(300);
  });
  it("zooms a tiny cluster up (k > 1) but clamps the factor", () => {
    const { k } = fitTransform(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      1000,
      1000,
    );
    expect(k).toBeGreaterThan(1);
    expect(k).toBeLessThanOrEqual(7);
  });
  it("shrinks an oversized span (k < 1)", () => {
    const { k } = fitTransform(
      [
        { x: 0, y: 0 },
        { x: 5000, y: 0 },
      ],
      1000,
      1000,
    );
    expect(k).toBeLessThan(1);
    expect(k).toBeGreaterThanOrEqual(0.3);
  });
  it("is safe on empty input", () => {
    expect(fitTransform([], 800, 600)).toEqual({ k: 1, cx: 400, cy: 300 });
  });
});

describe("stripCells", () => {
  it("uses a single row for few samples", () => {
    expect(stripCells(3, 900, 900)).toMatchObject({ cols: 3, rows: 1 });
  });
  it("uses a roughly square grid for many samples", () => {
    expect(stripCells(9, 900, 900)).toMatchObject({ cols: 3, rows: 3 });
    expect(stripCells(13, 1080, 1080)).toMatchObject({ cols: 4, rows: 4 });
  });
});

describe("parseAngle", () => {
  it("resolves named presets", () => {
    expect(parseAngle("iso")).toEqual({ yaw: 30, pitch: -22 });
    expect(parseAngle("top")).toEqual({ yaw: 0, pitch: -68 });
  });
  it("parses yaw,pitch pairs", () => {
    expect(parseAngle("45,-30")).toEqual({ yaw: 45, pitch: -30 });
  });
  it("falls back to front on missing or garbage input", () => {
    expect(parseAngle()).toEqual({ yaw: 0, pitch: 0 });
    expect(parseAngle("nonsense")).toEqual({ yaw: 0, pitch: 0 });
  });
});

const sample = (t: number) => ({
  t,
  q: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
  c: { x: 5, y: 5 },
  color: "rgb(34, 211, 238)",
  opacity: 1,
});
const oneElement: OnionElement[] = [{ selector: "#hero", samples: [sample(0), sample(2)] }];

describe("buildOnionSvg", () => {
  it("path layout: one ghost per sample, a connecting path, and centre dots", () => {
    const svg = buildOnionSvg(oneElement, { layout: "path", fit: true, width: 1000, height: 1000 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect((svg.match(/<polygon/g) ?? []).length).toBe(2); // 2 ghosts
    expect((svg.match(/<line/g) ?? []).length).toBe(3); // 2 ticks + 1 path segment
    expect((svg.match(/<circle/g) ?? []).length).toBe(2); // 2 centre dots
  });
  it("strip layout: one framed cell per sample", () => {
    const svg = buildOnionSvg(oneElement, {
      layout: "strip",
      fit: true,
      width: 1000,
      height: 1000,
    });
    expect((svg.match(/<rect/g) ?? []).length).toBe(2); // 2 cells
    expect((svg.match(/<polygon/g) ?? []).length).toBe(2);
  });
  it("renders the caption label when provided", () => {
    const svg = buildOnionSvg(oneElement, {
      layout: "path",
      fit: true,
      width: 800,
      height: 800,
      label: "front · zoom-fit",
    });
    expect(svg).toContain("front");
  });
  it("is safe on empty input", () => {
    const svg = buildOnionSvg([], { layout: "path", fit: true, width: 800, height: 800 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/<polygon/g)).toBeNull();
  });
});
