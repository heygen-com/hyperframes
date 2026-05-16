/**
 * WebGPU Smoke Test
 *
 * Exercises the direct producer render API without LFS-backed golden videos.
 * The standard regression harness compares against binary baselines, but a
 * WebGPU proof should stay runnable even when git-lfs is unavailable locally.
 *
 * Assertions:
 *   1. A WebGPU composition rendered through createRenderJob/executeRenderJob
 *      auto-enables browser WebGPU capability when no explicit producerConfig
 *      is supplied.
 *   2. The screenshot compositor captures mixed DOM + WebGPU layers.
 *   3. GPU frame fences complete before PNG capture.
 *
 * Run from this package with:
 *   bun run test:webgpu
 */

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodePng } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "./services/renderOrchestrator.js";

const WIDTH = 320;
const HEIGHT = 180;
const FPS: import("@hyperframes/core").Fps = { num: 2, den: 1 };
const DURATION_SECONDS = 2;
const EXPECTED_FRAMES = FPS.num * DURATION_SECONDS;

function pixelOffset(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function assertDomProofPixel(png: { data: Uint8Array; width: number; height: number }): void {
  const off = pixelOffset(16, 16, png.width);
  const r = png.data[off + 0] ?? 0;
  const g = png.data[off + 1] ?? 0;
  const b = png.data[off + 2] ?? 0;
  const a = png.data[off + 3] ?? 0;
  assert.ok(
    r >= 220 && g <= 40 && b <= 40 && a === 255,
    `expected red DOM proof pixel at (16,16), got rgba(${r},${g},${b},${a})`,
  );
}

function assertGpuCenterPixel(png: { data: Uint8Array; width: number; height: number }): void {
  const off = pixelOffset(Math.floor(png.width / 2), Math.floor(png.height / 2), png.width);
  const r = png.data[off + 0] ?? 0;
  const g = png.data[off + 1] ?? 0;
  const b = png.data[off + 2] ?? 0;
  const a = png.data[off + 3] ?? 0;
  assert.ok(
    g >= 90 && a === 255 && r + g + b >= 140,
    `expected nonblank WebGPU center pixel, got rgba(${r},${g},${b},${a})`,
  );
}

function createFixture(projectDir: string): void {
  writeFileSync(
    join(projectDir, "index.html"),
    `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body {
      margin: 0;
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      overflow: hidden;
      background: #000;
    }
    #webgpu-smoke {
      position: relative;
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      overflow: hidden;
      background: #000;
    }
    #gpu {
      position: absolute;
      inset: 0;
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
    }
    #dom-proof {
      position: absolute;
      left: 8px;
      top: 8px;
      width: 24px;
      height: 24px;
      background: #ff0000;
    }
  </style>
</head>
<body>
  <div
    id="webgpu-smoke"
    data-composition-id="webgpu-smoke"
    data-start="0"
    data-duration="${DURATION_SECONDS}"
    data-width="${WIDTH}"
    data-height="${HEIGHT}"
  >
    <canvas id="gpu"></canvas>
    <div id="dom-proof"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["webgpu-smoke"] = {
      duration: function() { return ${DURATION_SECONDS}; },
      seek: function() {},
      pause: function() {}
    };

    const WGSL = \`
struct U { time: f32, _pad0: f32, _pad1: f32, _pad2: f32 }
@group(0) @binding(0) var<uniform> u: U;

struct Vo { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@vertex fn vs(@builtin(vertex_index) vi: u32) -> Vo {
  let ps = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let uv = array<vec2f, 3>(vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0));
  return Vo(vec4f(ps[vi], 0.0, 1.0), uv[vi]);
}

@fragment fn fs(in: Vo) -> @location(0) vec4f {
  let wave = 0.5 + 0.5 * sin((in.uv.x * 6.0) + u.time * 2.0);
  return vec4f(0.08 + 0.12 * wave, 0.62 + 0.18 * wave, 0.22 + 0.16 * wave, 1.0);
}\`;

    (async function() {
      if (!navigator.gpu) return;
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return;
      const device = await adapter.requestDevice();
      window.__hfWebGpu?.registerDevice(device);

      const canvas = document.getElementById("gpu");
      canvas.width = ${WIDTH};
      canvas.height = ${HEIGHT};
      const context = canvas.getContext("webgpu");
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: "opaque" });

      const uniformData = new Float32Array(4);
      const uniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const module = device.createShaderModule({ code: WGSL });
      const bindGroupLayout = device.createBindGroupLayout({
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        }],
      });
      const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      });

      function render(timeSeconds) {
        uniformData[0] = timeSeconds;
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            loadOp: "clear",
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            storeOp: "store",
          }],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
        window.__hfWebGpu?.registerFrame(device.queue.onSubmittedWorkDone());
      }

      render(window.__hfTypegpuTime ?? 0);
      window.addEventListener("hf-seek", (event) => render(event.detail.time));
    })();
  </script>
</body>
</html>`,
    "utf-8",
  );
}

async function main(): Promise<void> {
  const workRoot = mkdtempSync(join(tmpdir(), "hf-webgpu-smoke-"));
  const projectDir = join(workRoot, "project");
  const outputDir = join(workRoot, "frames");
  const keepWork = process.env.KEEP_TEMP === "1";
  mkdirSync(projectDir, { recursive: true });
  createFixture(projectDir);

  console.log(`work dir: ${workRoot}${keepWork ? " (KEEP_TEMP=1)" : ""}`);
  try {
    const job = createRenderJob({
      fps: FPS,
      quality: "draft",
      format: "png-sequence",
      workers: 1,
      hdrMode: "force-sdr",
    });

    await executeRenderJob(job, projectDir, outputDir);
    assert.equal(job.status, "complete", `render did not complete: status=${job.status}`);

    const frames = readdirSync(outputDir)
      .filter((name) => name.startsWith("frame_") && name.endsWith(".png"))
      .sort();
    assert.equal(
      frames.length,
      EXPECTED_FRAMES,
      `expected ${EXPECTED_FRAMES} PNG frames, got ${frames.length}: ${frames.join(",")}`,
    );
    const first = frames[0];
    const last = frames[frames.length - 1];
    assert.ok(first && last, "expected first and last frames");

    for (const frameName of [first, last]) {
      const decoded = decodePng(readFileSync(join(outputDir, frameName)));
      assert.equal(decoded.width, WIDTH, `${frameName}: width mismatch`);
      assert.equal(decoded.height, HEIGHT, `${frameName}: height mismatch`);
      assertGpuCenterPixel(decoded);
      assertDomProofPixel(decoded);
    }

    console.log(
      `WebGPU smoke PASS - ${frames.length} mixed DOM/WebGPU frames rendered via direct producer API.`,
    );
  } finally {
    if (!keepWork) {
      rmSync(workRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error("\nWebGPU smoke test FAILED:");
  console.error(error);
  process.exitCode = 1;
});
