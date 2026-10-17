// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  deduplicateIds,
  serializeClipboardPayload,
  deserializeClipboardPayload,
  type ClipboardPayload,
} from "./clipboardPayload";

describe("deduplicateIds", () => {
  it("renames ids that collide with existing ids", () => {
    const html = '<div id="hero"><img id="photo" src="a.png" /></div>';
    const existingIds = ["hero", "other"];
    const result = deduplicateIds(html, existingIds);
    expect(result).not.toContain('id="hero"');
    expect(result).toContain('id="photo"');
    expect(result).toMatch(/id="hero-\d+"/);
  });

  it("returns html unchanged when no collisions", () => {
    const html = '<div id="unique"><p>hello</p></div>';
    const result = deduplicateIds(html, ["other"]);
    expect(result).toBe(html);
  });

  it("does not rewrite data-composition-id or other data-*-id attributes", () => {
    const html = '<div data-composition-id="hero" data-clip-id="hero" id="hero">content</div>';
    const result = deduplicateIds(html, ["hero"]);
    expect(result).toContain('data-composition-id="hero"');
    expect(result).toContain('data-clip-id="hero"');
    expect(result).toMatch(/\sid="hero-\d+"/);
  });
});

describe("serializeClipboardPayload / deserializeClipboardPayload", () => {
  it("round-trips a single-clip timeline payload", () => {
    const payload: ClipboardPayload = {
      kind: "timeline-clip",
      clips: [
        {
          html: '<img id="photo" src="a.png" data-start="1" data-duration="3" />',
          start: 1,
          duration: 3,
          track: 0,
        },
      ],
      sourceFile: "index.html",
    };
    const json = serializeClipboardPayload(payload);
    const parsed = deserializeClipboardPayload(json);
    expect(parsed).toEqual(payload);
  });

  it("round-trips a group timeline-clip payload", () => {
    const payload: ClipboardPayload = {
      kind: "timeline-clip",
      clips: [
        {
          html: '<img id="a" data-start="1" data-duration="0.5" />',
          start: 1,
          duration: 0.5,
          track: 0,
        },
        {
          html: '<img id="b" data-start="2" data-duration="0.5" />',
          start: 2,
          duration: 0.5,
          track: 1,
        },
      ],
      sourceFile: "index.html",
    };
    const json = serializeClipboardPayload(payload);
    const parsed = deserializeClipboardPayload(json);
    expect(parsed).toEqual(payload);
  });

  it("round-trips a dom-element payload", () => {
    const payload: ClipboardPayload = {
      kind: "dom-element",
      html: '<div class="card"><p>Hello</p></div>',
      sourceFile: "compositions/scene.html",
    };
    const json = serializeClipboardPayload(payload);
    const parsed = deserializeClipboardPayload(json);
    expect(parsed).toEqual(payload);
  });

  it("returns null for invalid JSON", () => {
    expect(deserializeClipboardPayload("not json")).toBeNull();
    expect(deserializeClipboardPayload('{"kind":"unknown"}')).toBeNull();
  });

  it("returns null for a timeline-clip payload with no clips", () => {
    const json = serializeClipboardPayload({
      kind: "timeline-clip",
      clips: [],
      sourceFile: "index.html",
    });
    expect(deserializeClipboardPayload(json)).toBeNull();
  });
});

it("rebinds embedded selector tokens and local references without rewriting literals, remote resources or scripts", () => {
  const html = `<div id="clip"><style>@media all{#clip :is(#shape){fill:url('#paint');color:#abc;content:"url(#paint) #shape"}[title="#shape"]{color:blue}}</style><svg><symbol id="shape"></symbol><linearGradient id="paint"></linearGradient><use href="#shape"/><use xlink:href="#shape"/><image href="https://example.com/a.svg#shape"/><image href="data:image/png;base64,YQ=="/><path fill="url(#paint)" style="stroke:url(&quot;#paint&quot;);color:#abc"/></svg><script>const selector = '#shape';</script><p title="url(#paint)">#shape</p></div>`;
  const result = deduplicateIds(html, ["clip", "shape", "paint"]);
  expect(result).toContain("#clip-2 :is(#shape-2)");
  expect(result).toContain("fill:url('#paint-2')");
  expect(result).toContain('content:"url(#paint) #shape"');
  expect(result).toContain('[title="#shape"]');
  expect(result).toContain('href="#shape-2"');
  expect(result).toContain('xlink:href="#shape-2"');
  expect(result).toContain('href="https://example.com/a.svg#shape"');
  expect(result).toContain('href="data:image/png;base64,YQ=="');
  expect(result).toContain('fill="url(#paint-2)"');
  expect(result).toContain("stroke:url(&quot;#paint-2&quot;)");
  expect(result).toContain("const selector = '#shape';");
  expect(result).toContain('<p title="url(#paint)">#shape</p>');
  expect(result).toContain("color:#abc");
});
