import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { launchStudioChrome } from "./chrome-executable.mjs";

const url = process.env.STUDIO_URL;
assert(url, "STUDIO_URL must point at the preview-video-regression fixture");
const project = process.env.STUDIO_PROJECT_DIR;
assert(project, "STUDIO_PROJECT_DIR must be the generated preview-video-regression project");
const output = process.env.OUT_DIR ?? "/tmp/preview-video-regression";
await mkdir(output, { recursive: true });
const { browser, executablePath } = await launchStudioChrome();
const evidence = {
  executablePath,
  browser: await browser.version(),
  gpuDisabled: true,
  pictures: [],
  timings: [],
};
const errors = [];
const unavailableCliEndpoints = [];
const runtimeLoads = [];
const runtimeHashes = new Set();

function optionalCliError(item) {
  const path = item.url ? new URL(item.url).pathname : "";
  return (
    item.message.includes("status of 404") &&
    ["/api/environment/ffmpeg", "/api/open-in-desktop"].includes(path)
  );
}
function recordConsole(message) {
  if (message.type() !== "error") return;
  const item = { message: message.text(), url: message.location().url };
  if (optionalCliError(item)) unavailableCliEndpoints.push(item);
  else errors.push(item);
}

async function open(beforeNavigate) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCacheEnabled(false);
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/runtime.js") {
      runtimeLoads.push(
        response.buffer().then((bytes) => {
          runtimeHashes.add(createHash("sha256").update(bytes).digest("hex"));
        }),
      );
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", recordConsole);
  if (beforeNavigate) await beforeNavigate(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[aria-label="Play"]:not([disabled])', { timeout: 60_000 });
  const handle = await page.waitForFunction(() =>
    document.querySelector("hyperframes-player")?.shadowRoot?.querySelector("iframe"),
  );
  const iframe = handle.asElement();
  assert(iframe, "Composition iframe is absent");
  const frame = await iframe.contentFrame();
  assert(frame, "Composition document is absent");
  await frame.waitForFunction(() => window.__playerReady, { timeout: 30_000 });
  assert(await frame.$("#film"), "Synthetic composition is absent");
  return { page, iframe, frame };
}

async function seek(host, time) {
  const start = performance.now();
  await host.frame.evaluate(async (time) => {
    await window.__player.seek(time, { settled: true });
  }, time);
  await host.frame
    .waitForFunction(
      (time) => {
        const label = document.querySelector(".clock");
        return Math.abs(Number(label.textContent) - time) < 0.002;
      },
      {},
      time,
    )
    .catch(async (error) => {
      const state = await host.frame.evaluate(() => ({
        time: window.__player.getTime(),
        labels: [...document.querySelectorAll(".clock")].map((el) => el.textContent),
        canvases: document.querySelectorAll("canvas").length,
        ready: window.__playerReady,
      }));
      await host.page.screenshot({ path: join(output, "seek-failed.png") });
      throw new Error(`Seek to ${time} did not publish: ${JSON.stringify(state)}`, {
        cause: error,
      });
    });
  evidence.timings.push({
    action: "seek",
    target: time,
    automationObservedMs: performance.now() - start,
  });
}

async function play(host) {
  await host.page.click('button[aria-label="Play"]');
  await host.frame.waitForFunction(() => window.__player.isPlaying(), { timeout: 15_000 });
}

async function pause(host) {
  await host.page.click('button[aria-label="Pause"]');
  await host.frame.waitForFunction(() => !window.__player.isPlaying());
}

async function capturePicture(host, name) {
  let png;
  let attempts = 0;
  const bounds = async () => {
    const outer = await host.iframe.boundingBox();
    const inner = await host.frame.evaluate(() => {
      const box = document.getElementById("film").getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      };
    });
    return {
      x: outer.x + (inner.x * outer.width) / inner.viewportWidth,
      y: outer.y + (inner.y * outer.height) / inner.viewportHeight,
      width: (inner.width * outer.width) / inner.viewportWidth,
      height: (inner.height * outer.height) / inner.viewportHeight,
    };
  };
  for (; attempts < 3; attempts++) {
    const before = await bounds();
    const full = await host.page.screenshot({ encoding: "base64", captureBeyondViewport: false });
    png = await host.page.evaluate(
      async ({ full, box }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${full}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(box.width);
        canvas.height = Math.round(box.height);
        canvas
          .getContext("2d")
          .drawImage(image, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { full, box: before },
    );
    const after = await bounds();
    if (Object.keys(before).every((key) => Math.abs(before[key] - after[key]) < 0.5)) break;
  }
  assert(attempts < 3, `${name}: composition kept re-fitting during capture`);
  await writeFile(join(output, `${name}.png`), Buffer.from(png, "base64"));
  return { png, captureAttempts: attempts + 1 };
}

async function samplePicture(host, png) {
  return host.page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const sample = (x, y) => {
      const data = context.getImageData(
        Math.round(image.width * x),
        Math.round(image.height * y),
        4,
        4,
      ).data;
      const sums = [0, 0, 0];
      for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sums[c] += data[i + c];
      return sums.map((sum) => Math.round(sum / 16));
    };
    return {
      background: sample(500 / 640, 200 / 360),
      foreground: sample(140 / 640, 160 / 360),
      markers: Array.from({ length: 6 }, (_, i) => sample((30 + i * 50) / 640, 307 / 360)),
    };
  }, png);
}

