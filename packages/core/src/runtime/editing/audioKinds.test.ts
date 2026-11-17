import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_DESCRIBE_HANDLES } from "../editingElement";
import { assignAudioGroup, parseAssignAudioGroup } from "./assignAudioGroup";
import { audioMeter, parseAudioMeter } from "./audioMeter";
import { documentMarkup } from "./documentMarkup";
import {
  MAX_GROUP_VALUE,
  parseSetAudioGroupAttribute,
  setAudioGroupAttribute,
} from "./setAudioGroupAttribute";

const H1 = "0123456789abcdef:1";
const H2 = "0123456789abcdef:2";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("audio-meter", () => {
  it("takes only an on flag", () => {
    expect(parseAudioMeter({ on: true })).toEqual({ on: true });
    expect(parseAudioMeter({ on: "yes" })).toBeNull();
    expect(parseAudioMeter({ on: false, extra: 1 })).toBeNull();
    expect(parseAudioMeter([])).toBeNull();
  });

  it("starts and reads the taps, stops them, and reads nothing without an audio graph", () => {
    expect(audioMeter({ on: true }, undefined)).toEqual({ levels: null });
    const levels = { master: { l: 0.5, r: 0.25 }, groups: { vo: { l: 1, r: 1 } } };
    const meter = { start: vi.fn(), stop: vi.fn(), read: vi.fn(() => levels) };
    expect(audioMeter({ on: true }, meter)).toEqual({ levels });
    expect(meter.start).toHaveBeenCalledOnce();
    expect(audioMeter({ on: false }, meter)).toEqual({ levels: null });
    expect(meter.stop).toHaveBeenCalledOnce();
  });
});

describe("document-markup", () => {
  it("returns the live markup and base URL", () => {
    document.body.innerHTML = `<hf-audio-group id="vo" data-volume="0.5"></hf-audio-group>`;
    const { html, baseURI } = documentMarkup();
    expect(html).toContain('<hf-audio-group id="vo" data-volume="0.5">');
    expect(baseURI).toBe(document.baseURI);
  });
});

describe("set-audio-group-attribute", () => {
  it("takes a group id, one of the group's own attributes, and a bounded value", () => {
    const valid = { id: "vo", attr: "data-volume", value: "0.5" };
    expect(parseSetAudioGroupAttribute(valid)).toEqual(valid);
    expect(parseSetAudioGroupAttribute({ ...valid, value: null })).toEqual({
      ...valid,
      value: null,
    });
    for (const bad of [
      { ...valid, attr: "onclick" },
      { ...valid, attr: "data-audio-group" },
      { ...valid, id: "" },
      { ...valid, value: "x".repeat(MAX_GROUP_VALUE + 1) },
      { ...valid, value: 1 },
      { id: "vo", attr: "data-volume" },
    ]) {
      expect(parseSetAudioGroupAttribute(bad)).toBeNull();
    }
  });

  it("writes and removes the attribute on the group element only", () => {
    document.body.innerHTML = `<hf-audio-group id="vo"></hf-audio-group><div id="card"></div>`;
    const group = document.getElementById("vo")!;
    expect(setAudioGroupAttribute({ id: "vo", attr: "data-volume", value: "2" })).toEqual({
      applied: true,
    });
    expect(group.getAttribute("data-volume")).toBe("2");
    setAudioGroupAttribute({ id: "vo", attr: "data-volume", value: null });
    expect(group.hasAttribute("data-volume")).toBe(false);
    expect(setAudioGroupAttribute({ id: "card", attr: "data-hidden", value: "" })).toEqual({
      applied: false,
    });
    expect(document.getElementById("card")!.hasAttribute("data-hidden")).toBe(false);
  });
});

describe("assign-audio-group", () => {
  it("takes handle-addressed members and an optional group element", () => {
    const valid = {
      members: [{ handle: H1, group: "vo" }],
      element: { id: "vo", label: null, present: true },
    };
    expect(parseAssignAudioGroup(valid)).toEqual(valid);
    expect(parseAssignAudioGroup({ ...valid, element: null })).toEqual({ ...valid, element: null });
    const many = Array.from({ length: MAX_DESCRIBE_HANDLES + 1 }, () => ({
      handle: H1,
      group: null,
    }));
    for (const bad of [
      { ...valid, members: [{ handle: "card", group: "vo" }] },
      { ...valid, members: [{ handle: H1, group: "" }] },
      { ...valid, members: many },
      { ...valid, element: { id: "vo", present: true } },
      { ...valid, element: { id: "vo", label: null, present: "yes" } },
      { members: valid.members },
    ]) {
      expect(parseAssignAudioGroup(bad)).toBeNull();
    }
  });

  it("groups the members, adds the group element, and unwinds both", () => {
    document.body.innerHTML = `<audio id="a" data-audio-group="old"></audio><audio id="b"></audio>`;
    const byHandle = new Map([
      [H1, document.getElementById("a")],
      [H2, document.getElementById("b")],
    ]);
    const resolve = (handle: string) => byHandle.get(handle) ?? null;
    const done = assignAudioGroup(
      {
        members: [
          { handle: H1, group: "vo" },
          { handle: H2, group: "vo" },
        ],
        element: { id: "vo", label: "Voice", present: true },
      },
      resolve,
    );
    expect(done).toEqual({ previous: ["old", null], changed: true });
    expect(byHandle.get(H1)!.getAttribute("data-audio-group")).toBe("vo");
    expect(document.querySelector("hf-audio-group#vo")!.getAttribute("data-label")).toBe("Voice");

    const undone = assignAudioGroup(
      {
        members: [
          { handle: H1, group: "old" },
          { handle: H2, group: null },
        ],
        element: { id: "vo", label: null, present: false },
      },
      resolve,
    );
    expect(undone).toEqual({ previous: ["vo", "vo"], changed: true });
    expect(byHandle.get(H1)!.getAttribute("data-audio-group")).toBe("old");
    expect(byHandle.get(H2)!.hasAttribute("data-audio-group")).toBe(false);
    expect(document.getElementById("vo")).toBeNull();
  });

  it("leaves an element that already owns the id", () => {
    document.body.innerHTML = `<div id="vo"></div>`;
    const resolve = () => null;
    for (const present of [true, false]) {
      expect(
        assignAudioGroup({ members: [], element: { id: "vo", label: null, present } }, resolve),
      ).toEqual({ previous: [], changed: false });
    }
    expect(document.getElementById("vo")!.localName).toBe("div");
  });
});
