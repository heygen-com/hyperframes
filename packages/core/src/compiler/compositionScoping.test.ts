import { describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { scopeCssToComposition, wrapScopedCompositionScript } from "./compositionScoping";

describe("composition scoping", () => {
  it("scopes regular selectors while preserving global at-rules", () => {
    const scoped = scopeCssToComposition(
      `
@import url("https://example.com/font.css");
.title, .card:hover { opacity: 0; }
@media (min-width: 800px) {
  .title { transform: translateY(30px); }
}
@keyframes rise {
  from { opacity: 0; }
  to { opacity: 1; }
}
[data-composition-id="scene"] .already { color: red; }
body { margin: 0; }
`,
      "scene",
    );

    expect(scoped).toContain('@import url("https://example.com/font.css");');
    expect(scoped).toContain(
      '[data-composition-id="scene"] .title, [data-composition-id="scene"] .card:hover',
    );
    expect(scoped).toContain('[data-composition-id="scene"] .title { transform');
    expect(scoped).toContain("@keyframes rise");
    expect(scoped).toContain("from { opacity: 0; }");
    expect(scoped).toContain('[data-composition-id="scene"] .already { color: red; }');
    expect(scoped).toContain("body { margin: 0; }");
  });

  it("wraps classic scripts without render-loop requestAnimationFrame waits", () => {
    const wrapped = wrapScopedCompositionScript("window.__ran = true;", "scene");

    expect(wrapped).toContain('var __hfCompId = "scene";');
    expect(wrapped).toContain("new Proxy(window.document");
    expect(wrapped).toContain("new Proxy(__hfBaseGsap");
    expect(wrapped).not.toContain("requestAnimationFrame");
  });

  it("normalizes root timing attributes when scoping selectors", () => {
    const scoped = scopeCssToComposition(
      '[data-composition-id="scene"][data-start="0"] .title { opacity: 0; }',
      "scene",
    );

    expect(scoped).toContain('[data-composition-id="scene"] .title { opacity: 0; }');
    expect(scoped).not.toContain('[data-start="0"]');
  });

  it("executes document and GSAP selectors inside the composition root", () => {
    const { document } = parseHTML(`
      <div data-composition-id="scene" data-start="intro"><h1 class="title">Scene</h1></div>
      <div data-composition-id="other"><h1 class="title">Other</h1></div>
    `);
    const gsapTargets: string[][] = [];
    const fakeWindow = {
      document,
      __selectedTitle: "",
      __selectedRootTitle: "",
      __timelines: {},
      gsap: {
        timeline: () => ({
          to(targets: Element[]) {
            gsapTargets.push(Array.from(targets).map((target) => target.textContent || ""));
            return this;
          },
        }),
      },
    };
    const wrapped = wrapScopedCompositionScript(
      `
const tl = gsap.timeline({ paused: true });
tl.to('.title', { opacity: 1 });
tl.to('[data-composition-id="scene"][data-start="0"] .title', { opacity: 1 });
window.__selectedTitle = document.querySelector('.title')?.textContent || '';
window.__selectedRootTitle = document.querySelector('[data-composition-id="scene"][data-start="0"] .title')?.textContent || '';
window.__timelines.scene = tl;
`,
      "scene",
    );

    new Function("window", "gsap", wrapped)(fakeWindow, fakeWindow.gsap);

    expect(fakeWindow.__selectedTitle).toBe("Scene");
    expect(fakeWindow.__selectedRootTitle).toBe("Scene");
    expect(gsapTargets).toEqual([["Scene"], ["Scene"]]);
  });

  it("reads scoped proxy accessors with the original target receiver", () => {
    const root = {
      contains(node: unknown) {
        return node === root;
      },
    };
    const body = { tagName: "BODY" };
    const fakeDocument = {
      querySelector(selector: string) {
        return selector === '[data-composition-id="scene"]' ? root : null;
      },
      querySelectorAll() {
        return [];
      },
      getElementById() {
        return null;
      },
      get body() {
        if (this !== fakeDocument) {
          throw new TypeError("Illegal invocation");
        }
        return body;
      },
    };
    const location = { href: "https://example.test/scene" };
    const fakeUtils = {
      get marker() {
        if (this !== fakeUtils) {
          throw new TypeError("Illegal invocation");
        }
        return "utils-ok";
      },
    };
    const fakeGsap = {
      utils: fakeUtils,
      get version() {
        if (this !== fakeGsap) {
          throw new TypeError("Illegal invocation");
        }
        return "gsap-ok";
      },
    };
    const fakeWindow = {
      document: fakeDocument,
      __bodyTag: "",
      __href: "",
      __windowSet: "",
      __gsapVersion: "",
      __utilsMarker: "",
      __timelines: {},
      gsap: fakeGsap,
      get location() {
        if (this !== fakeWindow) {
          throw new TypeError("Illegal invocation");
        }
        return location;
      },
      set customValue(value: string) {
        if (this !== fakeWindow) {
          throw new TypeError("Illegal invocation");
        }
        this.__windowSet = value;
      },
    };
    const wrapped = wrapScopedCompositionScript(
      `
window.__bodyTag = document.body.tagName;
window.__href = window.location.href;
window.customValue = "window-set-ok";
window.__gsapVersion = gsap.version;
window.__utilsMarker = gsap.utils.marker;
`,
      "scene",
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      new Function("window", "gsap", wrapped)(fakeWindow, fakeWindow.gsap);
    } finally {
      errorSpy.mockRestore();
    }

    expect(fakeWindow.__bodyTag).toBe("BODY");
    expect(fakeWindow.__href).toBe("https://example.test/scene");
    expect(fakeWindow.__windowSet).toBe("window-set-ok");
    expect(fakeWindow.__gsapVersion).toBe("gsap-ok");
    expect(fakeWindow.__utilsMarker).toBe("utils-ok");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("reads remapped timeline registry accessors with the original target receiver", () => {
    let timeline = "initial";
    const timelineRegistry = {
      get host() {
        if (this !== timelineRegistry) {
          throw new TypeError("Illegal invocation");
        }
        return timeline;
      },
      set host(value: string) {
        if (this !== timelineRegistry) {
          throw new TypeError("Illegal invocation");
        }
        timeline = value;
      },
    };
    const fakeWindow = {
      document: {
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
      },
      __timelines: timelineRegistry,
      __beforeTimeline: "",
      __afterTimeline: "",
      gsap: {},
    };
    const wrapped = wrapScopedCompositionScript(
      `
window.__beforeTimeline = window.__timelines.scene;
window.__timelines.scene = "updated";
window.__afterTimeline = window.__timelines.scene;
`,
      "scene",
      "[HyperFrames] composition script error:",
      undefined,
      "host",
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      new Function("window", "gsap", wrapped)(fakeWindow, fakeWindow.gsap);
    } finally {
      errorSpy.mockRestore();
    }

    expect(fakeWindow.__beforeTimeline).toBe("initial");
    expect(fakeWindow.__afterTimeline).toBe("updated");
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
