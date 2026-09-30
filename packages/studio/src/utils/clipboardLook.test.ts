// @vitest-environment jsdom
import gsap from "gsap";
import { afterEach, describe, expect, it } from "vitest";
import { pasteTimelineClips } from "../hooks/useClipboard";

const GOODBYE =
  '<h2 id="goodbye" class="clip" data-start="1" data-duration="3" data-track-index="3">Goodbye</h2>';
const FILM = `<!doctype html>
<html>
  <head>
    <style>
      #goodbye {
        color: #f97316;
        font-size: 96px;
      }
      #title { font-size: 72px; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="10">
      <h1 id="title" class="clip" data-start="0" data-duration="10" data-track-index="0">Title</h1>
      ${GOODBYE}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.from("#goodbye", { opacity: 0, y: 40, duration: 0.5 }, 1);
      tl.to("#title", { opacity: 0.5, duration: 2 });
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;

const goodbye = { html: GOODBYE, start: 1, duration: 3, track: 3 };

/** Runs the film's own script with real GSAP and says when each tween starts, by its target's id. */
function tweenStarts(html: string): Array<[string, number]> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = doc.body.innerHTML;
  const win = window as unknown as { __timelines: Record<string, gsap.core.Timeline> };
  win.__timelines = {};
  new Function("gsap", doc.querySelector("script")?.textContent ?? "")(gsap);
  return win.__timelines
    .main!.getChildren()
    .map((tween) => [(tween.targets()[0] as Element).id, tween.startTime()] as [string, number])
    .sort(([a], [b]) => a.localeCompare(b));
}

/** The declarations the film's styles give the rules for `selector`. */
function rulesFor(html: string, selector: string): string[] {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(
    new DOMParser().parseFromString(html, "text/html").querySelector("style")!.textContent!,
  );
  return Array.from(sheet.cssRules)
    .filter(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule && rule.selectorText === selector,
    )
    .map((rule) => rule.style.cssText);
}

describe("a pasted clip takes its original's look and motion", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("copies the id's rules and tweens for the renamed copy, moved to where it lands", () => {
    const { content } = pasteTimelineClips(FILM, [goodbye], 4, [], true);

    expect(content).toContain('id="goodbye-2"');
    expect(rulesFor(content, "#goodbye-2")).toEqual(rulesFor(FILM, "#goodbye"));
    expect(tweenStarts(content)).toEqual([
      ["goodbye", 1],
      ["goodbye-2", 4],
      ["title", 1.5],
    ]);
    // The original's own motion is untouched: the copy's tween does not push the title's.
    expect(tweenStarts(FILM)).toEqual([
      ["goodbye", 1],
      ["title", 1.5],
    ]);
  });

  it("copies nothing for a clip from another file, whose id means something else here", () => {
    const { content } = pasteTimelineClips(FILM, [goodbye], 4, []);
    expect(rulesFor(content, "#goodbye-2")).toEqual([]);
    expect(tweenStarts(content).map(([id]) => id)).toEqual(["goodbye", "title"]);
  });
});
