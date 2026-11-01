import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCssAdapter } from "./css";
import { createAuthoredCssAnimations, cssClip, splitNames } from "./cssAnimation";
import { createWaapiAdapter } from "./waapi";
import { createRuntimeStartTimeResolver } from "../startResolver";

describe("authored CSS animation clocks", () => {
  const names = new Map<Element, Map<string, string>>();
  const name = (element: Element, value: string, pseudo = "") => {
    const styles = names.get(element) ?? new Map();
    styles.set(pseudo, value);
    names.set(element, styles);
  };
  // jsdom does not implement CSSAnimation or KeyframeEffect; model their public browser fields.
  const animation = (
    target: Element,
    animationName = "slide",
    pseudoElement: string | null = null,
  ) =>
    ({
      animationName,
      currentTime: 750,
      playState: "paused",
      pause: vi.fn(),
      addEventListener: vi.fn(),
      effect: { target, pseudoElement, getComputedTiming: () => ({ endTime: 4000 }) },
    }) as unknown as CSSAnimation;

  const mount = () => {
    const clip = document.createElement("div");
    clip.dataset.start = "2";
    const light = document.createElement("div");
    const host = document.createElement("div");
    clip.append(light, host);
    document.body.append(clip);
    const outer = host.attachShadow({ mode: "open" });
    const nestedHost = document.createElement("div");
    outer.append(nestedHost);
    const inner = nestedHost.attachShadow({ mode: "open" });
    const leaf = document.createElement("div");
    inner.append(leaf);
    return { clip, light, host, outer, inner, leaf };
  };

  beforeEach(() => {
    document.getAnimations = () => [];
    vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
      const style = document.createElement("div").style;
      style.animationName = names.get(element)?.get(pseudo ?? "") ?? "none";
      style.animationDuration = "4s";
      return style;
    });
  });

  afterEach(() => {
    names.clear();
    document.body.replaceChildren();
    Reflect.deleteProperty(document, "getAnimations");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("distinguishes each target, pseudo-element and animation name through nested shadow roots", () => {
    const { light, leaf, outer, inner } = mount();
    name(light, "slide, fade");
    name(light, "pulse", "::after");
    name(leaf, "spin");
    const authored = createAuthoredCssAnimations();
    const owned: Element[] = [];
    authored.discover((element) => owned.push(element));
    expect(authored.shadowRoots()).toEqual([outer, inner]);
    expect(owned).toEqual([light]);
    const candidates = [
      animation(light, "fade"),
      animation(light, "pulse", "::after"),
      animation(leaf, "spin"),
      animation(light, "pulse"),
      animation(light, "slide", "::before"),
      animation(leaf, "slide"),
    ];
    expect(candidates.map(authored.has)).toEqual([true, true, true, false, false, false]);
    expect(candidates.map(authored.drivenByCssAdapter)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("refreshes names and open roots on rediscovery", () => {
    const { host, light, leaf } = mount();
    name(light, "slide");
    const authored = createAuthoredCssAnimations();
    authored.discover();
    expect(authored.hasAny()).toBe(true);
    name(leaf, "spin", "::before");
    authored.discover();
    expect(authored.has(animation(leaf, "spin", "::before"))).toBe(true);
    names.clear();
    host.remove();
    authored.discover();
    expect(authored.has(animation(light))).toBe(false);
    expect(authored.hasAny()).toBe(false);
    expect(authored.shadowRoots()).toEqual([]);
  });

  it("uses the outer light-DOM clip for shadow descendants", () => {
    const { clip, host, leaf } = mount();
    leaf.dataset.start = "9";
    expect(cssClip(leaf)).toBe(clip);
    host.dataset.start = "3";
    expect(cssClip(leaf)).toBe(host);
  });

  it("treats a quoted keyword as an animation name", () => {
    const { light } = mount();
    name(light, 'none, "none"');
    const authored = createAuthoredCssAnimations();
    authored.discover();
    expect(authored.has(animation(light, "none"))).toBe(true);
  });

  it.each([
    ["slide, fade", ["slide", "fade"]],
    [String.raw`slide\,a, slide\ `, [String.raw`slide\,a`, String.raw`slide\ `]],
    [String.raw`\31 abc, foo\20 , slide`, [String.raw`\31 abc`, String.raw`foo\20 `, "slide"]],
    ['"name space", "name,comma", "none"', ['"name space"', '"name,comma"', '"none"']],
    ["slide\u00a0name, fade", ["slide\u00a0name", "fade"]],
    ["", []],
  ])("keeps CSSOM animation-name tokens intact: %s", (list, expected) => {
    expect(splitNames(list)).toEqual(expected);
  });

  it("anchors an authored pseudo animation found after an empty discover to its clip", () => {
    const { clip, light } = mount();
    name(light, "slide", "::before");
    const authored = createAuthoredCssAnimations();
    authored.discover();
    const handle = animation(light, "slide", "::before");
    let live: Animation[] = [];
    const read = vi.fn(() => live);
    const adapter = createWaapiAdapter({ authored, readPageAnimations: read });
    adapter.discover();
    live = [handle];
    adapter.seek({ time: 5 });
    expect(handle.currentTime).toBe(3000);
    expect(adapter.getInferredDurationSeconds?.()).toBe(6);
    clip.dataset.start = "4";
    adapter.seek({ time: 5 });
    expect(handle.currentTime).toBe(1000);
    expect(adapter.getInferredDurationSeconds?.()).toBe(8);
    adapter.seek({ time: 3 });
    expect(handle.currentTime).toBe(0);
    adapter.revert?.();
  });

  it("uses the runtime's absolute start resolver for nested compositions", () => {
    const { clip, leaf } = mount();
    name(leaf, "slide");
    const authored = createAuthoredCssAnimations();
    authored.discover();
    const handle = animation(leaf);
    const resolveStartSeconds = vi.fn(() => 7);
    const adapter = createWaapiAdapter({
      authored,
      resolveStartSeconds,
      readPageAnimations: () => [handle],
    });
    adapter.discover();
    adapter.seek({ time: 8 });
    expect(resolveStartSeconds).toHaveBeenCalledWith(clip);
    expect(handle.currentTime).toBe(1000);
    expect(adapter.getInferredDurationSeconds?.()).toBe(11);
    adapter.revert?.();
  });

  describe.each(["pseudo", "shadow"])("a wrapped composition's %s clock", (kind) => {
    it.each([
      { name: "neutral wrapper", wrapperStart: "", childStart: "", start: 6 },
      { name: "timed wrapper", wrapperStart: 'data-start="2"', childStart: "", start: 8 },
      {
        name: "explicit child start",
        wrapperStart: 'data-start="2"',
        childStart: 'data-start="1"',
        start: 7,
      },
    ])("resolves a local clip through a $name", ({ wrapperStart, childStart, start }) => {
      document.body.innerHTML = `
        <div data-composition-id="root" data-start="0">
          <div data-composition-id="scene" data-start="5">
            <section ${wrapperStart}>
              <article>
                <div data-composition-id="child" ${childStart}>
                  <div id="local-clip" data-start="1"><div id="target"></div></div>
                </div>
              </article>
            </section>
          </div>
        </div>`;
      const host = document.getElementById("target")!;
      const clip = document.getElementById("local-clip")!;
      const target = kind === "shadow" ? document.createElement("div") : host;
      if (kind === "shadow") host.attachShadow({ mode: "open" }).append(target);
      const pseudo = kind === "pseudo" ? "::before" : "";
      name(target, "slide", pseudo);
      const authored = createAuthoredCssAnimations();
      authored.discover();
      const resolver = createRuntimeStartTimeResolver({});
      expect(resolver.resolveStartForElement(clip)).toBe(start);
      const handle = animation(target, "slide", pseudo || null);
      const adapter = createWaapiAdapter({
        authored,
        resolveStartSeconds: (element) => resolver.resolveStartForElement(element),
        readPageAnimations: () => [handle],
      });
      adapter.discover();
      for (const [time, expected] of [
        [start - 0.25, 0],
        [start, 0],
        [start + 1, 1000],
        [start + 3, 3000],
        [start + 0.5, 500],
        [start - 0.25, 0],
      ]) {
        adapter.seek({ time });
        expect(handle.currentTime).toBe(expected);
      }
      expect(adapter.getInferredDurationSeconds?.()).toBe(start + 4);
      adapter.revert?.();
    });
  });

  it.each(["pseudo", "shadow"])("refreshes the containing clip for a live %s animation", (kind) => {
    const { clip, light, host, leaf } = mount();
    const wrapper = document.createElement("div");
    clip.append(wrapper);
    wrapper.append(kind === "shadow" ? host : light);
    const target = kind === "shadow" ? leaf : light;
    const pseudo = kind === "pseudo" ? "::before" : "";
    name(target, "slide", pseudo);
    const authored = createAuthoredCssAnimations();
    authored.discover();
    const handle = animation(target, "slide", pseudo || null);
    const adapter = createWaapiAdapter({ authored, readPageAnimations: () => [handle] });
    adapter.discover();
    adapter.seek({ time: 5 });
    expect(handle.currentTime).toBe(3000);
    expect(adapter.getInferredDurationSeconds?.()).toBe(6);
    wrapper.dataset.start = "4";
    adapter.seek({ time: 5 });
    expect(handle.currentTime).toBe(1000);
    expect(adapter.getInferredDurationSeconds?.()).toBe(8);
    wrapper.removeAttribute("data-start");
    adapter.seek({ time: 5 });
    expect(handle.currentTime).toBe(3000);
    expect(adapter.getInferredDurationSeconds?.()).toBe(6);
    adapter.revert?.();
  });

  it("gives a late CSS replacement its own baseline without an inline fallback or a second writer", () => {
    const { light } = mount();
    name(light, "slide");
    vi.stubGlobal("CSSAnimation", class {});
    const authored = createAuthoredCssAnimations();
    const css = createCssAdapter({ authored });
    css.discover();
    const original = animation(light);
    let live: Animation[] = [original];
    document.getAnimations = () => live;
    const waapi = createWaapiAdapter({ authored });
    waapi.discover();
    css.seek({ time: 3 });
    waapi.seek({ time: 3 });
    expect(original.currentTime).toBe(1000);
    expect(original.pause).toHaveBeenCalledTimes(1);
    Object.assign(original, { playState: "idle" });
    const late = animation(light, "late");
    live = [late];
    css.seek({ time: 4 });
    waapi.seek({ time: 4 });
    expect(late.currentTime).toBe(0);
    expect(light.style.animationDelay).toBe("");
    css.seek({ time: 4.5 });
    waapi.seek({ time: 4.5 });
    expect(late.currentTime).toBe(500);
    expect(original.pause).toHaveBeenCalledTimes(1);
    waapi.revert?.();
  });
});