async function pictureState(host) {
  return host.frame.evaluate(() => {
    const visible = [...document.querySelectorAll(".label")].filter((el) => {
      const style = getComputedStyle(el);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        el.getBoundingClientRect().width > 0
      );
    });
    return {
      time: window.__player.getTime(),
      playing: window.__player.isPlaying(),
      shownTime: Number(document.querySelector(".clock").textContent),
      labels: visible.map((el) => el.textContent.trim()),
    };
  });
}

function assertBackground(name, scene, rgb) {
  const [red, green, blue] = rgb;
  const matches = scene === "A" ? [red > 160, green < 100, blue < 100] : [blue > 170, red < 100];
  assert(matches.every(Boolean), `${name}: background disagrees with ${scene}: ${rgb}`);
}
function assertMarker(name, scene, state, pixels) {
  const sourceSecond = Math.min(5, Math.floor(state.shownTime - (scene === "B" ? 6 : 0)));
  const visible = pixels.markers.flatMap((rgb, i) => (Math.min(...rgb) > 210 ? [i] : []));
  assert.deepEqual(visible, [sourceSecond], `${name}: video pixels disagree with the HTML clock`);
}
async function picture(host, name, retained = false) {
  const beforeTime = await host.frame.evaluate(() =>
    Number(document.querySelector(".clock").textContent),
  );
  const { png, captureAttempts } = await capturePicture(host, name);
  const pixels = await samplePicture(host, png);
  const state = await pictureState(host);
  assert.equal(state.labels.length, 1, `${name}: expected exactly one scene label`);
  const scene = state.labels[0].startsWith("A") ? "A" : "B";
  assertBackground(name, scene, pixels.background);
  assert(pixels.foreground[1] > 150, `${name}: foreground green is missing: ${pixels.foreground}`);
  assert(
    pixels.foreground[0] < 80,
    `${name}: foreground contains background red: ${pixels.foreground}`,
  );
  const markerValidated = !retained && Math.floor(beforeTime) === Math.floor(state.shownTime);
  if (markerValidated) assertMarker(name, scene, state, pixels);
  const result = { name, ...state, scene, pixels, markerValidated, captureAttempts };
  evidence.pictures.push(result);
  return result;
}

async function detail(host) {
  return host.frame.evaluate(() => {
    const video = document.getElementById("foreground");
    const canvas = video.previousElementSibling;
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const data = canvas.getContext("2d").getImageData(300, 20, 128, 1).data;
    let contrast = 0;
    for (let x = 1; x < 128; x++) contrast += Math.abs(data[x * 4] - data[(x - 1) * 4]);
    return {
      width: canvas.width,
      height: canvas.height,
      contrast: contrast / 127,
      firstPixel: data[0],
      mediaTime: video.currentTime,
    };
  });
}

async function collectGarbage(host) {
  const session = await host.page.createCDPSession();
  for (let i = 0; i < 2; i++) {
    await session.send("HeapProfiler.collectGarbage");
    await host.page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  }
  await session.detach();
}

