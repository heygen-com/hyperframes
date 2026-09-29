/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import {
  generateHyperframesHtml,
  generateGsapTimelineScript,
  generateHyperframesStyles,
} from "./hyperframes.js";
import { parseHtml } from "@hyperframes/parsers";
import { GSAP_CDN } from "../templates/constants.js";
import type {
  TimelineTextElement,
  TimelineMediaElement,
  TimelineCompositionElement,
} from "../core.types";

function makeTextElement(overrides: Partial<TimelineTextElement> = {}): TimelineTextElement {
  return {
    id: "text-1",
    type: "text",
    name: "Title",
    content: "Hello World",
    startTime: 0,
    duration: 5,
    zIndex: 1,
    ...overrides,
  };
}

function makeVideoElement(overrides: Partial<TimelineMediaElement> = {}): TimelineMediaElement {
  return {
    id: "vid-1",
    type: "video",
    name: "Background",
    src: "video.mp4",
    startTime: 0,
    duration: 10,
    zIndex: 0,
    ...overrides,
  };
}

describe("generateHyperframesHtml", () => {
  it("contains mixed-case style closing tags in authored CSS", () => {
    const styles = '.label::after { content: "</StYlE><script>bad()</script>"; }';
    const doc = new DOMParser().parseFromString(
      generateHyperframesHtml([], 1, { styles, includeStyles: true }),
      "text/html",
    );
    expect(doc.querySelectorAll("style")).toHaveLength(2);
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("style[data-hf-custom]")?.textContent).toContain("StYlE");
  });

  it("contains script closing tags while retaining JS string values and raw expressions", () => {
    const targetSelector = '#x"</ScRiPt><script>bad()</script>';
    const position = 'label"; bad(); //';
    const doc = new DOMParser().parseFromString(
      generateHyperframesHtml([], 1, {
        includeScripts: true,
        animations: [
          { targetSelector, method: "to", position, properties: { x: "__raw:1 < 2 ? 3 : 4" } },
        ],
      }),
      "text/html",
    );
    expect(doc.querySelectorAll("script")).toHaveLength(2);
    const script = doc.querySelector("script:not([src])")?.textContent ?? "";
    const calls: unknown[][] = [];
    const gsap = { timeline: () => ({ to: (...args: unknown[]) => calls.push(args) }) };
    new Function("gsap", script)(gsap);
    expect(calls).toEqual([[targetSelector, { x: 3 }, position]]);
  });

  it("round-trips element attribute values without creating event handlers", () => {
    const marker = `x" onmouseover="bad()&quot;<`;
    const element = makeVideoElement({ id: marker, name: marker, src: marker });
    const doc = new DOMParser().parseFromString(generateHyperframesHtml([element], 1), "text/html");
    const video = doc.querySelector("video");
    for (const name of ["id", "data-hf-id", "data-name", "src"])
      expect(video?.getAttribute(name)).toBe(marker);
    expect(video?.hasAttribute("onmouseover")).toBe(false);
    expect(doc.querySelector("script")).toBeNull();
  });

  it("keeps special IDs targeted by generated visibility animations", () => {
    const element = makeTextElement({ id: '9 title"[x],#other', name: "Title" });
    const doc = new DOMParser().parseFromString(generateHyperframesHtml([element], 1), "text/html");
    const targets: string[] = [];
    const gsap = { timeline: () => ({ set: (selector: string) => targets.push(selector) }) };
    new Function("gsap", generateGsapTimelineScript([element], 1))(gsap);
    expect(targets.length).toBeGreaterThan(0);
    for (const selector of targets) expect(doc.querySelector(selector)?.id).toBe(element.id);
  });

  it("preserves supported rich text while removing executable markup", () => {
    const content =
      '<strong>A<span style="font-size: 32px; color: red" onclick="bad()">B</span></strong><br><sup>C</sup><script>bad()</script><svg onload="bad()"></svg><span style="background-color: url(evil)">D</span>';
    const html = generateHyperframesHtml([makeTextElement({ content })], 1);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("strong span")?.getAttribute("style")).toContain("font-size: 32px");
    expect(doc.querySelector("strong span")?.hasAttribute("onclick")).toBe(false);
    expect(doc.querySelector("br")).not.toBeNull();
    expect(doc.querySelector("script,svg,sup,[onclick]")).toBeNull();
    expect(doc.querySelector("#text-1")?.textContent).toBe("ABCD");
    expect(html).not.toContain("url(evil)");
    expect(parseHtml(html).elements[0]).toMatchObject({ content: "ABCD" });
  });

  it.each(["", "&amp;quot; &amp;#39; &amp;lt;"])(
    "preserves empty and entity-looking caption content: %s",
    (content) => {
      const html = generateHyperframesHtml([makeTextElement({ content })], 1);
      const doc = new DOMParser().parseFromString(html, "text/html");
      expect(doc.querySelector("#text-1")?.textContent).toBe(content ? "&quot; &#39; &lt;" : "");
      expect(parseHtml(html).elements[0]).toMatchObject({
        content: content ? "&quot; &#39; &lt;" : "",
      });
    },
  );

  it.each([
    "javascript:bad()",
    "java\nscript:bad()",
    "vbscript:bad()",
    "data:text/html,<script>bad()</script>",
  ])("rejects executable source URLs: %s", (src) => {
    expect(() => generateHyperframesHtml([makeVideoElement({ src })], 1)).toThrow(
      "Unsafe media or composition source URL",
    );
  });

  it("rejects JavaScript supplied through a numeric element field", () => {
    const element = { ...makeTextElement(), startTime: "0); bad(); //" };
    expect(() => Reflect.apply(generateGsapTimelineScript, undefined, [[element], 1])).toThrow(
      "finite generator numeric value",
    );
  });

  it("rejects declaration breakouts in generated color values", () => {
    expect(() =>
      generateHyperframesStyles(
        [makeTextElement({ color: "red; } body { color: blue" })],
        "landscape",
      ),
    ).toThrow("Invalid generated CSS value");
  });

  it("keeps composition identifiers inside their attribute and round-trips entities", () => {
    const compositionId = `x" autofocus onfocus="alert(1)'><script>bad()</script>&quot;&`;
    const doc = new DOMParser().parseFromString(
      generateHyperframesHtml([], 1, { compositionId }),
      "text/html",
    );
    expect(doc.documentElement.getAttribute("data-composition-id")).toBe(compositionId);
    expect(doc.documentElement.hasAttribute("autofocus")).toBe(false);
    expect(doc.documentElement.hasAttribute("onfocus")).toBe(false);
    expect(doc.querySelector("script")).toBeNull();
  });

  it("contains resolution values supplied by JavaScript callers inside their attribute", () => {
    const resolution = `x" autofocus onfocus="alert(1)'><script>bad()</script>&quot;&`;
    const html = Reflect.apply(generateHyperframesHtml, undefined, [
      [],
      1,
      { resolution, includeStyles: false, includeScripts: false },
    ]);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.documentElement.getAttribute("data-resolution")).toBe(resolution);
    expect(doc.documentElement.hasAttribute("autofocus")).toBe(false);
    expect(doc.documentElement.hasAttribute("onfocus")).toBe(false);
    expect(doc.querySelector("script")).toBeNull();
  });

  it("round-trips entity-bearing CSS through the JSON metadata attribute", () => {
    const styles = `.x::after { content: "&quot; &#39; &amp; < > '"; }`;
    const doc = new DOMParser().parseFromString(
      generateHyperframesHtml([], 1, { styles }),
      "text/html",
    );
    expect(JSON.parse(doc.documentElement.getAttribute("data-custom-styles")!)).toBe(styles);
    expect(doc.querySelector("style")).toBeNull();
    expect(parseHtml(generateHyperframesHtml([], 1, { styles })).styles).toBe(styles);
  });

  it("round-trips composition variable metadata through the public parser", () => {
    const variableValues = { label: `&quot; &#39; &amp; < > '`, count: 2, enabled: true };
    const element: TimelineCompositionElement = {
      id: "nested",
      type: "composition",
      name: "Nested",
      startTime: 0,
      duration: 1,
      zIndex: 0,
      src: "nested.html",
      compositionId: "nested-comp",
      variableValues,
    };
    const html = generateHyperframesHtml([element], 1);
    const parsed = parseHtml(html).elements[0];
    expect(parsed?.type).toBe("composition");
    if (parsed?.type !== "composition") throw new Error("Expected composition");
    expect(parsed.variableValues).toEqual(variableValues);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(JSON.parse(doc.getElementById("nested")!.getAttribute("data-variable-values")!)).toEqual(
      variableValues,
    );
  });

  it("generates valid HTML with proper data attributes", () => {
    const elements = [makeTextElement()];
    const html = generateHyperframesHtml(elements, 5);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("data-composition-id=");
    expect(html).toContain("data-composition-duration=");
    expect(html).toContain('id="stage"');
    expect(html).toContain('id="stage-zoom-container"');
  });

  it("includes element data attributes", () => {
    const elements = [makeTextElement({ id: "my-text", startTime: 2, duration: 3 })];
    const html = generateHyperframesHtml(elements, 5);

    expect(html).toContain('id="my-text"');
    expect(html).toContain('data-start="2"');
    expect(html).toContain('data-duration="3"');
    expect(html).toContain('data-track-index="1"');
    expect(html).not.toContain('data-end="');
    expect(html).not.toContain('data-layer="');
  });

  it("includes GSAP CDN script tag when includeScripts is true", () => {
    const elements = [makeTextElement()];
    const html = generateHyperframesHtml(elements, 5, { includeScripts: true });

    expect(html).toContain(`<script src="${GSAP_CDN}"></script>`);
  });

  it("does NOT include GSAP CDN by default", () => {
    const elements = [makeTextElement()];
    const html = generateHyperframesHtml(elements, 5);

    expect(html).not.toContain(GSAP_CDN);
  });

  it("includes timeline script when includeScripts is true", () => {
    const elements = [makeTextElement()];
    const html = generateHyperframesHtml(elements, 5, { includeScripts: true });

    expect(html).toContain("gsap.timeline({ paused: true })");
  });

  it("generates GSAP timeline with visibility animations when includeScripts is true", () => {
    const elements = [makeTextElement({ id: "el-1", startTime: 1, duration: 3 })];
    const html = generateHyperframesHtml(elements, 5, { includeScripts: true });

    // Default animations include visibility bookends
    expect(html).toContain('tl.set("#el-1"');
    expect(html).toContain('visibility: "hidden"');
    expect(html).toContain('visibility: "visible"');
  });

  it("sets resolution data attribute", () => {
    const elements = [makeTextElement()];

    const landscapeHtml = generateHyperframesHtml(elements, 5, { resolution: "landscape" });
    expect(landscapeHtml).toContain('data-resolution="landscape"');

    const portraitHtml = generateHyperframesHtml(elements, 5, { resolution: "portrait" });
    expect(portraitHtml).toContain('data-resolution="portrait"');
  });

  it("generates video elements with proper tags", () => {
    const elements = [makeVideoElement()];
    const html = generateHyperframesHtml(elements, 10);

    expect(html).toContain("<video");
    expect(html).toContain('src="video.mp4"');
    expect(html).toContain("playsinline");
  });

  it("generates text elements with content wrapper div", () => {
    const elements = [makeTextElement({ content: "My Content" })];
    const html = generateHyperframesHtml(elements, 5);

    expect(html).toContain("<div>My Content</div>");
  });

  it("includes custom compositionId", () => {
    const elements = [makeTextElement()];
    const html = generateHyperframesHtml(elements, 5, { compositionId: "test-comp-123" });

    expect(html).toContain('data-composition-id="test-comp-123"');
  });

  it("calculates total duration from elements if they exceed provided duration", () => {
    const elements = [makeTextElement({ startTime: 0, duration: 15 })];
    const html = generateHyperframesHtml(elements, 5);

    expect(html).toContain('data-composition-duration="15"');
  });

  it("includes style tags when includeStyles is true", () => {
    const elements = [makeTextElement()];
    const html = generateHyperframesHtml(elements, 5, { includeStyles: true });

    expect(html).toContain('<style data-hf-core="true">');
  });

  it("includes custom styles when provided", () => {
    const elements = [makeTextElement()];
    const html = generateHyperframesHtml(elements, 5, {
      styles: ".custom { color: red; }",
      includeStyles: true,
    });

    expect(html).toContain('<style data-hf-custom="true">');
    expect(html).toContain(".custom { color: red; }");
  });

  it("serializes keyframes as data attributes", () => {
    const elements = [makeTextElement({ id: "text-kf" })];
    const keyframes = {
      "text-kf": [
        { id: "kf1 &quot; &#39; < >", time: 0, properties: { opacity: 0 } },
        { id: "kf2", time: 1, properties: { opacity: 1 } },
      ],
    };
    const html = generateHyperframesHtml(elements, 5, { keyframes });

    expect(html).toContain("data-keyframes=");
    expect(html).toContain("kf1");
    expect(html).toContain("kf2");
    expect(parseHtml(html).keyframes["text-kf"]?.[0]?.id).toBe(keyframes["text-kf"][0]!.id);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(JSON.parse(doc.getElementById("text-kf")!.getAttribute("data-keyframes")!)).toEqual(
      keyframes["text-kf"],
    );
  });

  it("serializes zoom keyframes on zoom container", () => {
    const elements = [makeTextElement()];
    const stageZoomKeyframes = [
      { id: "z1 &quot; &#39; < >", time: 0, zoom: { scale: 1, focusX: 960, focusY: 540 } },
      { id: "z2", time: 5, zoom: { scale: 2, focusX: 400, focusY: 300 } },
    ];
    const html = generateHyperframesHtml(elements, 10, { stageZoomKeyframes });

    expect(html).toContain("data-zoom-keyframes=");
    expect(parseHtml(html).stageZoomKeyframes?.[0]?.id).toBe(stageZoomKeyframes[0]!.id);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(
      JSON.parse(doc.getElementById("stage-zoom-container")!.getAttribute("data-zoom-keyframes")!),
    ).toEqual(stageZoomKeyframes);
  });

  it("includes x, y, scale data attributes for non-default values", () => {
    const elements = [makeVideoElement({ x: 100, y: 200, scale: 1.5, opacity: 0.8 })];
    const html = generateHyperframesHtml(elements, 10);

    expect(html).toContain('data-x="100"');
    expect(html).toContain('data-y="200"');
    expect(html).toContain('data-scale="1.5"');
    expect(html).toContain('data-opacity="0.8"');
  });

  it("omits x, y, scale, opacity data attributes when at default values", () => {
    const elements = [makeVideoElement({ x: 0, y: 0, scale: 1, opacity: 1 })];
    const html = generateHyperframesHtml(elements, 10);

    expect(html).not.toContain("data-x=");
    expect(html).not.toContain("data-y=");
    expect(html).not.toContain("data-scale=");
    expect(html).not.toContain("data-opacity=");
  });
});

