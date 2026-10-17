import { afterEach, describe, expect, it, vi } from "vitest";
import { AFTER_FONTS_SCRIPT_TYPE } from "../compiler/scriptRuns";
import { STUDIO_PREVIEW_MARK_META } from "../studioPreviewMark";
import type { RuntimeTimelineLike } from "./types";

function timeline(duration: number, added: Array<[unknown, number | undefined]> = []) {
  let time = 0;
  return {
    play: () => {},
    pause: () => {},
    seek: (t?: number) => (t === undefined ? time : (time = t)),
    totalTime: (t?: number) => (t === undefined ? time : (time = t)),
    time: () => time,
    duration: () => duration,
    add: (child: unknown, at?: number) => void added.push([child, at]),
    paused: () => true,
    timeScale: () => {},
    set: () => {},
    getChildren: () => added.map(([child]) => child),
  } as unknown as RuntimeTimelineLike;
}

// jsdom runs scripts in its own global: each reports through the shared document, and the test
// registers the timeline it would have made.
const sceneScript = (id: string) =>
  `<script type="${AFTER_FONTS_SCRIPT_TYPE}" data-hf-scene="${id}">` +
  `document.body.dataset.ran = (document.body.dataset.ran || "") + "${id} ";` +
  `document.dispatchEvent(new CustomEvent("scene-ran", { detail: "${id}" }));</script>`;

const host = (id: string, start: number, attrs = "", font = "serif") =>
  `<div data-composition-id="${id}" data-hf-scene="${id}" data-start="${start}" data-duration="5"${attrs}><p style="font-family: ${font}">${id}</p></div>`;

// A face per family, each loading until the test settles it.
function serveFonts(...families: string[]) {
  const settle: Record<string, () => void> = {};
  const faces = families.map((family) => {
    const face = { family, status: "loading" as FontFaceLoadStatus, loaded: Promise.resolve() };
    face.loaded = new Promise<void>((done) => {
      settle[family] = () => {
        face.status = "loaded";
        done();
      };
    });
    return face;
  });
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      ready: Promise.all(faces.map((face) => face.loaded)),
      [Symbol.iterator]: () => faces[Symbol.iterator](),
    },
  });
  return settle;
}

async function boot(preview: boolean, fonts = { near: "serif", tied: "serif" }) {
  (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS ??= {};
  globalThis.CSS.escape ??= (v: string) => v;
  if (preview)
    document.head.appendChild(
      Object.assign(document.createElement("meta"), { name: STUDIO_PREVIEW_MARK_META }),
    );
  document.body.innerHTML =
    `<div data-composition-id="main" data-root="true" data-start="0" data-duration="60" data-width="1920" data-height="1080">` +
    host("near", 0, "", fonts.near) +
    host("far", 30) +
    host("tied", 40, ' data-hf-scene-eager="its script uses documentElement"', fonts.tied) +
    host("reached", 50, ' data-hf-scene-eager="a script outside the scene selects .x"') +
    `</div>` +
    ["near", "far", "tied", "reached"].map(sceneScript).join("");
  const added: Array<[unknown, number | undefined]> = [];
  window.__timelines = { main: timeline(60, added) };
  document.addEventListener("scene-ran", (event) => {
    const id = (event as CustomEvent<string>).detail;
    window.__timelines![id] = timeline(5);
  });
  vi.resetModules();
  await import("./entry");
  await vi.waitFor(() => expect(window.__player).toBeDefined());
  return added;
}

const ran = () => document.body.dataset.ran ?? "";

describe("scene scripts held until the playhead nears", () => {
  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    delete document.body.dataset.ran;
    delete document.body.dataset.saw;
    window.__timelines = {};
    delete window.__player;
    delete (document as { fonts?: unknown }).fonts;
    delete (window as { __hyperframeRuntimeBootstrapped?: boolean })
      .__hyperframeRuntimeBootstrapped;
  });

  it("runs a far scene at boot when the compiler kept it eager for a near scene that reads it", async () => {
    (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS ??= {};
    globalThis.CSS.escape ??= (v: string) => v;
    document.head.appendChild(
      Object.assign(document.createElement("meta"), { name: STUDIO_PREVIEW_MARK_META }),
    );
    document.body.innerHTML =
      `<div data-composition-id="main" data-root="true" data-start="0" data-duration="60" data-width="1920" data-height="1080">` +
      host("b", 30, ' data-hf-scene-eager="a reads it"') +
      host("a", 0, ' data-hf-scene-eager="its script names b"') +
      `</div>` +
      sceneScript("b") +
      `<script type="${AFTER_FONTS_SCRIPT_TYPE}" data-hf-scene="a">` +
      `document.body.dataset.saw = String((document.body.dataset.ran || "").includes("b "));</script>`;
    window.__timelines = { main: timeline(60) };
    vi.resetModules();
    await import("./entry");
    await vi.waitFor(() => expect(window.__player).toBeDefined());
    expect(document.body.dataset.saw).toBe("true");
  });

  it("runs a far scene's scripts once a seek comes within the lead, and nests it at its start", async () => {
    const added = await boot(true);
    await window.__hfWaitForSeekCompletion?.();
    expect(ran()).toBe("near reached tied ");

    window.__player!.seek(12);
    await window.__hfWaitForSeekCompletion?.();
    expect(ran()).toBe("near reached tied ");

    window.__player!.seek(25);
    await window.__hfWaitForSeekCompletion?.();
    expect(ran()).toBe("near reached tied far ");
    expect(added).toContainEqual([window.__timelines!.far, 30]);

    window.__player!.seek(31);
    await window.__hfWaitForSeekCompletion?.();
    expect(ran()).toBe("near reached tied far ");
  });

  it("runs a far scene the playback reaches without pausing the clock", async () => {
    await boot(true);
    window.__player!.seek(19.5);
    await window.__hfWaitForSeekCompletion?.();
    // The runtime's own copy: boot reset the module registry.
    const { TransportClock } = await import("./clock");
    const pause = vi.spyOn(TransportClock.prototype, "pause");
    window.__player!.play();
    await vi.waitFor(() => expect(ran()).toContain("far"), { timeout: 3000 });
    await window.__hfWaitForSeekCompletion?.();
    expect(pause).not.toHaveBeenCalled();
    expect(window.__player!.isPlaying()).toBe(true);
    window.__player!.pause();
  });

  it("runs every scene's scripts at boot outside a preview, as a capture does", async () => {
    await boot(false);
    expect(ran()).toBe("near far tied reached ");
  });

  it("boots once the fonts of the near scenes load; a far eager scene runs once every font has", async () => {
    const settle = serveFonts("Near", "Far");
    settle.Near!();
    await boot(true, { near: '"Near", serif', tied: "Far" });
    expect(ran()).toBe("near reached ");

    settle.Far!();
    await vi.waitFor(() => expect(ran()).toBe("near reached tied "));
  });
});
