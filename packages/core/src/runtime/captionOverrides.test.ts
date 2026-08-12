// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyCaptionOverrides } from "./captionOverrides";

function installCaptionOverrideFetch(overrides: unknown[]) {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    async json() {
      return overrides;
    },
  }));
}

function installGsapMock() {
  const setCalls: Array<{ target: Element; vars: Record<string, unknown> }> = [];
  const gsap = {
    set(target: Element, vars: Record<string, unknown>) {
      setCalls.push({ target, vars });
      for (const [key, value] of Object.entries(vars)) {
        if (key === "fontSize" && typeof value === "string" && target instanceof HTMLElement) {
          target.style.fontSize = value;
        }
      }
    },
    killTweensOf() {},
    getTweensOf() {
      return [];
    },
  };
  Object.defineProperty(window, "gsap", {
    configurable: true,
    value: gsap,
  });
  return { setCalls };
}

/** A gsap mock whose `getTweensOf` returns the supplied colour tweens, so classification is testable. */
function installGsapMockWithTweens(tweens: Array<Record<string, unknown>>) {
  const gsap = {
    set() {},
    killTweensOf() {},
    getTweensOf() {
      return tweens.map((vars, i) => ({ vars, startTime: () => i }));
    },
  };
  Object.defineProperty(window, "gsap", { configurable: true, value: gsap });
  return tweens;
}

async function flushCaptionOverrides() {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "gsap");
});

describe("applyCaptionOverrides", () => {
  it("reuses existing caption wrappers when overrides are applied more than once", async () => {
    const { setCalls } = installGsapMock();
    installCaptionOverrideFetch([{ wordIndex: 0, x: 12, y: -4, scale: 1.2 }]);
    document.body.innerHTML = `
      <div class="caption-group">
        <span id="w0">Hello</span>
      </div>
    `;

    applyCaptionOverrides();
    await flushCaptionOverrides();
    applyCaptionOverrides();
    await flushCaptionOverrides();

    const group = document.querySelector(".caption-group");
    const word = document.getElementById("w0");
    const wrappers = group?.querySelectorAll('[data-caption-wrapper="true"]');
    const wrapper = wrappers?.item(0);
    if (!group || !word || !wrapper) throw new Error("Expected wrapped caption word");

    expect(wrappers).toHaveLength(1);
    expect(wrapper.parentElement).toBe(group);
    expect(word.parentElement).toBe(wrapper);
    expect(setCalls.map((call) => call.target)).toEqual([wrapper, wrapper]);
  });

  it("treats a pre-wrapped word as the wordIndex target, not as another word", async () => {
    installGsapMock();
    installCaptionOverrideFetch([{ wordIndex: 0, fontSize: 72 }]);
    document.body.innerHTML = `
      <div class="caption-group">
        <span data-caption-wrapper="true">
          <span id="w0">Hello</span>
        </span>
      </div>
    `;

    applyCaptionOverrides();
    await flushCaptionOverrides();

    const word = document.getElementById("w0");
    const wrapper = word?.parentElement;
    if (!(word instanceof HTMLElement) || !wrapper) {
      throw new Error("Expected pre-wrapped caption word");
    }

    expect(word.style.fontSize).toBe("72px");
    expect(wrapper.getAttribute("style") ?? "").not.toContain("font-size");
  });

  it("resolves wordId overrides against the inner word of an existing wrapper", async () => {
    const { setCalls } = installGsapMock();
    installCaptionOverrideFetch([{ wordId: "w0", x: 16 }]);
    document.body.innerHTML = `
      <div class="caption-group">
        <span data-caption-wrapper="true">
          <span id="w0">Hello</span>
        </span>
      </div>
    `;

    applyCaptionOverrides();
    await flushCaptionOverrides();

    const word = document.getElementById("w0");
    const wrapper = word?.parentElement;
    if (!(word instanceof HTMLElement) || !wrapper) {
      throw new Error("Expected pre-wrapped caption word");
    }

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]?.target).toBe(wrapper);
    expect(setCalls[0]?.vars).toEqual({ x: 16 });
  });
});

