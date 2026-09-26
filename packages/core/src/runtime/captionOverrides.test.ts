// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyCaptionOverrides } from "./captionOverrides";

function installCaptionOverrideFetch(overrides: unknown) {
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
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "gsap");
});

describe("applyCaptionOverrides", () => {
  it("treats a missing optional sidecar as a silent no-op", async () => {
    installGsapMock();
    const json = vi.fn();
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404, json }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = `<div class="caption-group"><span>Hi</span></div>`;

    applyCaptionOverrides();
    await flushCaptionOverrides();

    expect(json).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", () => Promise.reject(new SyntaxError("Unexpected token"))],
    ["a non-array root", () => Promise.resolve({ wordIndex: 0 })],
    ["a non-object entry", () => Promise.resolve([null])],
  ])("reports a present sidecar containing %s", async (_shape, json) => {
    installGsapMock();
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = `<div class="caption-group"><span>Hi</span></div>`;

    applyCaptionOverrides();
    await flushCaptionOverrides();

    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[0]).toContain("caption-overrides.json");
  });

  it("accepts an empty array as the explicit no-op payload", async () => {
    installGsapMock();
    installCaptionOverrideFetch([]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = `<div class="caption-group"><span>Hi</span></div>`;

    applyCaptionOverrides();
    await flushCaptionOverrides();

    expect(error).not.toHaveBeenCalled();
  });

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

/** Mounts one caption word whose stylesheet (rest) colour is `rest`. */
function mountWord(rest: string) {
  document.head.innerHTML = `<style>#w0 { color: ${rest}; }</style>`;
  document.body.innerHTML = `<div class="caption-group"><span id="w0">Hi</span></div>`;
}

const SHIPPED_REST = "rgba(255, 255, 255, 0.55)";

describe("caption colour classification", () => {
  it.each([
    [{ dimColor: "#888", activeColor: "#fff" }, "#fff"],
    [{ dimColor: "#888" }, "#ffffff"],
  ])("lights up a word whose only tween leaves its rest colour, with %o", async (override, lit) => {
    // The shape the shipped caption scripts emit: dim by CSS, one tween to white when spoken.
    const tweens = installGsapMockWithTweens([{ color: "#ffffff" }]);
    installCaptionOverrideFetch([{ wordIndex: 0, ...override }]);
    mountWord(SHIPPED_REST);

    applyCaptionOverrides();
    await flushCaptionOverrides();

    expect(tweens[0].color).toBe(lit);
  });

  it("classifies a return to the rest colour as dim, however the colour is spelled", async () => {
    const tweens = installGsapMockWithTweens([
      { color: "white" },
      { color: "rgba(255,255,255,.55)" },
    ]);
    installCaptionOverrideFetch([{ wordIndex: 0, dimColor: "#888", activeColor: "#0f0" }]);
    mountWord(SHIPPED_REST);

    applyCaptionOverrides();
    await flushCaptionOverrides();

    expect(tweens.map((tw) => tw.color)).toEqual(["#0f0", "#888"]);
  });

  it("lights up a fromTo() from a dim colour into the word's own stylesheet colour", async () => {
    const tweens = installGsapMockWithTweens([{ color: "#fff", startAt: { color: "#444" } }]);
    installCaptionOverrideFetch([{ wordIndex: 0, dimColor: "#888", activeColor: "#0f0" }]);
    mountWord("#fff");

    applyCaptionOverrides();
    await flushCaptionOverrides();

    expect(tweens[0].color).toBe("#0f0");
  });

  it("reads the rest colour past an inline colour GSAP already rendered, and puts that back", async () => {
    const tweens = installGsapMockWithTweens([{ color: "#ffffff" }]);
    installCaptionOverrideFetch([{ wordIndex: 0, activeColor: "#0f0" }]);
    mountWord(SHIPPED_REST);
    document.getElementById("w0")!.style.color = "#ffffff";

    applyCaptionOverrides();
    await flushCaptionOverrides();

    expect(tweens[0].color).toBe("#0f0");
    expect(document.getElementById("w0")!.style.color).toBe("rgb(255, 255, 255)");
  });
});

describe("caption state declaration", () => {
  it("honours a declared state when dim and active colours are IDENTICAL", async () => {
    // Without the declaration both tweens return the word to its rest colour, so both read as dim
    // and `activeColor` is silently dropped.
    const tweens = installGsapMockWithTweens([
      { color: "#888", data: { captionState: "dim" } },
      { color: "#888", data: { captionState: "active" } },
    ]);
    installCaptionOverrideFetch([{ wordIndex: 0, dimColor: "#111", activeColor: "#eee" }]);
    mountWord("#888");

    applyCaptionOverrides();
    await flushCaptionOverrides();

    expect(tweens[0].color).toBe("#111");
    expect(tweens[1].color).toBe("#eee");
  });

  it("invalidates every colour tween on the word, so each re-reads its start from the dimmed word", async () => {
    const tween = (color: string, at: number) => ({
      vars: { color },
      startTime: () => at,
      invalidate: vi.fn(),
    });
    const rendered = [tween("#fff", 0), tween("#222", 1)];
    const gsap = { set() {}, killTweensOf() {}, getTweensOf: () => rendered };
    Object.defineProperty(window, "gsap", { configurable: true, value: gsap });
    installCaptionOverrideFetch([{ wordIndex: 0, dimColor: "#111" }]);
    mountWord("#222");

    applyCaptionOverrides();
    await flushCaptionOverrides();

    expect(rendered.map((tw) => [tw.vars.color, tw.invalidate.mock.calls.length])).toEqual([
      ["#fff", 1],
      ["#111", 1],
    ]);
  });

  it("leaves a from() colour tween as recorded, so it still lights the word up to its own colour", async () => {
    const from = {
      vars: { color: "#444", runBackwards: true },
      startTime: () => 0,
      invalidate: vi.fn(),
    };
    const gsap = { set() {}, killTweensOf() {}, getTweensOf: () => [from] };
    Object.defineProperty(window, "gsap", { configurable: true, value: gsap });
    installCaptionOverrideFetch([{ wordIndex: 0, dimColor: "#888" }]);
    document.body.innerHTML = `<div class="caption-group"><span id="w0">Hi</span></div>`;

    applyCaptionOverrides();
    await flushCaptionOverrides();

    expect(from.invalidate).not.toHaveBeenCalled();
  });

  it("prefers the declaration over the rest colour, per tween, when they disagree", async () => {
    // The first two are the reverse of what the rest colour infers; the third is undeclared.
    const tweens = installGsapMockWithTweens([
      { color: "#222", data: { captionState: "active" } },
      { color: "#fff", data: { captionState: "dim" } },
      { color: "#222" },
    ]);
    installCaptionOverrideFetch([{ wordIndex: 0, dimColor: "#111", activeColor: "#eee" }]);
    mountWord("#222");

    applyCaptionOverrides();
    await flushCaptionOverrides();

    expect(tweens.map((tw) => tw.color)).toEqual(["#eee", "#111", "#111"]);
  });

  it("falls through to the rest colour for a malformed declaration", async () => {
    // A typo, a primitive, or a null must never ship a broken composition — an unrecognised value
    // is not a state, so classification continues as if nothing was declared.
    for (const data of [{ captionState: "typo" }, { captionState: 42 }, null, "notAnObject"]) {
      const tweens = installGsapMockWithTweens([{ color: "#222", data }, { color: "#fff" }]);
      installCaptionOverrideFetch([{ wordIndex: 0, dimColor: "#dim", activeColor: "#active" }]);
      mountWord("#222");

      applyCaptionOverrides();
      await flushCaptionOverrides();

      expect(tweens[0].color).toBe("#dim");
      expect(tweens[1].color).toBe("#active");
    }
  });
});
