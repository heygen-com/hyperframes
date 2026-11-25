import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { STUDIO_REAPPLIED_MARKS, STUDIO_SEEK_REAPPLY_STARTED } from "@hyperframes/core";
import {
  createSealedPreviewSeekReapplyScript,
  createStudioManualEditsRenderBodyScript,
  createStudioPositionSeekReapplyScript,
  htmlHasStudioPositionEdits,
} from "./manualEditsRenderScript";

function runScript(
  window: Window,
  script: string,
  getComputedStyle: typeof window.getComputedStyle = window.getComputedStyle.bind(window),
  timers: {
    setInterval?: typeof globalThis.setInterval;
    clearInterval?: typeof globalThis.clearInterval;
  } = {},
): void {
  const execute = new Function(
    "window",
    "document",
    "HTMLElement",
    "getComputedStyle",
    "setInterval",
    "clearInterval",
    script,
  );
  execute(
    window,
    window.document,
    window.HTMLElement,
    getComputedStyle,
    timers.setInterval ??
      (((callback: TimerHandler) => {
        void callback;
        return 0 as never;
      }) as typeof globalThis.setInterval),
    timers.clearInterval ?? globalThis.clearInterval,
  );
}

describe("createStudioManualEditsRenderBodyScript", () => {
  it("returns null for an empty manifest", () => {
    expect(createStudioManualEditsRenderBodyScript("")).toBeNull();
  });

  it("applies manual edits and reapplies them after render seeks", () => {
    const window = new Window();
    window.document.body.innerHTML = '<div id="card" style="width: 20px; height: 20px"></div>';
    const card = window.document.getElementById("card");
    if (!(card instanceof window.HTMLElement)) {
      throw new Error("card fixture missing");
    }

    let seekCalls = 0;
    (
      window as unknown as {
        __hf: { seek: (time: number) => void };
      }
    ).__hf = {
      seek: () => {
        seekCalls += 1;
        card.style.removeProperty("translate");
      },
    };

    const script = createStudioManualEditsRenderBodyScript(
      JSON.stringify({
        version: 1,
        edits: [
          {
            kind: "path-offset",
            target: { sourceFile: "index.html", id: "card" },
            x: 12,
            y: 24,
          },
          {
            kind: "box-size",
            target: { sourceFile: "index.html", id: "card" },
            width: 120,
            height: 64,
          },
          {
            kind: "rotation",
            target: { sourceFile: "index.html", id: "card" },
            angle: 15,
          },
        ],
      }),
    );
    if (!script) throw new Error("script fixture missing");

    const computedStyle = (element: Element) =>
      ({
        display: element === card ? "block" : "block",
        flexDirection: "row",
      }) as CSSStyleDeclaration;

    const intervalCallbacks: Array<() => void> = [];
    runScript(window, script, computedStyle, {
      setInterval: ((callback: TimerHandler) => {
        if (typeof callback === "function") intervalCallbacks.push(callback as () => void);
        return 0 as never;
      }) as typeof globalThis.setInterval,
    });

    expect(card.style.getPropertyValue("translate")).toContain("--hf-studio-offset-x");
    expect(card.style.getPropertyValue("width")).toBe("120px");
    expect(card.style.getPropertyValue("height")).toBe("64px");
    expect(card.style.getPropertyValue("rotate")).toContain("--hf-studio-rotation");
    expect(card.style.getPropertyValue("transform-origin")).toBe("center center");

    (
      window as unknown as {
        __hf: { seek: (time: number) => void };
      }
    ).__hf.seek(1);

    expect(seekCalls).toBe(1);
    expect(card.style.getPropertyValue("translate")).toContain("--hf-studio-offset-x");

    (
      window as unknown as {
        __hf: { seek: (time: number) => void };
      }
    ).__hf.seek = () => {
      card.style.removeProperty("rotate");
    };
    intervalCallbacks.forEach((callback) => callback());
    (
      window as unknown as {
        __hf: { seek: (time: number) => void };
      }
    ).__hf.seek(2);
    expect(card.style.getPropertyValue("rotate")).toContain("--hf-studio-rotation");

    (
      window as unknown as {
        __player: { renderSeek: (time: number) => void };
      }
    ).__player = {
      renderSeek: () => {
        card.style.removeProperty("rotate");
      },
    };
    intervalCallbacks.forEach((callback) => callback());
    (
      window as unknown as {
        __player: { renderSeek: (time: number) => void };
      }
    ).__player.renderSeek(3);
    expect(card.style.getPropertyValue("rotate")).toContain("--hf-studio-rotation");
  });

  it("applies render edits to the matching source file target", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <div data-composition-id="root">
        <div id="card"></div>
        <div data-composition-id="nested" data-composition-file="scenes/nested.html">
          <div id="card"></div>
        </div>
      </div>
    `;
    const cards = Array.from(window.document.getElementsByTagName("*")).filter(
      (element): element is HTMLElement =>
        element instanceof window.HTMLElement && element.id === "card",
    );
    const rootCard = cards[0];
    const nestedCard = cards[1];
    if (!rootCard || !nestedCard) {
      throw new Error("source-scoped render fixture missing");
    }

    const script = createStudioManualEditsRenderBodyScript(
      JSON.stringify({
        version: 1,
        edits: [
          {
            kind: "rotation",
            target: { sourceFile: "scenes/nested.html", id: "card" },
            angle: 21,
          },
        ],
      }),
    );
    if (!script) throw new Error("script fixture missing");

    runScript(window, script);

    expect(rootCard.style.getPropertyValue("rotate")).toBe("");
    expect(nestedCard.style.getPropertyValue("rotate")).toContain("--hf-studio-rotation");
  });

  it("applies render edits inside composition-file hosts without composition ids", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <div data-composition-id="root">
        <div id="card"></div>
        <div data-composition-file="scenes/anonymous.html">
          <div id="card"></div>
        </div>
      </div>
    `;
    const cards = Array.from(window.document.getElementsByTagName("*")).filter(
      (element): element is HTMLElement =>
        element instanceof window.HTMLElement && element.id === "card",
    );
    const rootCard = cards[0];
    const nestedCard = cards[1];
    if (!rootCard || !nestedCard) {
      throw new Error("anonymous composition render fixture missing");
    }

    const script = createStudioManualEditsRenderBodyScript(
      JSON.stringify({
        version: 1,
        edits: [
          {
            kind: "path-offset",
            target: { sourceFile: "scenes/anonymous.html", id: "card" },
            x: 12,
            y: 24,
          },
        ],
      }),
    );
    if (!script) throw new Error("script fixture missing");

    runScript(window, script);

    expect(rootCard.style.getPropertyValue("translate")).toBe("");
    expect(nestedCard.style.getPropertyValue("translate")).toContain("--hf-studio-offset-x");
  });

  it("uses the active composition path as the unscoped document fallback", () => {
    const window = new Window();
    window.document.body.innerHTML = `<div id="card"></div>`;
    const card = window.document.getElementById("card");
    if (!(card instanceof window.HTMLElement)) {
      throw new Error("card fixture missing");
    }

    const script = createStudioManualEditsRenderBodyScript(
      JSON.stringify({
        version: 1,
        edits: [
          {
            kind: "path-offset",
            target: { sourceFile: "compositions/scene-2.html", id: "card" },
            x: 12,
            y: 24,
          },
        ],
      }),
      { activeCompositionPath: "compositions/scene-2.html" },
    );
    if (!script) throw new Error("script fixture missing");

    runScript(window, script);

    expect(card.style.getPropertyValue("translate")).toContain("--hf-studio-offset-x");
  });

  it("preserves computed transform longhands as render edit bases", () => {
    const window = new Window();
    window.document.body.innerHTML = `<div id="card"></div>`;
    const card = window.document.getElementById("card");
    if (!(card instanceof window.HTMLElement)) {
      throw new Error("card fixture missing");
    }

    const script = createStudioManualEditsRenderBodyScript(
      JSON.stringify({
        version: 1,
        edits: [
          {
            kind: "path-offset",
            target: { sourceFile: "index.html", id: "card" },
            x: 12,
            y: 24,
          },
          {
            kind: "rotation",
            target: { sourceFile: "index.html", id: "card" },
            angle: 15,
          },
        ],
      }),
    );
    if (!script) throw new Error("script fixture missing");

    const computedStyle = (element: Element) =>
      ({
        getPropertyValue: (property: string) => {
          if (element !== card) return "";
          if (property === "translate") return "10px 20px";
          if (property === "rotate") return "8deg";
          return "";
        },
      }) as CSSStyleDeclaration;

    runScript(window, script, computedStyle);

    expect(card.style.getPropertyValue("translate")).toContain("calc(10px +");
    expect(card.style.getPropertyValue("translate")).toContain("calc(20px +");
    expect(card.style.getPropertyValue("rotate")).toContain("8deg");
    expect(card.style.getPropertyValue("rotate")).toContain("--hf-studio-rotation");
    expect(card.style.getPropertyValue("transform-origin")).toBe("center center");
  });

  it("does not compound stale studio variables during render reapply", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <div id="card" style="
        translate: var(--hf-studio-offset-x, 0px) var(--hf-studio-offset-y, 0px);
        rotate: var(--hf-studio-rotation, 0deg);
      "></div>
    `;
    const card = window.document.getElementById("card");
    if (!(card instanceof window.HTMLElement)) {
      throw new Error("card fixture missing");
    }

    const script = createStudioManualEditsRenderBodyScript(
      JSON.stringify({
        version: 1,
        edits: [
          {
            kind: "path-offset",
            target: { sourceFile: "index.html", id: "card" },
            x: 12,
            y: 24,
          },
          {
            kind: "rotation",
            target: { sourceFile: "index.html", id: "card" },
            angle: 15,
          },
        ],
      }),
    );
    if (!script) throw new Error("script fixture missing");

    runScript(window, script);

    expect(card.style.getPropertyValue("translate")).toBe(
      "var(--hf-studio-offset-x, 0px) var(--hf-studio-offset-y, 0px)",
    );
    expect(card.style.getPropertyValue("rotate")).toBe("var(--hf-studio-rotation, 0deg)");
  });

  it("exposes a render reapply hook for thumbnails after layout settles", () => {
    const window = new Window();
    window.document.body.innerHTML = `<div id="card"></div>`;
    const card = window.document.getElementById("card");
    if (!(card instanceof window.HTMLElement)) {
      throw new Error("card fixture missing");
    }

    const script = createStudioManualEditsRenderBodyScript(
      JSON.stringify({
        version: 1,
        edits: [
          {
            kind: "path-offset",
            target: { sourceFile: "index.html", id: "card" },
            x: 12,
            y: 24,
          },
        ],
      }),
    );
    if (!script) throw new Error("script fixture missing");

    runScript(window, script);
    card.style.removeProperty("translate");

    (
      window as unknown as {
        __hfStudioManualEditsApply?: () => number;
      }
    ).__hfStudioManualEditsApply?.();

    expect(card.style.getPropertyValue("translate")).toContain("--hf-studio-offset-x");
  });
});

describe("createStudioPositionSeekReapplyScript", () => {
  function runPositionScript(
    window: Window,
    timers: {
      setInterval?: typeof globalThis.setInterval;
      clearInterval?: typeof globalThis.clearInterval;
      script?: string;
    } = {},
  ): void {
    Object.assign(window, { SyntaxError });
    const script = timers.script ?? createStudioPositionSeekReapplyScript();
    const execute = new Function(
      "window",
      "document",
      "HTMLElement",
      "DOMMatrix",
      "setInterval",
      "clearInterval",
      script,
    );
    execute(
      window,
      window.document,
      window.HTMLElement,
      globalThis.DOMMatrix,
      timers.setInterval ??
        (((callback: TimerHandler) => {
          void callback;
          return 0 as never;
        }) as typeof globalThis.setInterval),
      timers.clearInterval ?? globalThis.clearInterval,
    );
  }

  /** A sized card whose seeks clear its size, as a GSAP width tween does. */
  function sizedCard(window: Window) {
    window.document.body.innerHTML = `
      <div id="card"
        data-hf-studio-box-size="true"
        style="--hf-studio-width: 200px; --hf-studio-height: 100px; width: 200px; height: 100px">
      </div>
    `;
    const card = window.document.getElementById("card") as unknown as HTMLElement;
    return { card, clear: () => card.style.removeProperty("width") };
  }

  it("starts, says so, and is served on a page with any one of core's reapplied marks only", () => {
    const startsOn = (markup: string) => {
      const window = new Window();
      window.document.body.innerHTML = markup;
      const seek = () => {};
      const hf = { seek };
      (window as unknown as { __hf: typeof hf }).__hf = hf;
      runPositionScript(window);
      const said = (window as unknown as Record<string, unknown>)[STUDIO_SEEK_REAPPLY_STARTED];
      return [hf.seek !== seek, said === true];
    };
    const plain = '<div data-hf-studio-original-inline-translate=""></div>';
    expect([...startsOn(plain), htmlHasStudioPositionEdits(plain)]).toEqual([false, false, false]);
    for (const { name, value } of STUDIO_REAPPLIED_MARKS) {
      const marked = `<div ${name}="${value ?? "{}"}"></div>`;
      expect([...startsOn(marked), htmlHasStudioPositionEdits(marked)], name).toEqual([
        true,
        true,
        true,
      ]);
    }
  });

  // fails without the fix: a single-quoted mark got no script, so a seek undid the edit.
  it("finds a reapplied mark in any attribute quoting, and no near miss", () => {
    const found = (attr: string) => htmlHasStudioPositionEdits(`<div id="a" ${attr}></div>`);
    for (const attr of [
      "data-hf-studio-rotation='true'",
      "data-hf-studio-box-size=true",
      'DATA-HF-STUDIO-PATH-OFFSET = "true"',
      "data-hf-studio-motion='{}'",
    ])
      expect(found(attr), attr).toBe(true);
    for (const attr of [
      'data-hf-studio-rotation="false"',
      'data-hf-studio-box-size="truey"',
      'data-hf-studio-motion-original-opacity="1"',
      'xdata-hf-studio-rotation="true"',
      'data-hf-studio-rotation="TRUE"',
    ])
      expect(found(attr), attr).toBe(false);
  });

  it("hands every argument to the seek it wraps", () => {
    const window = new Window();
    sizedCard(window);
    const calls: unknown[][] = [];
    const hf = { seek: (...args: unknown[]) => void calls.push(args) };
    (window as unknown as { __hf: typeof hf }).__hf = hf;

    runPositionScript(window);
    hf.seek(1, { suppressEvents: true });
    expect(calls).toEqual([[1, { suppressEvents: true }]]);
  });

  /** The sealed preview script in a frame whose parent is `parent`; frames run when `drawFrame` is called. */
  function sealedPreview(parent: unknown) {
    const window = new Window();
    const { card, clear } = sizedCard(window);
    if (parent) Object.defineProperty(window, "parent", { value: parent });
    const frames: Array<() => void> = [];
    const player = { time: 0, getTime: () => player.time };
    const main = { at: 0, totalTime: () => main.at };
    const hf = { redraws: 0 };
    Object.assign(window, {
      __hf: hf,
      __player: player,
      __timelines: { main },
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      setTimeout: (callback: () => void) => callback(),
    });
    runPositionScript(window, { script: createSealedPreviewSeekReapplyScript() });
    const drawFrame = () => frames.splice(0).forEach((callback) => callback());
    return { card, clear, player, main, hf, frames, drawFrame };
  }
  const SEALED = {
    get document(): never {
      throw new Error("SecurityError");
    },
  };

  it("puts a sealed preview's edits back on the frame its player or a timeline moved, whatever moved it", () => {
    const { card, clear, player, main, drawFrame } = sealedPreview(SEALED);
    drawFrame();
    player.time = 2;
    clear();
    drawFrame();
    expect(card.style.getPropertyValue("width")).toBe("200px");
    main.at = 2.5;
    clear();
    drawFrame();
    expect(card.style.getPropertyValue("width")).toBe("200px");
  });

  it("puts a sealed preview's edits back after the runtime redraws at the time it already shows", () => {
    const { card, clear, hf, drawFrame } = sealedPreview(SEALED);
    drawFrame();
    hf.redraws += 1;
    clear();
    drawFrame();
    expect(card.style.getPropertyValue("width")).toBe("200px");
  });

  it("does no work on a frame where nothing moved, so a paused preview leaves a gesture's draft alone", () => {
    const { card, clear, drawFrame } = sealedPreview(SEALED);
    drawFrame();
    clear();
    card.style.setProperty("width", "260px");
    drawFrame();
    drawFrame();
    expect(card.style.getPropertyValue("width")).toBe("260px");
  });

  /** The sealed preview script in a sealed frame whose page loaded with no Studio edit. */
  function unmarkedSealedPreview() {
    const window = new Window();
    window.document.body.innerHTML = '<div id="card"></div>';
    const card = window.document.getElementById("card") as unknown as HTMLElement;
    Object.defineProperty(window, "parent", { value: SEALED });
    const frames: Array<() => void> = [];
    const player = { time: 0, getTime: () => player.time };
    const built: unknown[] = [];
    const gsap = {
      timeline: () => ({ fromTo: (el: unknown) => void built.push(el), totalTime: () => {} }),
    };
    Object.assign(window, {
      __hf: {},
      __player: player,
      __timelines: {},
      gsap,
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      setTimeout: (callback: () => void) => callback(),
    });
    runPositionScript(window, { script: createSealedPreviewSeekReapplyScript() });
    const moveFrame = () => {
      player.time += 1;
      frames.splice(0).forEach((callback) => callback());
    };
    return { window, card, built, moveFrame };
  }

  // fails without the fix: a sealed page loaded with no Studio edit never started its reapply, so the frame refused the
  // first undo or redo that added one (restore-attributes needs a started reapply) and reloaded instead.
  it.each([
    ["box-size", ["data-hf-studio-box-size", "true"], "--hf-studio-width: 200px"],
    ["rotation", ["data-hf-studio-rotation", "true"], "--hf-studio-rotation: 30deg"],
    ["path-offset", ["data-hf-studio-path-offset", "true"], "--hf-studio-offset-x: 10px"],
    ["motion", ["data-hf-studio-motion", '{"start":0,"duration":1,"to":{"x":10}}'], ""],
  ] as const)(
    "keeps a %s mark a restore adds to a sealed page that loaded with none",
    (mark, [name, value], style) => {
      const { window, card, built, moveFrame } = unmarkedSealedPreview();
      expect((window as unknown as Record<string, unknown>)[STUDIO_SEEK_REAPPLY_STARTED]).toBe(
        true,
      );
      card.setAttribute(name, value);
      if (style) card.setAttribute("style", style);
      moveFrame();
      const kept = {
        "box-size": () => card.style.getPropertyValue("width") === "200px",
        rotation: () => card.style.getPropertyValue("rotate").includes("--hf-studio-rotation"),
        "path-offset": () =>
          card.style.getPropertyValue("translate").includes("--hf-studio-offset-x"),
        motion: () => built.includes(card),
      }[mark];
      expect(kept()).toBe(true);
    },
  );

  it("follows no frames in a preview Studio can script, nor in a page with no parent", () => {
    expect(sealedPreview({ document: {} }).frames).toHaveLength(0);
    expect(sealedPreview(null).frames).toHaveLength(0);
    expect(sealedPreview(SEALED).frames).toHaveLength(1);
  });

  it("reapplies box-size after seek", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <div id="card"
        data-hf-studio-box-size="true"
        style="--hf-studio-width: 200px; --hf-studio-height: 100px; width: 200px; height: 100px">
      </div>
    `;
    const card = window.document.getElementById("card") as unknown as HTMLElement;

    const originalSeek = () => {
      card.style.removeProperty("width");
      card.style.removeProperty("height");
    };
    (window as unknown as { __hf: Record<string, unknown> }).__hf = { seek: originalSeek };

    runPositionScript(window);
    const wrappedSeek = (window as unknown as { __hf: { seek: (t: number) => void } }).__hf.seek;
    wrappedSeek(1);

    expect(card.style.getPropertyValue("width")).toBe("200px");
    expect(card.style.getPropertyValue("height")).toBe("100px");
  });

  it("strips GSAP translate from transform after reapplying path offset", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <div id="card"
        data-hf-studio-path-offset="true"
        data-hf-studio-original-translate=""
        style="--hf-studio-offset-x: 50px; --hf-studio-offset-y: 30px; translate: var(--hf-studio-offset-x, 0px) var(--hf-studio-offset-y, 0px)">
      </div>
    `;
    const card = window.document.getElementById("card") as unknown as HTMLElement;

    const originalSeek = () => {
      card.style.setProperty("transform", "matrix(1, 0, 0, 1, 120, 60)");
    };
    (window as unknown as { __hf: Record<string, unknown> }).__hf = { seek: originalSeek };

    runPositionScript(window);
    const wrappedSeek = (window as unknown as { __hf: { seek: (t: number) => void } }).__hf.seek;
    wrappedSeek(1);

    expect(card.style.getPropertyValue("translate")).toContain("--hf-studio-offset-x");
    const transform = card.style.getPropertyValue("transform");
    if (transform && transform !== "none") {
      const m = new DOMMatrix(transform);
      expect(m.m41).toBe(0);
      expect(m.m42).toBe(0);
    }
  });

  it("preserves non-translate components when stripping GSAP transform", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <div id="card"
        data-hf-studio-path-offset="true"
        data-hf-studio-original-translate=""
        style="--hf-studio-offset-x: 10px; --hf-studio-offset-y: 20px; translate: var(--hf-studio-offset-x, 0px) var(--hf-studio-offset-y, 0px)">
      </div>
    `;
    const card = window.document.getElementById("card") as unknown as HTMLElement;

    const originalSeek = () => {
      card.style.setProperty("transform", "matrix(0.5, 0, 0, 0.5, 80, 40)");
    };
    (window as unknown as { __hf: Record<string, unknown> }).__hf = { seek: originalSeek };

    runPositionScript(window);
    const wrappedSeek = (window as unknown as { __hf: { seek: (t: number) => void } }).__hf.seek;
    wrappedSeek(1);

    const transform = card.style.getPropertyValue("transform");
    expect(transform).toBeTruthy();
    expect(transform).not.toContain("80");
    expect(transform).not.toContain("40");
  });

  it("removes transform entirely when it becomes identity after stripping translate", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <div id="card"
        data-hf-studio-path-offset="true"
        data-hf-studio-original-translate=""
        style="--hf-studio-offset-x: 10px; --hf-studio-offset-y: 20px; translate: var(--hf-studio-offset-x, 0px) var(--hf-studio-offset-y, 0px)">
      </div>
    `;
    const card = window.document.getElementById("card") as unknown as HTMLElement;

    const originalSeek = () => {
      card.style.setProperty("transform", "matrix(1, 0, 0, 1, 50, 25)");
    };
    (window as unknown as { __hf: Record<string, unknown> }).__hf = { seek: originalSeek };

    runPositionScript(window);
    const wrappedSeek = (window as unknown as { __hf: { seek: (t: number) => void } }).__hf.seek;
    wrappedSeek(1);

    const transform = card.style.getPropertyValue("transform");
    expect(!transform || transform === "none" || transform === "").toBe(true);
  });

  it("no-ops when transform is 'none'", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <div id="card"
        data-hf-studio-path-offset="true"
        data-hf-studio-original-translate=""
        style="--hf-studio-offset-x: 10px; --hf-studio-offset-y: 20px; translate: var(--hf-studio-offset-x, 0px) var(--hf-studio-offset-y, 0px); transform: none">
      </div>
    `;
    const card = window.document.getElementById("card") as unknown as HTMLElement;

    (window as unknown as { __hf: Record<string, unknown> }).__hf = { seek: () => {} };
    runPositionScript(window);

    expect(card.style.getPropertyValue("transform")).toBe("none");
  });

  it("strips GSAP translate for rotation-only elements", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <div id="card"
        data-hf-studio-rotation="true"
        data-hf-studio-original-rotate=""
        style="--hf-studio-rotation: 45deg; rotate: var(--hf-studio-rotation, 0deg)">
      </div>
    `;
    const card = window.document.getElementById("card") as unknown as HTMLElement;

    const originalSeek = () => {
      card.style.setProperty("transform", "matrix(1, 0, 0, 1, 100, 50)");
    };
    (window as unknown as { __hf: Record<string, unknown> }).__hf = { seek: originalSeek };

    runPositionScript(window);
    const wrappedSeek = (window as unknown as { __hf: { seek: (t: number) => void } }).__hf.seek;
    wrappedSeek(1);

    expect(card.style.getPropertyValue("rotate")).toContain("--hf-studio-rotation");
    const transform = card.style.getPropertyValue("transform");
    expect(!transform || transform === "none" || transform === "").toBe(true);
  });
});
