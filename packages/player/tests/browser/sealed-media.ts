import assert from "node:assert/strict";

import { launchBrowser } from "../perf/runner.js";
import { startServer } from "../perf/server.js";

const server = startServer();
const browser = await launchBrowser();

type VideoState = { crossOrigin: string | null; readyState: number; error: number | null };

/** A sealed player playing the 10-video film from a host with or without CORS headers. */
async function play(cors: boolean) {
  const page = await browser.newPage();
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warn") warnings.push(message.text());
  });
  await page.goto(
    `${server.origin}/host.html?fixture=10-video-grid&sealed=1${cors ? "" : "&cors=0"}`,
    {
      waitUntil: "domcontentloaded",
    },
  );
  await page.waitForFunction(() => window.__playerReady || window.__playerError, {
    timeout: 60_000,
  });
  await page.evaluate(() =>
    (document.getElementById("player") as HTMLElement & { play: () => void }).play(),
  );
  const frame = page.frames().find((candidate) => candidate.url().includes("/10-video-grid/"));
  assert.ok(frame, "the film's frame must load");
  await frame.waitForFunction(
    () => [...document.querySelectorAll("video")].every((v) => v.readyState >= 2 || v.error),
    { timeout: 30_000 },
  );
  const videos: VideoState[] = await frame.evaluate(() =>
    [...document.querySelectorAll("video")].map((v) => ({
      crossOrigin: v.getAttribute("crossorigin"),
      readyState: v.readyState,
      error: v.error?.code ?? null,
    })),
  );
  const pixels = await frame.evaluate(() => {
    const video = document.querySelector("video")!;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    context.drawImage(video, 0, 0, 1, 1);
    try {
      context.getImageData(0, 0, 1, 1);
      return "readable";
    } catch {
      return "refused";
    }
  });
  await page.close();
  return { videos, pixels, warnings };
}

type CaseResult = { crossOrigin: string | null; playing: boolean; pixels: string };

/**
 * One sealed film, each case a video the test adds to it: the frame's own CORS decision per media element, read back
 * from the frame. A CORS host's file, the same file from a path with no CORS headers, a missing file.
 */
