/** Render drift: the target's box in a frame the producer captures, found by its flat colour. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
// Source import, as scripts/preview-capture.ts does: bun runs the producer's TypeScript directly.
import {
  captureFrameToBuffer,
  closeCaptureSession,
  createCaptureSession,
  createFileServer,
  initializeSession,
} from "../../../../producer/src/index.js";
import { BACKGROUND, COMPOSITION, PLAYHEAD, TARGET } from "./grid.mjs";

const FPS = { num: 30, den: 1 };

/**
 * Sub-pixel box from anti-aliased coverage over the whole frame, decoded in a page of the bench's Chrome.
 * Coverage comes from luminance between the two fixture colours (JPEG keeps luminance at full resolution);
 * the shape's area moments give its centre and sides, so rotated and cropped rectangles measure the same way.
 */
function pixelBox(b64, bgY, fgY) {
  return (async () => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${b64}`;
    await img.decode();
    const [w, h] = [img.width, img.height];
    const g = new OffscreenCanvas(w, h).getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, w, h).data;
    let [a, sx, sy, sxx, syy, sxy] = [0, 0, 0, 0, 0, 0];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let k = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] - bgY) / (fgY - bgY);
        if (k < 0.02) continue;
        k = k > 0.98 ? 1 : k;
        const [px, py] = [x + 0.5, y + 0.5];
        a += k;
        sx += k * px;
        sy += k * py;
        sxx += k * px * px;
        syy += k * py * py;
        sxy += k * px * py;
      }
    if (a === 0) return null;
    const [mx, my] = [sx / a, sy / a];
    // Pixel coverage is the shape blurred by a 1 px box, which adds 1/12 px² of variance per axis.
    const cxx = sxx / a - mx * mx - 1 / 12;
    const cyy = syy / a - my * my - 1 / 12;
    const cxy = sxy / a - mx * my;
    const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const spread = Math.hypot((cxx - cyy) / 2, cxy);
    const side1 = Math.sqrt(12 * ((cxx + cyy) / 2 + spread));
    const side2 = Math.sqrt(12 * Math.max(0, (cxx + cyy) / 2 - spread));
    const [c, s] = [Math.abs(Math.cos(theta)), Math.abs(Math.sin(theta))];
    const hx = (side1 * c + side2 * s) / 2;
    const hy = (side1 * s + side2 * c) / 2;
    return { left: mx - hx, right: mx + hx, top: my - hy, bottom: my + hy, area: a };
  })();
}

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

/** Renders `dir` at the playhead and measures the target's box in the frame. */
export async function renderBox(dir, decoder) {
  const framesDir = join(dir, ".bench-frames");
  mkdirSync(framesDir, { recursive: true });
  const server = await createFileServer({ projectDir: dir, port: 0, fps: FPS });
  let session;
  try {
    session = await createCaptureSession(
      server.url,
      framesDir,
      {
        width: COMPOSITION.width,
        height: COMPOSITION.height,
        fps: FPS,
        format: "jpeg",
        quality: 100,
      },
      null,
      // A composition with no GSAP never registers a timeline; the default 45 s wait for one changes no pixel.
      { playerReadyTimeout: 10_000 },
    );
    await initializeSession(session);
    const { buffer } = await captureFrameToBuffer(session, 0, PLAYHEAD);
    // Diagnostic only: a DOM rect ignores clip-path, so it cannot score a crop.
    const domRect = await session.page.evaluate(() => {
      const r = document.querySelector("#target")?.getBoundingClientRect();
      return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
    });
    const box = await decoder.evaluate(
      pixelBox,
      buffer.toString("base64"),
      luminance(BACKGROUND),
      luminance(TARGET.color),
    );
    if (!box) throw new Error("target colour not found in the producer frame");
    return { box, domRect, jpeg: buffer };
  } finally {
    server.close();
    if (session) await closeCaptureSession(session).catch(() => undefined);
  }
}
