// Studio's page in real Chrome around a preview frame: the Studio bundle, the frame's replies held or answered
// by the test, and the MotionPath plugin request held until released.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Browser, Frame, HTTPRequest, Page } from "puppeteer-core";
import { build } from "esbuild";
import { expect } from "vitest";
import { emptyNodeBuiltins } from "./chromeTestUtils";

const require = createRequire(import.meta.url);

export type Studio = typeof import("../src/utils/gsapSoftReload") & {
  previewRequest: typeof import("../src/player/lib/previewChannel").previewRequest;
  patchRuntimeTweenInPlace: typeof import("../src/hooks/gsapRuntimePatch").patchRuntimeTweenInPlace;
  applyPreviewSync: typeof import("../src/hooks/useGsapScriptCommits").applyPreviewSync;
  applyUndoRestoreToPreview: typeof import("../src/utils/gsapUndoRestore").applyUndoRestoreToPreview;
  moveLiveTweens: typeof import("../src/utils/gsapLiveRetime").moveLiveTweens;
  usePlayerStore: typeof import("../src/player/store/playerStore").usePlayerStore;
  markStudioWriteToken: typeof import("../src/utils/studioFileVersion").markStudioWriteToken;
  studioFileRevision: typeof import("../src/utils/studioFileVersion").studioFileRevision;
  previewLoadShows: typeof import("../src/utils/sealedPreviewLedger").previewLoadShows;
  watchPreviewFrame: typeof import("../src/player/lib/bridgePlayback").watchPreviewFrame;
};

