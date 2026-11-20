import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findStartTags } from "@hyperframes/core/compiler/html-document";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import {
  THUMBNAIL_NO_AUTHORED_CODE_META,
  thumbnailSeekReadyInBrowser,
} from "../helpers/screenshotClip";
import { buildSubCompositionHtml } from "../helpers/subComposition";
import { injectStudioPreviewAugmentations, withPreviewRuntime } from "./preview";

const STILL = '<div data-composition-id="card" data-duration="2"><h1 id="title">Hi</h1></div>';
const LATE = `${STILL}<script>setTimeout(function () {
  window.__timelines.card = gsap.timeline({ paused: true });
}, 400);</script>`;
const MOTION = JSON.stringify({
  version: 1,
  motions: [
    {
      kind: "gsap-motion",
      target: { sourceFile: "card.html", id: "title" },
      start: 0,
      duration: 1,
      ease: "none",
      from: { x: 0 },
      to: { x: 10 },
    },
  ],
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-thumbnail-mark-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content, "utf-8");
  }
  return dir;
}

/** The page a thumbnail loads for card.html, as the preview route assembles it. */
function servedPage(files: Record<string, string>, capture = true): string {
  const dir = project({
    "index.html": "<!doctype html><html><head></head><body></body></html>",
    ...files,
  });
  const built = buildSubCompositionHtml(dir, "card.html", "/api/runtime.js") ?? "";
  return injectStudioPreviewAugmentations(
    withPreviewRuntime(built, "/api/runtime.js"),
    "/api/runtime.js",
    "signature",
    dir,
    "card.html",
    { capture, gsapBaseUrl: "https://cdn.jsdelivr.net/npm", sandboxedCapture: false },
  );
}

/** Opens the served page far enough for the rule: its named metas, the runtime ready, no timeline registered. */
function readyWithoutTimeline(html: string): boolean {
  for (const start of findStartTags(html, "meta")) {
    const name = /\sname="([^"]*)"/.exec(html.slice(start, html.indexOf(">", start)))?.[1];
    if (name === undefined) continue;
    const meta = document.createElement("meta");
    meta.name = name;
    document.head.append(meta);
  }
  Reflect.set(window, "__renderReady", true);
  return thumbnailSeekReadyInBrowser();
}

afterEach(() => {
  document.head.replaceChildren();
  Reflect.deleteProperty(window, "__renderReady");
});

describe("a thumbnail's wait for a timeline", () => {
  it("is skipped for a composition with no code of its own", () => {
    expect(readyWithoutTimeline(servedPage({ "card.html": STILL }))).toBe(true);
  });

  it("holds for a composition whose script registers its timeline late", () => {
    expect(readyWithoutTimeline(servedPage({ "card.html": LATE }))).toBe(false);
  });

  it("holds for a still composition that Studio motion animates", () => {
    const files = { "card.html": STILL, ".hyperframes/studio-motion.json": MOTION };
    expect(readyWithoutTimeline(servedPage(files))).toBe(false);
  });

  it("marks only the page a thumbnail loads, not the preview a person sees", () => {
    expect(servedPage({ "card.html": STILL }, false)).not.toContain(
      THUMBNAIL_NO_AUTHORED_CODE_META,
    );
  });
});
