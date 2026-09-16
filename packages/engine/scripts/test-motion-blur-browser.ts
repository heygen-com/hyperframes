// fallow-ignore-file unused-file
/** Browser regression for #4010. Run with bun from the repository root. */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileServer } from "../src/services/fileServer.js";
import {
  createCaptureSession,
  initializeSession,
  captureFrameToBuffer,
  closeCaptureSession,
} from "../src/services/frameCapture.js";

const dir = mkdtempSync(join(tmpdir(), "hf-motion-blur-"));
writeFileSync(
  join(dir, "index.html"),
  `<!doctype html><html><head><style>
html,body{margin:0;background:transparent}#root{position:relative;width:192px;height:192px}
#shape{position:absolute;left:80px;top:48px;width:32px;height:96px;background:white;transform-origin:center}
</style></head><body><div id="root" data-composition-id="main" data-motion-blur-samples="8"><div id="shape"></div></div><script>
window.mode='rotation';window.calls=[];
window.__hf={duration:2,seek(t){window.calls.push(t);window.current=t;const s=document.getElementById('shape');
s.style.opacity='1';s.style.background='white';s.style.transform='none';s.style.width='32px';
if(window.mode==='rotation')s.style.transform='rotate('+((t-.5)*7200)+'deg)';
if(window.mode==='scale')s.style.transform='scale('+(1+(t-.5)*60)+')';
if(window.mode==='opacity')s.style.opacity=t<.5?'0':'1';
if(window.mode==='translation')s.style.transform='translateX('+((t-.5)*9600)+'px)';
if(window.mode==='fast'){s.style.width='16px';s.style.transform='translateX('+((t-.5)*30000)+'px)';}
}};window.__timelines={main:{duration:()=>2,getChildren:()=>[]}};
</script></body></html>`,
);
const server = await createFileServer({ projectDir: dir, stripEmbeddedRuntime: false });
const session = await createCaptureSession(
  server.url,
  dir,
  {
    width: 192,
    height: 192,
    fps: { num: 30, den: 1 },
    format: "png",
    compositionDurationSeconds: 2,
  },
  null,
  {
    forceScreenshot: true,
    staticFrameDedup: false,
    useDrawElement: true,
    chromePath: process.env.PRODUCER_HEADLESS_SHELL_PATH,
  },
);
try {
  await initializeSession(session);
  assert.equal(session.captureMode, "screenshot");
  assert.equal(session.staticFrames, undefined);
  async function capture(mode: string, enabled: boolean, sampleCount = 8) {
    await session.page.evaluate((value) => {
      Object.assign(window, { mode: value, calls: [] });
    }, mode);
    session.motionBlur = enabled
      ? { samples: sampleCount, shutterAngle: 180, shutterPhase: -90 }
      : undefined;
    const result = await captureFrameToBuffer(session, 15, 0.5);
    writeFileSync(join(dir, `${mode}-${enabled ? "blur" : "sharp"}.png`), result.buffer);
    const pixels = await session.page.evaluate(async (encoded) => {
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2D context");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    }, result.buffer.toString("base64"));
    return pixels;
  }
  for (const mode of ["rotation", "scale", "translation"]) {
    const sharp = await capture(mode, false);
    const blurred = await capture(mode, true);
    const smear = blurred.filter(
      (alpha, i) => i % 4 === 3 && alpha > 10 && alpha < 245 && sharp[i] === 0,
    ).length;
    assert.ok(
      smear > 40,
      `${mode}: expected partially covered pixels beyond the sharp silhouette, got ${smear}`,
    );
    const current = await session.page.evaluate(() => Reflect.get(window, "current"));
    assert.equal(current, 0.5, "capture must restore the nominal frame time");
  }
  assert.deepEqual(
    await capture("rest", true),
    await capture("rest", false),
    "stationary content must stay pixel-sharp",
  );
  const fast16 = await capture("fast", true, 16);
  const fast64 = await capture("fast", true, 64);
  const covered = (pixels: number[]) =>
    pixels.filter((value, i) => i % 4 === 3 && value > 0).length;
  assert.ok(
    covered(fast64) > covered(fast16) * 1.5,
    "more samples must resolve gaps at high velocity",
  );
  const opacity = await capture("opacity", true);
  assert.ok(
    Math.abs((opacity[(96 * 192 + 96) * 4 + 3] ?? 0) - 128) <= 1,
    "shutter should integrate half transparent/half opaque to 50% alpha",
  );
  assert.equal(
    opacity[(96 * 192 + 96) * 4],
    255,
    "transparent samples must not darken unassociated white RGB",
  );
  console.log(
    JSON.stringify({
      result: "passed",
      artifacts: dir,
      modes: ["rotation", "scale", "translation", "opacity"],
      samples: 8,
    }),
  );
} finally {
  await closeCaptureSession(session);
  server.close();
}