describe("generateGsapTimelineScript", () => {
  it("generates a timeline script with visibility animations", () => {
    const elements = [makeTextElement({ id: "el1", startTime: 1, duration: 4 })];
    const script = generateGsapTimelineScript(elements, 5);

    expect(script).toContain("const tl = gsap.timeline({ paused: true });");
    expect(script).toContain('tl.set("#el1"');
    expect(script).toContain('visibility: "hidden"');
    expect(script).toContain('visibility: "visible"');
  });

  it("generates empty timeline for no elements", () => {
    const script = generateGsapTimelineScript([], 5);

    expect(script).toContain("const tl = gsap.timeline({ paused: true });");
    expect(script).toContain("duration: 5");
  });

  it("includes media sync for video elements", () => {
    const elements = [makeVideoElement()];
    const script = generateGsapTimelineScript(elements, 10);

    expect(script).toContain("Sync media playback");
    expect(script).toContain("media.currentTime");
  });

  it("generates initial position sets for elements with x/y offsets", () => {
    const elements = [makeVideoElement({ id: "vid-pos", x: 100, y: 200 })];
    const script = generateGsapTimelineScript(elements, 10);

    expect(script).toContain('tl.set("#vid-pos", { x: 100, y: 200 }');
  });

  it("generates animations from keyframes", () => {
    const elements = [makeTextElement({ id: "el-kf", startTime: 0, duration: 5 })];
    const keyframes = {
      "el-kf": [
        { id: "kf1", time: 0, properties: { opacity: 0 } },
        { id: "kf2", time: 1, properties: { opacity: 1 } },
      ],
    };
    const script = generateGsapTimelineScript(elements, 5, { keyframes });

    // Should contain keyframe-based animations
    expect(script).toContain("el-kf");
  });
});

