import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hiddenCopy, instruction, layerVerdict, scoreLayerFrame } from "./layer.js";

const [W, H] = [200, 160];

/** A textured backdrop, with a white bar (a caption) of w x h centred at (cx, cy), letters every `pitch` px. */
function frame(
  bar?: { cx: number; cy: number; w: number; h: number; pitch?: number },
  tint = 0,
): Uint8Array {
  const px = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const on =
        bar &&
        Math.abs(x - bar.cx) < bar.w / 2 &&
        Math.abs(y - bar.cy) < bar.h / 2 &&
        // letter gaps, so the bar has shape a fit can lock on to
        (x - Math.round(bar.cx - bar.w / 2)) % (bar.pitch ?? 10) < 0.6 * (bar.pitch ?? 10);
      px.set(
        on ? [250, 250, 250] : [40 + ((x * 7) % 30) + tint, 50 + ((y * 5) % 20), 60],
        (y * W + x) * 3,
      );
    }
  return px;
}

const caption = { cx: 100, cy: 80, w: 80, h: 20 };

describe("scoreLayerFrame", () => {
  it("scores a layer drawn where the original has it near 1, in place", () => {
    const f = scoreLayerFrame(1, frame(caption), frame(caption), frame(), W, H);
    expect(f.benefit).toBe(1);
    expect(f.instruction).toBe("in place");
  });

  it("says how far to move a layer drawn too high, beyond a few pixels", () => {
    const f = scoreLayerFrame(1, frame({ ...caption, cy: 92 }), frame(caption), frame(), W, H);
    expect(f.fit?.offset).toEqual([0, 12]);
    expect(f.instruction).toBe("move down 12 px");
    expect(f.fit!.mae).toBeLessThan(1);
  });

  it("calls a size difference a resize, not a move", () => {
    const f = scoreLayerFrame(
      1,
      frame({ ...caption, w: 64, h: 16, pitch: 8 }),
      frame(caption),
      frame(),
      W,
      H,
    );
    expect(f.fit?.scale).toBeLessThan(1);
    expect(f.instruction).toMatch(/smaller/);
  });

  it("does not score a layer when leaving it out already matches the original", () => {
    const f = scoreLayerFrame(1, frame(caption), frame(caption), frame(caption), W, H);
    expect(f.footprint_px).toBe(0);
    const burned = frame(caption);
    const ours = frame({ ...caption, cy: 83 });
    const g = scoreLayerFrame(1, burned, ours, burned, W, H);
    expect(g.benefit).toBeNull();
    expect(g.note).toMatch(/already matches/);
    expect(layerVerdict(".cap", [g]).redundant).toEqual([1]);
  });

  it("marks a layer worse than leaving it out", () => {
    // our backdrop is a near match, as in a rebuild; the original has no caption here
    const f = scoreLayerFrame(1, frame(undefined, 30), frame(caption), frame(), W, H);
    expect(f.benefit).toBeLessThan(0);
    const v = layerVerdict(".cap", [
      f,
      scoreLayerFrame(2, frame(caption), frame(caption), frame(), W, H),
    ]);
    expect(v.worse).toEqual([1]);
    expect(v.benefit_median).toBeCloseTo((f.benefit! + 1) / 2, 3);
  });
});

describe("a layer over most of the frame", () => {
  it("scores a 200k-pixel footprint, and fits it, without running out of stack", () => {
    const [w, h] = [520, 400];
    const plain = (shift: number) => {
      const px = new Uint8Array(w * h * 3);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const card = ((x >> 4) + ((y + shift) >> 4)) % 2 ? 230 : 120;
          px.set([card, card, card], (y * w + x) * 3);
        }
      return px;
    };
    const f = scoreLayerFrame(1, plain(6), plain(0), new Uint8Array(w * h * 3), w, h);
    expect(f.footprint_px).toBeGreaterThan(200_000);
    expect(f.bbox).toEqual([0, 0, w, h]);
    expect(f.benefit).toBeGreaterThan(0);
    expect(f.fit?.offset).toEqual([0, -6]);
  });
});

describe("instruction", () => {
  it("names each axis and the size", () => {
    expect(instruction([-4, -10], 1.1)).toBe("move up 10 px, move left 4 px, make it 10% larger");
  });
});

describe("hiddenCopy", () => {
  it("copies the whole project, sub-folders included, and hides the selector in index.html only", () => {
    const src = mkdtempSync(join(tmpdir(), "layer-src-"));
    mkdirSync(join(src, "compositions"));
    mkdirSync(join(src, "renders"));
    writeFileSync(join(src, "index.html"), "<html><head></head><body></body></html>");
    writeFileSync(join(src, "compositions", "captions.html"), "<div class=cap></div>");
    writeFileSync(join(src, "renders", "big.mp4"), "x");
    const copy = hiddenCopy(src, ".cap");
    expect(readFileSync(join(copy, "index.html"), "utf8")).toContain(
      "<style>.cap{visibility:hidden!important}</style></head>",
    );
    expect(readFileSync(join(copy, "compositions", "captions.html"), "utf8")).toBe(
      "<div class=cap></div>",
    );
    expect(() => readFileSync(join(copy, "renders", "big.mp4"))).toThrow();
    expect(readFileSync(join(src, "index.html"), "utf8")).not.toContain("<style>");
  });
});
