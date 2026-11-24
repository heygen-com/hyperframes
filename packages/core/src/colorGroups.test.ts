import { beforeEach, describe, expect, it } from "vitest";
import { HF_COLOR_GRADING_ATTR } from "./colorGrading";
import {
  colorGroupOf,
  effectiveColorGrading,
  ensureColorGroupInertStyle,
  HF_COLOR_GROUP_ATTR,
  HF_COLOR_GROUP_TAG,
  resolveColorGroupElement,
} from "./colorGroups";

const LANE_GRADE = '{"adjust":{"exposure":0.4}}';
const OWN_GRADE = '{"adjust":{"exposure":-0.2}}';

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("colorGroupOf", () => {
  it("reads membership off the member", () => {
    document.body.innerHTML = `
      <hf-color-group id="tamer" data-color-grading='${LANE_GRADE}'></hf-color-group>
      <video id="a" data-color-group="tamer"></video>
      <img id="b" data-color-group="tamer">
      <canvas id="c" data-color-group="tamer"></canvas>
    `;
    for (const id of ["a", "b", "c"]) {
      expect(colorGroupOf(document.getElementById(id)!)).toBe("tamer");
    }
  });

  it('treats data-color-group="" as no group', () => {
    document.body.innerHTML = `<video id="a" data-color-group=""></video>`;
    expect(colorGroupOf(document.getElementById("a")!)).toBeNull();
  });

  it("ignores the attribute on an element the grader cannot draw", () => {
    document.body.innerHTML = `<div id="a" data-color-group="tamer"></div>`;
    expect(colorGroupOf(document.getElementById("a")!)).toBeNull();
  });
});

describe("resolveColorGroupElement", () => {
  it("finds the group element by id", () => {
    document.body.innerHTML = `<hf-color-group id="tamer"></hf-color-group>`;
    expect(resolveColorGroupElement(document, "tamer")?.tagName.toLowerCase()).toBe(
      HF_COLOR_GROUP_TAG,
    );
  });

  it("does not read an unrelated element that shares the id as a group", () => {
    document.body.innerHTML = `<div id="tamer" data-color-grading='${LANE_GRADE}'></div>`;
    expect(resolveColorGroupElement(document, "tamer")).toBeNull();
  });
});

describe("effectiveColorGrading", () => {
  it("grades a member through its group element", () => {
    document.body.innerHTML = `
      <hf-color-group id="tamer" data-color-grading='${LANE_GRADE}'></hf-color-group>
      <video id="a" data-color-group="tamer"></video>
    `;
    expect(effectiveColorGrading(document.getElementById("a")!, document)).toBe(LANE_GRADE);
  });

  it("is null when the group has no element", () => {
    document.body.innerHTML = `<video id="a" data-color-group="tamer"></video>`;
    expect(effectiveColorGrading(document.getElementById("a")!, document)).toBeNull();
  });

  it("is null when the group element carries no grading", () => {
    document.body.innerHTML = `
      <hf-color-group id="tamer"></hf-color-group>
      <video id="a" data-color-group="tamer"></video>
    `;
    expect(effectiveColorGrading(document.getElementById("a")!, document)).toBeNull();
  });

  it("lets a member's own grading win over its group's", () => {
    document.body.innerHTML = `
      <hf-color-group id="tamer" data-color-grading='${LANE_GRADE}'></hf-color-group>
      <video id="a" data-color-group="tamer" data-color-grading='${OWN_GRADE}'></video>
    `;
    expect(effectiveColorGrading(document.getElementById("a")!, document)).toBe(OWN_GRADE);
  });

  it("is the element's own grading when it has no group", () => {
    document.body.innerHTML = `<img id="a" ${HF_COLOR_GRADING_ATTR}='${OWN_GRADE}'>`;
    expect(effectiveColorGrading(document.getElementById("a")!, document)).toBe(OWN_GRADE);
  });

  it('is null for data-color-group="" with no grading of its own', () => {
    document.body.innerHTML = `
      <hf-color-group id="" data-color-grading='${LANE_GRADE}'></hf-color-group>
      <video id="a" ${HF_COLOR_GROUP_ATTR}=""></video>
    `;
    expect(effectiveColorGrading(document.getElementById("a")!, document)).toBeNull();
  });
});

describe("ensureColorGroupInertStyle", () => {
  it("takes the group element out of layout, against an author rule", () => {
    document.head.insertAdjacentHTML("beforeend", `<style>#tamer{display:flex}</style>`);
    document.body.innerHTML = `<hf-color-group id="tamer"></hf-color-group>`;
    ensureColorGroupInertStyle(document);
    expect(getComputedStyle(document.getElementById("tamer")!).display).toBe("contents");
  });

  it("injects its style once", () => {
    ensureColorGroupInertStyle(document);
    ensureColorGroupInertStyle(document);
    expect(document.head.querySelectorAll("style")).toHaveLength(1);
  });
});

describe("group ids are scoped to their composition", () => {
  it("pairs a member with the group in its own composition before one elsewhere with the same id", () => {
    document.body.innerHTML = `
      <div data-composition-id="scene-1">
        <hf-color-group id="cam-a" data-color-grading='${LANE_GRADE}'></hf-color-group>
        <video id="first" data-color-group="cam-a"></video>
      </div>
      <div data-composition-id="scene-2">
        <hf-color-group id="cam-a" data-color-grading='${OWN_GRADE}'></hf-color-group>
        <video id="second" data-color-group="cam-a"></video>
      </div>
    `;
    expect(effectiveColorGrading(document.getElementById("first")!, document)).toBe(LANE_GRADE);
    expect(effectiveColorGrading(document.getElementById("second")!, document)).toBe(OWN_GRADE);
  });

  it("falls back to the document when the member's composition declares no such group", () => {
    document.body.innerHTML = `
      <hf-color-group id="cam-a" data-color-grading='${LANE_GRADE}'></hf-color-group>
      <div data-composition-id="scene-1"><video id="v" data-color-group="cam-a"></video></div>
    `;
    expect(effectiveColorGrading(document.getElementById("v")!, document)).toBe(LANE_GRADE);
  });
});