async function withBlockedNative(test) {
  const assets = new Map(
    await Promise.all(
      ["background-a.mp4", "background-b.mp4"].map(async (name) => [
        name,
        await readFile(join(project, "assets", name)),
      ]),
    ),
  );
  const prefixed = new Set();
  const held = new Set();
  let blocked = false;
  const host = await open(async (page) => {
    await page.setRequestInterception(true);
    page.on("requestfailed", (request) => held.delete(request));
    const respondPrefix = (request, name, data) => {
      if (prefixed.has(name)) {
        held.add(request);
        return;
      }
      prefixed.add(name);
      const prefix = data.subarray(0, 16 * 1024);
      void request.respond({
        status: 206,
        contentType: "video/mp4",
        headers: {
          "Content-Range": `bytes 0-${prefix.length - 1}/${data.length}`,
          "Content-Length": String(prefix.length),
          "Accept-Ranges": "bytes",
        },
        body: prefix,
      });
    };
    page.on("request", (request) => {
      const name = new URL(request.url()).pathname.split("/").at(-1);
      const data = assets.get(name);
      if (request.resourceType() === "media" && data && blocked) respondPrefix(request, name, data);
      else void request.continue();
    });
  });
  const release = async () => {
    blocked = false;
    for (const request of [...held]) {
      held.delete(request);
      if (!request.failure() && !request.isInterceptResolutionHandled()) await request.continue();
    }
  };
  const arm = async () => {
    blocked = true;
    await host.frame.evaluate(() => {
      window.__previewTestSeeks = [];
      const video = document.getElementById("background-b");
      let proto = Object.getPrototypeOf(video);
      while (!Object.hasOwn(proto, "currentTime")) proto = Object.getPrototypeOf(proto);
      const descriptor = Object.getOwnPropertyDescriptor(proto, "currentTime");
      Object.defineProperty(proto, "currentTime", {
        ...descriptor,
        set(time) {
          window.__previewTestSeeks.push({ id: this.id, time });
          descriptor.set.call(this, time);
        },
      });
      video.load();
    });
    const heldAt = performance.now();
    while (held.size === 0 && performance.now() - heldAt < 5000) {
      await host.page.evaluate(() => new Promise(requestAnimationFrame));
    }
    assert(held.size > 0, "Native delivery was not actually held");
  };
  try {
    await test({ host, arm, release });
  } finally {
    await release();
    await host.page.close();
  }
}
async function nativeOnlyHandoff() {
  await withBlockedNative(async ({ host, arm, release }) => {
    await host.frame.evaluate(() => window.__hf.setPausedVideoFrameProvider(null));
    await seek(host, 2);
    await host.frame.waitForFunction(
      () => !document.querySelector("[data-hf-preview-video-canvas]"),
    );
    await picture(host, "native-only-paused");
    await arm();
    await host.frame.evaluate(() => {
      void window.__player.seek(7, { settled: true });
    });
    await host.page.click('button[aria-label="Play"]');
    const retained = await picture(host, "native-only-handoff", true);
    assert.equal(
      retained.scene,
      "A",
      "Native-only Play published before the destination was ready",
    );
    assert.equal(retained.playing, false);
    assert.equal(
      await host.frame.evaluate(() => document.querySelectorAll("[data-hf-seek-video]").length),
      2,
    );
    await release();
    await host.frame.waitForFunction(() => window.__player.isPlaying());
    await host.frame.waitForFunction(() => window.__player.getTime() > 7.1);
    const next = await picture(host, "native-only-recovered");
    assert.equal(next.scene, "B");
    assert.equal(
      await host.frame.evaluate(() => document.querySelectorAll("[data-hf-seek-video]").length),
      0,
    );
    evidence.nativeOnlyHandoff = { retained, recovered: next };
    await collectGarbage(host);
  });
}
async function delayedNativeRecovery() {
  await withBlockedNative(async ({ host, arm, release }) => {
    await seek(host, 7);
    await picture(host, "delayed-paused");
    await arm();
    const start = performance.now();
    await play(host);
    const handoffMs = performance.now() - start;
    assert(handoffMs >= 9000 && handoffMs < 14_000, `Play deadline not exercised: ${handoffMs}ms`);
    const stalled = await host.frame.evaluate(() => {
      const video = document.getElementById("background-b");
      return {
        readyState: video.readyState,
        seeking: video.seeking,
        cover: video.previousElementSibling?.hasAttribute("data-hf-preview-video-canvas"),
      };
    });
    assert(
      stalled.readyState < 2 || stalled.seeking,
      "Native video was ready; the delay probe is invalid",
    );
    assert(stalled.cover, "Full-quality cover disappeared at the deadline");
    await picture(host, "delayed-deadline", true);
    await host.frame.waitForFunction(() => window.__player.getTime() > 8.5);
    evidence.beforeNativeRelease = await host.frame.evaluate(() => {
      const video = document.getElementById("background-b");
      const state = {
        time: window.__player.getTime(),
        native: video.currentTime,
        readyState: video.readyState,
        seeking: video.seeking,
        seeks: [...window.__previewTestSeeks],
      };
      window.__previewTestSeeks.length = 0;
      return state;
    });
    const deliveredAt = performance.now();
    await release();
    await host.frame.waitForFunction(
      () => !document.querySelector("[data-hf-preview-video-canvas]"),
      { timeout: 5000 },
    );
    const recovery = await host.frame.evaluate(() => ({
      time: window.__player.getTime(),
      native: document.getElementById("background-b").currentTime,
      seeks: window.__previewTestSeeks.filter((seek) => seek.id === "background-b"),
    }));
    assert.equal(
      recovery.seeks.length,
      1,
      `Recovery must correct once, not chase the clock: ${JSON.stringify(recovery)}`,
    );
    assert(
      Math.abs(recovery.native - (recovery.time - 6)) < 0.3,
      `Recovered video remained behind: ${JSON.stringify(recovery)}`,
    );
    const recoveredPicture = await picture(host, "delayed-recovered");
    assert(
      recoveredPicture.markerValidated,
      "Recovery picture was not checked against its burnt-in time marker",
    );
    evidence.delayedNative = {
      handoffMs,
      stalled,
      recoveredAfterDeliveryMs: performance.now() - deliveredAt,
      ...recovery,
    };
    await collectGarbage(host);
  });
}

