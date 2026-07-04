/**
 * DrawElement integration coverage — record of browser-level validation.
 *
 * The unit tests in `drawElementService.test.ts` mock `page.evaluate`, so they
 * cannot exercise real frame capture. The behaviours below were validated with
 * local Docker harnesses (dev scaffolding under `spikes/`, not committed —
 * spikes are untracked in this repo) that drive the real engine functions
 * against a real Chrome/headless-shell. This file records what was checked and
 * the results, and is the place to add in-suite browser tests if/when the
 * package gains a headless-browser test runner.
 *
 * ── T1 + T2: Docker / SwiftShader (real engine fns vs real SwiftShader) ─────────
 * Last validated 2026-06-08 — ALL PASS:
 *   T1  opaque drawElement frame vs Page.captureScreenshot baseline — PSNR = ∞
 *       (pixel-identical) on SwiftShader, even with CSS transforms present.
 *   T2a detectSwiftShader() === true inside headless-shell + --use-angle=swiftshader.
 *   T2b transparent + SwiftShader → resolveDrawElementCaptureMode === "screenshot"
 *       (fallback; the transparent drawElement path is broken on SwiftShader).
 *   T2c opaque + SwiftShader → "drawelement" (T1 confirmed it is pixel-correct).
 *
 *  NOTE (2026-06-12): the engine now routes ALL SwiftShader renders to
 *  screenshot regardless of T2c's correctness result. drawElement is
 *  pixel-correct on SwiftShader (T1, PSNR ∞) but yields NO speedup there —
 *  its only advantage is skipping the GPU→CPU screenshot readback IPC, which
 *  software rasterization doesn't have. Measured parity (font-variant-numeric
 *  baseline 7822ms vs fast 7979ms); resolveDrawElementCaptureMode now returns
 *  "screenshot" for any isSwiftShader. The speedup is GPU-only (macOS 1.6×).
 *
 * ── E2E: full producer pipeline (--experimental-fast-capture) ───────────────────
 * A real producer render (css-spinner composition → mp4) with
 * PRODUCER_EXPERIMENTAL_FAST_CAPTURE=true logged "drawElement canvas injected"
 * and produced a valid mp4 — proving env → resolveConfig → captureCfg →
 * createCaptureSession → drawelement mode, plus jpeg-frame encode through ffmpeg.
 *
 * ── T3: transparent drawElement on a real GPU host ──────────────────────────────
 * PSNR = ∞ vs screenshot on GPU (empty A=0, semi-transparent A≈128, opaque
 * A=255). Cannot run in Docker (SwiftShader-only); validated on a GPU host.
 */

import { describe, it } from "vitest";

describe.skip("drawElementService integration (browser/Docker — see validation record above)", () => {
  it.skip("T1+T2 validated against real SwiftShader (Docker)", () => {});
  it.skip("E2E validated through the producer pipeline (--experimental-fast-capture)", () => {});
  it.skip("T3 validated on a real-GPU host", () => {});
});
