import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_PATH_TWEEN_META } from "@hyperframes/core/gsap-cdn";
import { describe, expect, it, onTestFinished } from "vitest";
import { injectStudioPreviewAugmentations, withPreviewBase, withPreviewRuntime } from "./preview";

const GSAP_FILE = "/*! GSAP 3.12.5 */ window.gsap = { timeline: function () {} };";
const PLAIN_TWEEN = '<script>gsap.timeline({ paused: true }).to("#card", { x: 300 });</script>';
const LATE_PATH_TWEEN =
  'window.buildPathTween = function () { gsap.to("#card", { motionPath: { path: [{ x: 50, y: 0 }] } }); };';

/** The main preview page for a project holding `files`, as the preview route assembles it. */
function servedPage(scripts: string, files: Record<string, string> = {}): string {
  const index = `<!doctype html><html><head>${scripts}</head><body><div id="card"></div>${PLAIN_TWEEN}</body></html>`;
  const dir = mkdtempSync(join(tmpdir(), "hf-no-path-tween-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries({ "index.html": index, ...files })) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content, "utf-8");
  }
  return injectStudioPreviewAugmentations(
    withPreviewRuntime(withPreviewBase(index, "film"), "/api/runtime.js"),
    "/api/runtime.js",
    "signature",
    dir,
    "index.html",
    { capture: false, gsapBaseUrl: "https://cdn.jsdelivr.net/npm", sandboxedCapture: false },
  );
}

const marked = (html: string) => html.includes(`<meta name="${NO_PATH_TWEEN_META}">`);

describe("the preview's mark that no script can tween along a path", () => {
  // fails without the fix: no preview carried the mark, so every one loaded the plugin.
  it("marks a page whose scripts are read and name no path: its own GSAP file and inline tweens", () => {
    expect(
      marked(servedPage('<script src="gsap.min.js"></script>', { "gsap.min.js": GSAP_FILE })),
    ).toBe(true);
  });

  it("marks a page that loads GSAP from its CDN", () => {
    const cdn = '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>';
    expect(marked(servedPage(cdn))).toBe(true);
  });

  it("leaves unmarked a project script that builds a path tween, whatever its name", () => {
    const authored = '<script src="authored/gsap.js"></script>';
    expect(marked(servedPage(authored, { "authored/gsap.js": LATE_PATH_TWEEN }))).toBe(false);
  });

  it("leaves unmarked a script it cannot read: another host, a missing file, a module", () => {
    expect(marked(servedPage('<script src="https://example.com/gsap.min.js"></script>'))).toBe(
      false,
    );
    expect(marked(servedPage('<script src="missing.js"></script>'))).toBe(false);
    const module = '<script type="module" src="gsap.min.js"></script>';
    expect(marked(servedPage(module, { "gsap.min.js": GSAP_FILE }))).toBe(false);
  });

  it("leaves unmarked a page whose own text names a path", () => {
    expect(marked(servedPage('<script>gsap.to("#card", { "motionPath": {} });</script>'))).toBe(
      false,
    );
  });
});
