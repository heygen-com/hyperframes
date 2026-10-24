import { afterEach, describe, expect, it } from "vitest";
import { filterReach, inkPad, shadowReach } from "./ink";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("shadowReach", () => {
  it("adds offset, blur and spread of the widest outer shadow", () => {
    expect(shadowReach("rgba(255, 90, 31, 0.5) 0px 8px 24px 4px")).toBe(36);
    expect(shadowReach("rgb(0, 0, 0) 2px 3px 5px 0px, rgba(0, 0, 0, 0.2) 0px 20px 40px 0px")).toBe(
      60,
    );
  });

  it("ignores inset shadows and none", () => {
    expect(shadowReach("rgba(0, 0, 0, 0.5) 0px 0px 30px 0px inset")).toBe(0);
    expect(shadowReach("none")).toBe(0);
  });
});

describe("filterReach", () => {
  it("reads drop-shadow() like a shadow and blur() as three sigmas", () => {
    expect(filterReach("drop-shadow(rgba(0, 0, 0, 0.4) 0px 4px 8px)")).toBe(16);
    expect(filterReach("blur(6px)")).toBe(18);
    expect(filterReach("none")).toBe(0);
  });

  it("does not read the blur of a drop-shadow as a blur()", () => {
    expect(filterReach("drop-shadow(rgb(0, 0, 0) 0px 0px 10px)")).toBe(15);
  });
});

describe("inkPad", () => {
  it("covers a glow on the mover and on a descendant, and nothing for a plain box", () => {
    const plain = document.createElement("div");
    const glow = document.createElement("div");
    const outer = document.createElement("div");
    const inner = document.createElement("span");
    glow.style.boxShadow = "rgba(255, 90, 31, 0.5) 0px 0px 20px 0px";
    inner.style.boxShadow = "rgba(0, 0, 0, 0.5) 0px 0px 30px 0px";
    outer.append(inner);
    document.body.append(plain, glow, outer);
    expect(inkPad(plain)).toBe(0);
    expect(inkPad(glow)).toBe(20);
    expect(inkPad(outer)).toBe(30);
  });

  it("is capped", () => {
    const el = document.createElement("div");
    el.style.boxShadow = "rgb(0, 0, 0) 0px 0px 900px 0px";
    document.body.append(el);
    expect(inkPad(el)).toBe(256);
  });
});