try {
  const host = await open();
  await seek(host, 2);
  await picture(host, "paused-a");
  const before = await detail(host);
  assert(before, "Paused foreground has no decoded canvas");
  assert.deepEqual([before.width, before.height], [640, 360]);
  assert(before.contrast > 180, `Source detail was blurred: ${before.contrast}`);
  await host.page.click("::-p-text(preview-video-regression)");
  await host.page.keyboard.press("ArrowRight");
  await host.frame.waitForFunction(
    () => Math.abs(Number(document.querySelector(".clock").textContent) - (2 + 1 / 30)) < 0.002,
  );
  await host.frame.waitForFunction(
    (previous) => {
      const canvas = document.getElementById("foreground").previousElementSibling;
      return (
        canvas instanceof HTMLCanvasElement &&
        Math.abs(canvas.getContext("2d").getImageData(300, 20, 1, 1).data[0] - previous) > 180
      );
    },
    {},
    before.firstPixel,
  );
  const after = await detail(host);
  assert.deepEqual([after.width, after.height], [640, 360]);
  assert(after.contrast > 180);
  evidence.frameStep = { before, after };

  const point = await host.frame.evaluate(() => {
    const video = document.getElementById("foreground").getBoundingClientRect();
    return { x: video.x + 140, y: video.y + 160, width: innerWidth, height: innerHeight };
  });
  const box = await host.iframe.boundingBox();
  assert(box);
  await host.page.mouse.click(
    box.x + (point.x * box.width) / point.width,
    box.y + (point.y * box.height) / point.height,
  );
  await host.page.waitForFunction(() => document.body.textContent.includes("#foreground"));
  evidence.picking = "foreground source video";

  const slider = await host.page.$('input[aria-label="Seek preview"]');
  const track = await slider.boundingBox();
  assert(track);
  await host.page.mouse.move(track.x + track.width * (2 / 12), track.y + track.height / 2);
  await host.page.mouse.down();
  for (const fraction of [0.2, 0.7, 0.3, 0.8]) {
    await host.page.mouse.move(track.x + track.width * fraction, track.y + track.height / 2, {
      steps: 5,
    });
    await picture(host, `drag-${fraction}`);
  }
  await host.page.mouse.up();
  await seek(host, 7);
  await picture(host, "paused-b");
  await seek(host, 5.5);
  await play(host);
  await host.frame.waitForFunction(() => window.__player.getTime() > 6.25);
  const cut = await picture(host, "native-cut");
  assert.equal(cut.scene, "B");
  await pause(host);

  for (const time of [1, 7, 3, 9]) {
    await seek(host, time);
    await picture(host, `jump-${time}`);
    await play(host);
    await host.frame.waitForFunction((time) => window.__player.getTime() > time + 0.1, {}, time);
    await picture(host, `play-${time}`);
    await pause(host);
  }
  await play(host);
  await pause(host);
  await play(host);
  await pause(host);
  assert.equal(await host.frame.evaluate(() => window.__player.isPlaying()), false);
  await play(host);
  await host.frame.waitForFunction(
    () => document.querySelectorAll("[data-hf-preview-video-canvas]").length === 0,
  );
  await collectGarbage(host);
  assert.deepEqual(errors, [], "Browser logged an error or unclosed VideoSample");
  await host.page.close();
  await delayedNativeRecovery();
  await nativeOnlyHandoff();
  assert.deepEqual(errors, [], "Delayed native recovery logged an error or unclosed VideoSample");
  await Promise.all(runtimeLoads);
  evidence.runtimeSha256 = [...runtimeHashes];
  assert.equal(runtimeHashes.size, 1, "All test documents must load the same runtime bytes");
  evidence.ok = true;
} catch (error) {
  evidence.ok = false;
  evidence.failure = error.stack;
  await (await browser.pages()).at(-1)?.screenshot({ path: join(output, "failed.png") });
  process.exitCode = 1;
} finally {
  evidence.errors = errors;
  evidence.unavailableCliEndpoints = unavailableCliEndpoints;
  await writeFile(join(output, "results.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  await browser.close();
}
