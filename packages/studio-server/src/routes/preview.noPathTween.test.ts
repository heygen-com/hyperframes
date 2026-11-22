import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_PATH_TWEEN_META } from "@hyperframes/core/gsap-cdn";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  injectStudioPreviewAugmentations,
  provesNoPathTween,
  withPreviewBase,
  withPreviewRuntime,
} from "./preview";

type ScriptFiles = NonNullable<Parameters<typeof provesNoPathTween>[3]>;

const GSAP_FILE = "/*! GSAP 3.12.5 */ window.gsap = { timeline: function () {} };";
const PLAIN_TWEEN = '<script>gsap.timeline({ paused: true }).to("#card", { x: 300 });</script>';
const LATE_PATH_TWEEN =
  'window.buildPathTween = function () { gsap.to("#card", { motionPath: { path: [{ x: 50, y: 0 }] } }); };';

function projectDir(files: Record<string, string>, links: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-no-path-tween-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content, "utf-8");
  }
  for (const [rel, target] of Object.entries(links)) symlinkSync(target, join(dir, rel));
  return dir;
}

/** The main preview page for `scripts` in the head, as the preview route builds it, and the project it reads. */
function page(
  scripts: string,
  files: Record<string, string> = {},
  links: Record<string, string> = {},
) {
  const index = `<!doctype html><html><head>${scripts}</head><body><div id="card"></div>${PLAIN_TWEEN}</body></html>`;
  const dir = projectDir({ "index.html": index, ...files }, links);
  return { html: withPreviewRuntime(withPreviewBase(index, "film"), "/api/runtime.js"), dir };
}

const pathFree = (
  scripts: string,
  files?: Record<string, string>,
  links?: Record<string, string>,
) => {
  const { html, dir } = page(scripts, files, links);
  return provesNoPathTween(html, dir);
};

describe("the preview builder's proof that no script can tween along a path", () => {
  // fails without the fix: no preview carried the mark, so every one loaded the plugin.
  it("holds for a page whose scripts are read and name no path: its own GSAP file and inline tweens", async () => {
    const own = '<script src="gsap.min.js"></script>';
    expect(await pathFree(own, { "gsap.min.js": GSAP_FILE })).toBe(true);
  });

  it("holds for a page that loads GSAP from its CDN", async () => {
    const cdn = '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>';
    expect(await pathFree(cdn)).toBe(true);
  });

  it("fails for a project script that builds a path tween, whatever its name", async () => {
    const authored = '<script src="authored/gsap.js"></script>';
    expect(await pathFree(authored, { "authored/gsap.js": LATE_PATH_TWEEN })).toBe(false);
  });

  it("fails for a script it cannot read: another host, a missing file, a module, a folder", async () => {
    expect(await pathFree('<script src="https://example.com/gsap.min.js"></script>')).toBe(false);
    expect(await pathFree('<script src="missing.js"></script>')).toBe(false);
    const module = '<script type="module" src="gsap.min.js"></script>';
    expect(await pathFree(module, { "gsap.min.js": GSAP_FILE })).toBe(false);
    expect(await pathFree('<script src="assets"></script>', { "assets/a.txt": "a" })).toBe(false);
  });

  it("fails for a script that links out of the project", async () => {
    const outside = projectDir({ "gsap.min.js": GSAP_FILE });
    const own = '<script src="gsap.min.js"></script>';
    expect(await pathFree(own, {}, { "gsap.min.js": join(outside, "gsap.min.js") })).toBe(false);
  });

  // fails without the fix: each project script's path was resolved with a synchronous realpath on the server thread.
  it("resolves project scripts without a synchronous realpath", async () => {
    const { html, dir } = page('<script src="gsap.min.js"></script>', { "gsap.min.js": GSAP_FILE });
    const fs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");
    const native = fs.realpathSync.native;
    let syncCalls = 0;
    fs.realpathSync.native = ((...args: Parameters<typeof native>) => (
      syncCalls++, native(...args)
    )) as typeof native;
    onTestFinished(() => void (fs.realpathSync.native = native));
    expect(await provesNoPathTween(html, dir)).toBe(true);
    expect(syncCalls).toBe(0);
  });

  // fails without the fix: the scan resolved and read the disk on the route's event loop, with no limit on a silent
  // drive.
  it.each([
    [
      "resolving its path",
      { resolve: () => new Promise<never>(() => {}), read: async () => GSAP_FILE },
    ],
    [
      "reading it",
      {
        resolve: async (base: string, rel: string) => join(base, rel),
        read: () => new Promise<never>(() => {}),
      },
    ],
  ])("fails when %s does not answer within the budget", async (_, files) => {
    const { html, dir } = page('<script src="gsap.min.js"></script>', { "gsap.min.js": GSAP_FILE });
    expect(await provesNoPathTween(html, dir, performance.now() + 100, files)).toBe(false);
  });

  it("fails for a page whose own text names a path", async () => {
    expect(await pathFree('<script>gsap.to("#card", { "motionPath": {} });</script>')).toBe(false);
  });
});