async function mediaCases() {
  const page = await browser.newPage();
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warn") warnings.push(message.text());
  });
  await page.goto(`${server.origin}/host.html?fixture=10-video-grid&sealed=1`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.__playerReady || window.__playerError, {
    timeout: 60_000,
  });
  const frame = page.frames().find((candidate) => candidate.url().includes("/10-video-grid/"));
  assert.ok(frame, "the film's frame must load");
  const add = (name: string, html: string, then = "") =>
    frame.evaluate(
      (caseName, markup, script) => {
        const holder = document.createElement("div");
        holder.innerHTML = markup.replace(
          "<video",
          `<video data-case="${caseName}" muted preload="auto"`,
        );
        const video = holder.querySelector("video")!;
        document.body.append(video);
        if (script) new Function("video", script)(video);
      },
      name,
      html,
      then,
    );
  const read = async (name: string) => {
    // A video that neither plays nor fails is read as it stands, so every case reports.
    await frame
      .waitForFunction(
        (caseName) => {
          const video = document.querySelector<HTMLVideoElement>(`[data-case="${caseName}"]`)!;
          return video.readyState >= 2 || video.error ? true : null;
        },
        { timeout: 15_000 },
        name,
      )
      .catch(() => undefined);
    return frame.evaluate((caseName): CaseResult => {
      const video = document.querySelector<HTMLVideoElement>(`[data-case="${caseName}"]`)!;
      let pixels = "none";
      if (video.readyState >= 2) {
        const context = document.createElement("canvas").getContext("2d")!;
        context.drawImage(video, 0, 0, 1, 1);
        try {
          context.getImageData(0, 0, 1, 1);
          pixels = "readable";
        } catch {
          pixels = "refused";
        }
      }
      return {
        crossOrigin: video.getAttribute("crossorigin"),
        playing: video.readyState >= 2,
        pixels,
      };
    }, name);
  };
  const base = "/fixtures/10-video-grid/sample.mp4";
  const plain = "/fixtures-no-cors/10-video-grid/sample.mp4";
  await add("refused", `<video src="${plain}"></video>`);
  const refused = await read("refused");
  await frame.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('[data-case="refused"]')!;
    return video.readyState >= 2;
  });
  await add("healthy", `<video src="${base}?case=healthy"></video>`);
  await add("sibling", `<video><source src="${base}?case=sibling"><source src="${plain}"></video>`);
  await add("explicit", `<video src="${base}?case=explicit"><source src="${plain}"></video>`);
  await add(
    "unsupported",
    `<video><source src="${plain}?case=unsupported" type="video/mp4"><source src="${base}" type="video/x-nope"></video>`,
  );
  await add("missing", `<video src="/fixtures/10-video-grid/missing.mp4"></video>`);
  await add(
    "leading",
    `<video><source src="${base}?case=skipped" type="video/x-nope"><source src="${base}?case=leading&no-store"></video>`,
  );
  await add(
    "second",
    `<video><source src="/fixtures/10-video-grid/missing.mp4?case=first"><source src="${base}?case=second"></video>`,
  );
  const results = {
    refused,
    healthy: await read("healthy"),
    sibling: await read("sibling"),
    explicit: await read("explicit"),
    unsupported: await read("unsupported"),
    missing: await read("missing"),
    leading: await read("leading"),
    second: await read("second"),
  };
  const asked = (marker: string) => server.requested.filter((url) => url.includes(marker)).length;
  const requests = { leading: asked("case=leading"), second: asked("case=second") };

  const authoredLater = (script: string, url: string) =>
    frame.evaluate(
      (body, target) =>
        new Promise<string | null>((resolve) => {
          const video = new Function("url", body)(target) as HTMLVideoElement;
          setTimeout(() => setTimeout(() => resolve(video.getAttribute("crossorigin"))));
        }),
      script,
      url,
    );
  await add("sametask", `<video src="${base}?case=sametask"></video>`);
  await read("sametask");
  const sameTask = await authoredLater(
    `const video = document.querySelector('[data-case="sametask"]');
     video.src = url;
     video.crossOrigin = "use-credentials";
     return video;`,
    plain,
  );

  // A URL that failed once and then served CORS, while a sibling played, is not remembered as refusing CORS.
  const flaky = "/fixtures-flaky/10-video-grid/sample.mp4?case=flaky";
  await add(
    "recovers",
    `<video><source src="${flaky}"><source src="${base}?case=recovers"></video>`,
  );
  const recovered = await read("recovers");
  await frame.evaluate((url) => {
    const video = document.querySelector<HTMLVideoElement>('[data-case="recovers"]')!;
    video.replaceChildren();
    video.src = url;
  }, `${plain}?case=recovers-plain`);
  const fellBack = await read("recovers");
  await add("fresh", `<video src="${flaky}"></video>`);
  const fresh = await read("fresh");
  for (const [name, value] of [
    ["credentials", "use-credentials"],
    ["same", "anonymous"],
  ]) {
    await add(name, `<video src="${base}?case=${name}"></video>`);
    await read(name);
    await frame.evaluate(
      (caseName, mode, url) => {
        const video = document.querySelector<HTMLVideoElement>(`[data-case="${caseName}"]`)!;
        video.setAttribute("crossorigin", mode);
        return new Promise<void>((resolve) =>
          setTimeout(() => {
            video.src = url;
            setTimeout(resolve);
          }),
        );
      },
      name,
      value,
      plain,
    );
  }
  const authored = await frame.evaluate(() =>
    ["credentials", "same"].map((caseName) =>
      document.querySelector(`[data-case="${caseName}"]`)!.getAttribute("crossorigin"),
    ),
  );
  await page.close();
  return {
    results,
    authored,
    warnings,
    requests,
    sameTask,
    recovery: { recovered, fellBack, fresh },
  };
}