describe("generateHyperframesStyles", () => {
  it("generates core CSS with stage dimensions for landscape", () => {
    const elements = [makeTextElement()];
    const { coreCss } = generateHyperframesStyles(elements, "landscape");

    expect(coreCss).toContain("width: 1920px");
    expect(coreCss).toContain("height: 1080px");
    expect(coreCss).toContain("#stage");
  });

  it("generates core CSS with stage dimensions for portrait", () => {
    const elements = [makeTextElement()];
    const { coreCss } = generateHyperframesStyles(elements, "portrait");

    expect(coreCss).toContain("width: 1080px");
    expect(coreCss).toContain("height: 1920px");
  });

  it("generates element-specific styles for text", () => {
    const elements = [makeTextElement({ id: "styled-text", fontSize: 72, color: "red" })];
    const { coreCss } = generateHyperframesStyles(elements, "landscape");

    expect(coreCss).toContain("#styled-text");
    expect(coreCss).toContain("position: absolute");
  });

  it("generates element-specific styles for video", () => {
    const elements = [makeVideoElement({ id: "vid-styled" })];
    const { coreCss } = generateHyperframesStyles(elements, "landscape");

    expect(coreCss).toContain("#vid-styled");
    expect(coreCss).toContain("object-fit: contain");
  });

  it("includes custom CSS when provided", () => {
    const elements = [makeTextElement()];
    const { customCss } = generateHyperframesStyles(
      elements,
      "landscape",
      ".custom { color: blue; }",
    );

    expect(customCss).toContain(".custom { color: blue; }");
  });

  it("generates Google Fonts link for Inter (always included)", () => {
    const elements = [makeTextElement()];
    const { googleFontsLink } = generateHyperframesStyles(elements, "landscape");

    expect(googleFontsLink).toContain("fonts.googleapis.com");
    expect(googleFontsLink).toContain("Inter");
  });

  it("includes additional font families from text elements", () => {
    const elements = [makeTextElement({ fontFamily: "Montserrat" })];
    const { googleFontsLink } = generateHyperframesStyles(elements, "landscape");

    expect(googleFontsLink).toContain("Montserrat");
  });
});