describe("caption state declaration", () => {
  it("honours a declared state when dim and active colours are IDENTICAL", async () => {
    // The failure the declaration exists for. Classification by colour equality takes the first
    // tween's colour as the dim baseline, so a composition whose two states share a colour has
    // every tween classified dim — and `activeColor` is silently dropped.
    const tweens = installGsapMockWithTweens([
      { color: "#888", data: { captionState: "dim" } },
      { color: "#888", data: { captionState: "active" } },
    ]);
    installCaptionOverrideFetch([{ wordIndex: 0, dimColor: "#111", activeColor: "#eee" }]);
    document.body.innerHTML = `<div class="caption-group"><span id="w0">Hi</span></div>`;

    applyCaptionOverrides();
    await flushCaptionOverrides();

    expect(tweens[0].color).toBe("#111");
    expect(tweens[1].color).toBe("#eee");
  });

  it("falls back to colour classification when nothing is declared", async () => {
    // Undeclared compositions must keep working exactly as before — the declaration is additive.
    const tweens = installGsapMockWithTweens([{ color: "#222" }, { color: "#fff" }]);
    installCaptionOverrideFetch([{ wordIndex: 0, dimColor: "#111", activeColor: "#eee" }]);
    document.body.innerHTML = `<div class="caption-group"><span id="w0">Hi</span></div>`;

    applyCaptionOverrides();
    await flushCaptionOverrides();

    expect(tweens[0].color).toBe("#111");
    expect(tweens[1].color).toBe("#eee");
  });

  it("prefers the declaration over the colour heuristic when they disagree", async () => {
    // Declared order is deliberately the reverse of what colour-equality would infer.
    const tweens = installGsapMockWithTweens([
      { color: "#222", data: { captionState: "active" } },
      { color: "#fff", data: { captionState: "dim" } },
    ]);
    installCaptionOverrideFetch([{ wordIndex: 0, dimColor: "#111", activeColor: "#eee" }]);
    document.body.innerHTML = `<div class="caption-group"><span id="w0">Hi</span></div>`;

    applyCaptionOverrides();
    await flushCaptionOverrides();

    expect(tweens[0].color).toBe("#eee");
    expect(tweens[1].color).toBe("#111");
  });

  it("does not let a declared tween poison the baseline for undeclared ones", async () => {
    // The baseline exists to guess about tweens the declaration has NOT spoken to. Deriving it from
    // a tween declared "active" makes every undeclared same-state tween compare against a colour
    // that has explicitly said it is not the dim reference — so the one genuinely dim tween here
    // gets classified active and receives the wrong override.
    const tweens = installGsapMockWithTweens([
      { color: "#eee", data: { captionState: "active" } },
      { color: "#111" },
    ]);
    installCaptionOverrideFetch([{ wordIndex: 0, dimColor: "#dim", activeColor: "#active" }]);
    document.body.innerHTML = `<div class="caption-group"><span id="w0">Hi</span></div>`;

    applyCaptionOverrides();
    await flushCaptionOverrides();

    expect(tweens[0].color).toBe("#active");
    expect(tweens[1].color).toBe("#dim");
  });

  it("prefers a declared dim tween as the baseline over an undeclared one", async () => {
    const tweens = installGsapMockWithTweens([
      { color: "#aaa" },
      { color: "#bbb", data: { captionState: "dim" } },
    ]);
    installCaptionOverrideFetch([{ wordIndex: 0, dimColor: "#dim", activeColor: "#active" }]);
    document.body.innerHTML = `<div class="caption-group"><span id="w0">Hi</span></div>`;

    applyCaptionOverrides();
    await flushCaptionOverrides();

    // #bbb is the declared dim reference, so the undeclared #aaa is not dim.
    expect(tweens[0].color).toBe("#active");
    expect(tweens[1].color).toBe("#dim");
  });

  it("falls through to the heuristic for a malformed declaration", async () => {
    // A typo, a primitive, or a null must never ship a broken composition — an unrecognised value
    // is not a state, so classification continues as if nothing was declared.
    for (const data of [{ captionState: "typo" }, { captionState: 42 }, null, "notAnObject"]) {
      const tweens = installGsapMockWithTweens([{ color: "#222", data }, { color: "#fff" }]);
      installCaptionOverrideFetch([{ wordIndex: 0, dimColor: "#dim", activeColor: "#active" }]);
      document.body.innerHTML = `<div class="caption-group"><span id="w0">Hi</span></div>`;

      applyCaptionOverrides();
      await flushCaptionOverrides();

      expect(tweens[0].color).toBe("#dim");
      expect(tweens[1].color).toBe("#active");
    }
  });
});
