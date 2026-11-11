import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

async function capturePicture(host, name, output) {
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
      reference: Array.from({ length: 7 }, (_, i) => sample((406 + i * 32) / 640, 322 / 360)),
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
export async function observePicture(host, name, { output, retained = false }) {
  const { png, captureAttempts } = await capturePicture(host, name, output);
  const pixels = await samplePicture(host, png);
  const state = await pictureState(host);
  assert.equal(state.labels.length, 1, `${name}: expected exactly one scene label`);
  const bits = pixels.reference.map((rgb) => {
    assert(
      Math.max(...rgb) < 40 || Math.min(...rgb) > 210,
      `${name}: HTML clock strip is obscured`,
    );
    return Math.min(...rgb) > 210 ? 1 : 0;
  });
  assert.deepEqual(bits.slice(0, 2), [1, 0], `${name}: HTML clock strip guards are absent`);
  const scene = bits[2] ? "B" : "A";
  const shownSecond = bits.slice(3).reduce((value, bit, index) => value + bit * 2 ** index, 0);
  const capturedHtml = { scene, shownSecond, shownTime: shownSecond };
  assertBackground(name, scene, pixels.background);
  assert(pixels.foreground[1] > 150, `${name}: foreground green is missing: ${pixels.foreground}`);
  assert(
    pixels.foreground[0] < 80,
    `${name}: foreground contains background red: ${pixels.foreground}`,
  );
  if (!retained) assertMarker(name, scene, capturedHtml, pixels);
  return {
    name,
    ...state,
    capturedHtml,
    scene,
    pixels,
    markerValidated: !retained,
    captureAttempts,
  };
}