describe("the script scan's bounds", () => {
  const tags = (srcs: string[]) => srcs.map((src) => `<script src="${src}"></script>`).join("");
  const counting = (read: ScriptFiles["read"]) => {
    const calls = { resolves: 0, reads: [] as string[] };
    const files: ScriptFiles = {
      resolve: async (base, rel) => (calls.resolves++, join(base, rel)),
      read: (file, signal) => (calls.reads.push(file), read(file, signal)),
    };
    return { calls, files };
  };
  // As `readFile` does with its signal.
  const untilAborted = (signal: AbortSignal) =>
    new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason)),
    );
  const scripts = (count: number) =>
    Object.fromEntries(Array.from({ length: count }, (_, i) => [`s${i}.js`, GSAP_FILE]));

  // fails without the fix: the scan resolved, stat'ed and read the one file once per tag.
  it("answers false for a page with more script tags than it scans, reading nothing", async () => {
    const { html, dir } = page(tags(Array(30_000).fill("gsap.min.js")), {
      "gsap.min.js": GSAP_FILE,
    });
    const { calls, files } = counting(async () => GSAP_FILE);
    const answer = await provesNoPathTween(html, dir, Number.POSITIVE_INFINITY, files);
    expect(calls.resolves).toBe(0);
    expect(calls.reads).toHaveLength(0);
    expect(answer).toBe(false);
  });

  // fails without the fix: each tag read its file again.
  it("reads each script file once, however many tags and spellings name it", async () => {
    const srcs = Array.from({ length: 40 }, (_, i) => ["a.js", "./a.js", "b.js", "c.js"][i % 4]!);
    const { html, dir } = page(tags(srcs), {
      "a.js": GSAP_FILE,
      "b.js": GSAP_FILE,
      "c.js": GSAP_FILE,
    });
    const { calls, files } = counting(async () => GSAP_FILE);
    expect(await provesNoPathTween(html, dir, Number.POSITIVE_INFINITY, files)).toBe(true);
    expect(calls.reads.map((file) => file.slice(dir.length + 1)).sort()).toEqual([
      "a.js",
      "b.js",
      "c.js",
    ]);
  });

  // fails without the fix: every tag's read started at once.
  it("has at most 8 reads in flight", async () => {
    const waiting: (() => void)[] = [];
    let inFlight = 0;
    let most = 0;
    const { calls, files } = counting(
      () =>
        new Promise<string>((resolve) => {
          most = Math.max(most, ++inFlight);
          waiting.push(() => (inFlight--, resolve(GSAP_FILE)));
        }),
    );
    const { html, dir } = page(tags(Object.keys(scripts(20))), scripts(20));
    let answer: boolean | undefined;
    void provesNoPathTween(html, dir, Number.POSITIVE_INFINITY, files).then((a) => (answer = a));
    while (answer === undefined) {
      waiting.shift()?.();
      await new Promise(setImmediate);
    }
    expect(answer).toBe(true);
    expect(calls.reads).toHaveLength(20);
    expect(most).toBeLessThanOrEqual(8);
  });

  // fails without the fix: a read went on after the scan gave up on it.
  it("aborts a read still in flight when the scan's time runs out", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const { files } = counting((_, signal) => {
      signals.push(signal);
      return untilAborted(signal);
    });
    const { html, dir } = page(tags(["gsap.min.js"]), { "gsap.min.js": GSAP_FILE });
    expect(await provesNoPathTween(html, dir, performance.now() + 100, files)).toBe(false);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  // fails without the fix: every script was read even after one named a path.
  it("starts no read after a script names a path, and aborts the ones in flight", async () => {
    const signals: AbortSignal[] = [];
    const { calls, files } = counting((file, signal) => {
      signals.push(signal);
      return file.endsWith("s0.js") ? Promise.resolve(LATE_PATH_TWEEN) : untilAborted(signal);
    });
    const { html, dir } = page(tags(Object.keys(scripts(20))), scripts(20));
    expect(await provesNoPathTween(html, dir, Number.POSITIVE_INFINITY, files)).toBe(false);
    expect(calls.reads.length).toBeLessThanOrEqual(8);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});

describe("the preview's path-free mark", () => {
  it("is set only when the builder proved the page path-free", () => {
    const { html, dir } = page("");
    const augmented = (proved: boolean) =>
      injectStudioPreviewAugmentations(html, "/api/runtime.js", "signature", dir, "index.html", {
        capture: false,
        gsapBaseUrl: "https://cdn.jsdelivr.net/npm",
        sandboxedCapture: false,
        pathFree: proved,
      });
    const mark = `<meta name="${NO_PATH_TWEEN_META}">`;
    expect(augmented(true)).toContain(mark);
    expect(augmented(false)).not.toContain(mark);
  });
});
