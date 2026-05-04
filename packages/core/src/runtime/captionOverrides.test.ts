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