try {
  const plain = await play(false);
  assert.equal(
    plain.videos.filter((v) => v.readyState >= 2 && v.error === null).length,
    10,
    `a sealed film on a host without CORS must still play all 10 videos: ${JSON.stringify(plain.videos)}`,
  );
  assert.ok(
    plain.videos.every((v) => v.crossOrigin === null),
    "a video whose CORS load failed plays without crossorigin",
  );
  const named = plain.warnings.filter((w) => w.includes("10-video-grid/sample.mp4"));
  assert.equal(named.length, 1, `the fallback is said once per source: ${JSON.stringify(named)}`);

  const shared = await play(true);
  assert.equal(
    shared.videos.filter((v) => v.crossOrigin === "anonymous" && v.readyState >= 2).length,
    10,
    `a sealed film on a CORS host keeps crossorigin: ${JSON.stringify(shared.videos)}`,
  );
  assert.equal(shared.pixels, "readable", "a CORS-loaded video's pixels can be read");
  assert.deepEqual(
    shared.warnings.filter((w) => w.includes("sample.mp4")),
    [],
  );
  console.log("[sealed-media] a host without CORS plays; a CORS host keeps pixel access");

  const { results, authored, warnings, requests, sameTask, recovery } = await mediaCases();
  const failures: string[] = [];
  const check = (claim: string, ok: boolean, seen: unknown) => {
    if (!ok) failures.push(`${claim}: ${JSON.stringify(seen)}`);
  };
  check(
    "a source that refused CORS plays without it",
    results.refused.crossOrigin === null,
    results.refused,
  );
  for (const name of ["healthy", "sibling", "explicit"] as const) {
    const { crossOrigin, pixels } = results[name];
    check(
      `${name} keeps CORS and readable pixels`,
      crossOrigin === "anonymous" && pixels === "readable",
      results[name],
    );
  }
  check(
    "a non-CORS source before one the browser cannot play is retried without CORS",
    results.unsupported.playing && results.unsupported.crossOrigin === null,
    results.unsupported,
  );
  check(
    "a source that fails with and without CORS ends without CORS and is named once",
    !results.missing.playing &&
      results.missing.crossOrigin === null &&
      warnings.filter((w) => w.includes("missing.mp4")).length === 1,
    { video: results.missing, warnings },
  );
  check(
    "a crossorigin the composition set is the composition's, also when it is the same value",
    authored[0] === "use-credentials" && authored[1] === "anonymous",
    authored,
  );
  const corsReadable = (result: { crossOrigin: string | null; pixels: string }) =>
    result.crossOrigin === "anonymous" && result.pixels === "readable";
  check(
    "a source the browser cannot play, before a CORS source, is skipped without a reload loop",
    corsReadable(results.leading) && requests.leading <= 2,
    { video: results.leading, requests: requests.leading },
  );
  check(
    "a failing first CORS source leaves the second to play with CORS, with no fallback",
    corsReadable(results.second) &&
      requests.second <= 2 &&
      !warnings.some((w) => w.includes("case=first")),
    { video: results.second, requests: requests.second },
  );
  check(
    "a crossorigin the composition sets in the same task as a new src is the composition's",
    sameTask === "use-credentials",
    sameTask,
  );
  check(
    "a URL that failed once and then loaded with CORS keeps CORS for a fresh video",
    corsReadable(recovery.recovered) &&
      recovery.fellBack.playing &&
      recovery.fellBack.crossOrigin === null &&
      corsReadable(recovery.fresh),
    recovery,
  );
  assert.deepEqual(failures, [], failures.join("\n"));
  console.log(
    "[sealed-media] each media element decides its own CORS, and an author's attribute wins",
  );
} finally {
  await browser.close();
  await server.stop();
}
