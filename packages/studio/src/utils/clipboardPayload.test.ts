// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  serializeClipboardPayload,
  deserializeClipboardPayload,
  insertAsSibling,
  type ClipboardPayload,
} from "./clipboardPayload";

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

  it("drops a 'readFrom' mark that arrives in clipboard text, for an element and for each clip", () => {
    const element = deserializeClipboardPayload(
      serializeClipboardPayload({
        kind: "dom-element",
        html: '<div onclick="x()"></div>',
        readFrom: "index.html",
        sourceFile: "index.html",
      }),
    );
    const clips = deserializeClipboardPayload(
      serializeClipboardPayload({
        kind: "timeline-clip",
        clips: [
          {
            html: '<div onclick="x()"></div>',
            readFrom: "index.html",
            start: 0,
            duration: 1,
            track: 0,
          },
        ],
        sourceFile: "index.html",
      }),
    );
    expect(element).toMatchObject({ kind: "dom-element", html: '<div onclick="x()"></div>' });
    expect(element).not.toHaveProperty("readFrom");
    expect(clips?.kind === "timeline-clip" && clips.clips[0]).toEqual({
      html: '<div onclick="x()"></div>',
      start: 0,
      duration: 1,
      track: 0,
    });
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

describe("insertAsSibling", () => {
  const ROOT = '<div data-composition-id="main" data-hf-id="r0">';
  const PASTED = '<b data-hf-id="n1">new</b>';

  it("places the paste right after the element the file names by that id", () => {
    const source = `${ROOT}<p data-hf-id="a1">one <i>two</i></p><p data-hf-id="a2">three</p></div>`;
    expect(insertAsSibling(source, PASTED, "a1")).toBe(
      `${ROOT}<p data-hf-id="a1">one <i>two</i></p>\n${PASTED}<p data-hf-id="a2">three</p></div>`,
    );
  });

  it("never anchors on tag text inside a script, style or comment", () => {
    const script = `<script>const word = '<span data-hf-id="w1">' + w + "</span>";</script>`;
    const style =
      '<style>/* <div data-composition-id="x"> */</style><!-- <span data-hf-id="w1"> -->';
    const source = `${script}${style}${ROOT}<p data-hf-id="a1">one</p></div>`;
    expect(insertAsSibling(source, PASTED, "w1")).toBe(
      `${script}${style}${ROOT}${PASTED}<p data-hf-id="a1">one</p></div>`,
    );
  });

  it("takes an anchor no element has, a pattern-like one too, as no anchor, at once", () => {
    const source = `${ROOT}${"a".repeat(5000)}!</div>`;
    const started = performance.now();
    expect(insertAsSibling(source, PASTED, "(a+)+$")).toBe(
      `${ROOT}${PASTED}${"a".repeat(5000)}!</div>`,
    );
    expect(performance.now() - started).toBeLessThan(500);
  });
});