/** Studio's preview code, bundled for the page as `window.hfStudio`; `extra` adds export lines. */
export async function buildStudioBundle(extra: string[] = []): Promise<string> {
  const out = await build({
    stdin: {
      contents: [
        `export * from "./utils/gsapSoftReload";`,
        `export { previewRequest } from "./player/lib/previewChannel";`,
        `export { patchRuntimeTweenInPlace } from "./hooks/gsapRuntimePatch";`,
        `export { applyPreviewSync } from "./hooks/useGsapScriptCommits";`,
        `export { applyUndoRestoreToPreview } from "./utils/gsapUndoRestore";`,
        `export { moveLiveTweens } from "./utils/gsapLiveRetime";`,
        `export { usePlayerStore } from "./player/store/playerStore";`,
        `export { markStudioWriteToken, studioFileRevision } from "./utils/studioFileVersion";`,
        `export { previewLoadShows } from "./utils/sealedPreviewLedger";`,
        `export { watchPreviewFrame } from "./player/lib/bridgePlayback";`,
        ...extra,
      ].join(" "),
      resolveDir: fileURLToPath(new URL("../src", import.meta.url)),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "hfStudio",
    alias: { canvas: fileURLToPath(new URL("../src/shims/canvasBrowserStub.js", import.meta.url)) },
    plugins: [emptyNodeBuiltins],
    define: { "import.meta.env": "{}" },
  });
  return out.outputFiles[0]!.text;
}

/** Studio's end of the editing port keeps the frame's replies while `__hold` is set, to deliver them later. */
function holdReplies() {
  const w = window as unknown as {
    __hold: boolean;
    __held: Array<(result?: unknown) => void>;
    __swallow: Set<string>;
    __swallowed: Array<{ kind: string; answer: (result: unknown) => void }>;
    __posted: number;
    __rejecting: boolean;
    __neverAnswer: boolean;
    __refusals: number;
  };
  w.__hold = false;
  w.__held = [];
  w.__swallow = new Set();
  w.__swallowed = [];
  w.__posted = 0;
  w.__rejecting = false;
  w.__neverAnswer = false;
  w.__refusals = 0;
  const own = Object.getOwnPropertyDescriptor(MessagePort.prototype, "onmessage")!;
  // A request of a swallowed kind never reaches the frame; the test answers it as the frame would.
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (
    this: MessagePort,
    data: unknown,
    ...rest: never[]
  ) {
    const request = data as { v?: unknown; id?: unknown; kind?: string } | null;
    if (typeof request?.id === "number") w.__posted++;
    if (typeof request?.id !== "number" || !w.__swallow.has(request.kind ?? ""))
      return post.call(this, data, ...rest);
    // Never answered: only its deadline settles it.
    if (w.__neverAnswer) return;
    const rejected = w.__rejecting;
    w.__swallowed.push({
      kind: request.kind!,
      // Arrives now, at the step that answers it, never back in the held queue. A rejection is the port's own
      // refusal of the request before the frame applied anything.
      answer: (result) => {
        const error = { code: "invalid-params", message: "rejected before applying" };
        const data = rejected
          ? { v: request.v, id: request.id, ok: false, error }
          : { v: request.v, id: request.id, ok: true, result };
        if (rejected && request.kind !== "patch-tweens") w.__refusals++;
        const hold = w.__hold;
        w.__hold = false;
        own.get!.call(this)?.call(this, new MessageEvent("message", { data }));
        w.__hold = hold;
      },
    });
  };
  Object.defineProperty(MessagePort.prototype, "onmessage", {
    configurable: true,
    get() {
      return own.get!.call(this);
    },
    set(handler: ((event: MessageEvent) => void) | null) {
      // Counts each refusal Studio receives that leaves it nothing to recover in place.
      const deliver = (data: { result?: { result?: unknown; applied?: unknown } }) => {
        const result = data?.result;
        if (result?.result === "cannot-soft-reload" || result?.applied === false) w.__refusals++;
        handler?.call(this, new MessageEvent("message", { data }));
      };
      own.set!.call(this, (event: MessageEvent) => {
        const reply = typeof event.data?.id === "number";
        if (!reply) return handler?.call(this, event);
        if (!w.__hold) return deliver(event.data);
        w.__held.push((result) =>
          deliver(result === undefined ? event.data : { ...event.data, result }),
        );
      });
    },
  });
}

/** Opens the preview in Studio's page; the plugin request waits until `release`; a `scripts` URL gets its script. */
export async function openPreview(
  browser: Browser,
  studioBundle: string,
  html: string,
  mode: string,
  scripts: Record<string, string> = {},
) {
  const page: Page = await browser.newPage();
  const plugin = readFileSync(require.resolve("gsap/dist/MotionPathPlugin.min.js"), "utf8");
  const held: HTTPRequest[] = [];
  let holding = true;
  let markRequested!: () => void;
  // A fresh Chrome's first intercepted request took up to 0.7 s on a Windows runner: await this, never a short poll.
  const pluginRequested = new Promise<void>((resolve) => (markRequested = resolve));
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const script = scripts[request.url()];
    if (script !== undefined)
      return void request.respond({ status: 200, contentType: "text/javascript", body: script });
    if (!/MotionPathPlugin/.test(request.url())) return void request.continue();
    markRequested();
    const serve = () =>
      request.respond({ status: 200, contentType: "text/javascript", body: plugin });
    if (holding) held.push(request);
    else void serve();
  });
  const release = async (status: 200 | 404) => {
    holding = false;
    for (const request of held.splice(0))
      await request.respond({
        status,
        contentType: "text/javascript",
        body: status === 200 ? plugin : "",
      });
  };
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.evaluate(holdReplies);
  await page.evaluate(studioBundle);
  await page.evaluate(
    (srcdoc, sealed) => {
      const iframe = document.createElement("iframe");
      if (sealed) iframe.setAttribute("sandbox", "allow-scripts");
      iframe.style.cssText = "width: 1920px; height: 1080px; border: 0";
      iframe.srcdoc = srcdoc;
      document.body.append(iframe);
      // As Studio's player does, before the frame loads: the frame's posted size reaches the mirror.
      (window as unknown as { hfStudio: Studio }).hfStudio.watchPreviewFrame(iframe);
    },
    html,
    mode === "sealed",
  );
  const frame: Frame = await (async () => {
    for (;;) {
      const found = page.frames().find((f) => f !== page.mainFrame());
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  })();
  await frame.waitForFunction(() => "__player" in window);
  const time = () =>
    frame.evaluate(() =>
      (window as unknown as { __player: { getTime(): number } }).__player.getTime(),
    );
  const seek = async (to: number) => {
    await page.evaluate((t) => {
      document
        .querySelector("iframe")!
        .contentWindow!.postMessage(
          { source: "hf-parent", type: "control", action: "seek", timeSeconds: t },
          "*",
        );
    }, to);
    await expect.poll(time).toBeCloseTo(to, 2);
  };
  return { page, frame, pluginRequested, release, seek, time };
}

export type Preview = Awaited<ReturnType<typeof openPreview>>;
