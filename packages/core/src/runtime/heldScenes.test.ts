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
    host(
      "tied",
      40,
      ' data-hf-scene-eager="its script names near" data-hf-scene-after-boot=""',
      fonts.tied,
    ) +
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

/** What the compiler stamps on the chain and writer/reader projects below; htmlBundler.test.ts pins these exact
 * attributes ("keeps the scheduling the runtime tests stamp"). */
const COMPILED = {
  c: ' data-hf-scene-eager="b reads it"',
  b: ' data-hf-scene-eager="its script names c"',
  a: ' data-hf-scene-after-boot="" data-hf-scene-eager="its script names b"',
  w: ' data-hf-scene-eager="its script uses window.tone ="',
  r: "",
  iw: ' data-hf-scene-eager="its script uses __hfReady"',
  ir: ' data-hf-scene-eager="its script uses __hfReady"',
};

/** Boots a preview whose hosts carry `hosts` (id, start, attributes) and whose scene scripts are `scripts`, in order. */
async function bootScenes(hosts: Array<[string, number, string]>, scripts: string) {
  (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS ??= {};
  globalThis.CSS.escape ??= (v: string) => v;
  document.head.appendChild(
    Object.assign(document.createElement("meta"), { name: STUDIO_PREVIEW_MARK_META }),
  );
  document.body.innerHTML =
    `<div data-composition-id="main" data-root="true" data-start="0" data-duration="60" data-width="1920" data-height="1080">` +
    hosts.map(([id, start, attrs]) => host(id, start, attrs)).join("") +
    `</div>` +
    scripts;
  window.__timelines = { main: timeline(60) };
  vi.resetModules();
  await import("./entry");
  await vi.waitFor(() => expect(window.__player).toBeDefined());
  await window.__hfWaitForSeekCompletion?.();
}

const sceneRuns = (id: string, body: string) =>
  `<script type="${AFTER_FONTS_SCRIPT_TYPE}" data-hf-scene="${id}">${body}</script>`;

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

  it.each([0, 10])(
    "runs a nested held scene on its first direct root-time seek, with parent in-point %s",
    async (inPoint) => {
      (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS ??= {};
      globalThis.CSS.escape ??= (v: string) => v;
      document.head.appendChild(
        Object.assign(document.createElement("meta"), { name: STUDIO_PREVIEW_MARK_META }),
      );
      document.body.innerHTML =
        `<div data-composition-id="main" data-root="true" data-start="0" data-duration="60" data-width="1920" data-height="1080">` +
        `<div data-composition-id="group" data-start="20" data-duration="40" data-playback-start="${inPoint}">` +
        host("far", 30) +
        `</div></div>` +
        sceneScript("far");
      window.__timelines = { main: timeline(60) };
      const register = () => {
        window.__timelines!.far = timeline(5);
      };
      document.addEventListener("scene-ran", register);
      try {
        vi.resetModules();
        await import("./entry");
        await vi.waitFor(() => expect(window.__player).toBeDefined());
        expect(ran()).toBe("");
        window.__player!.seek(51 - inPoint);
        await window.__hfWaitForSeekCompletion?.();
        expect(ran()).toBe("far ");
        window.__player!.seek(52 - inPoint);
        await window.__hfWaitForSeekCompletion?.();
        expect(ran()).toBe("far ");
      } finally {
        document.removeEventListener("scene-ran", register);
      }
    },
  );

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
  it("boots a compiler-kept chain in its order, whatever reason first made its middle scene eager", async () => {
    // Hosts c, b, a: a (near) reads b, b reads c (Tai on #5722, 4304295876).
    await bootScenes(
      [
        ["c", 40, COMPILED.c],
        ["b", 30, COMPILED.b],
        ["a", 0, COMPILED.a],
      ],
      sceneScript("c") +
        sceneScript("b") +
        sceneRuns(
          "a",
          `document.body.dataset.saw = String((document.body.dataset.ran || "").includes("b "));`,
        ),
    );
    expect(ran()).toBe("c b ");
    expect(document.body.dataset.saw).toBe("true");
  });

  it("boots a far scene that writes a global before a near scene that reads it, as the page orders them", async () => {
    await bootScenes(
      [
        ["w", 30, COMPILED.w],
        ["r", 0, COMPILED.r],
      ],
      sceneScript("w") +
        sceneRuns(
          "r",
          `document.body.dataset.saw = String((document.body.dataset.ran || "").includes("w "));`,
        ),
    );
    expect(document.body.dataset.saw).toBe("true");
  });
  it("boots a far scene that marks an indexed window before a near scene that reads the mark", async () => {
    await bootScenes(
      [
        ["iw", 50, COMPILED.iw],
        ["ir", 0, COMPILED.ir],
      ],
      sceneRuns("iw", "const refs = [window]; refs[0].__hfReady = 'ready';") +
        sceneRuns("ir", "document.body.dataset.saw = String(window.__hfReady || 'unset');"),
    );
    expect(document.body.dataset.saw).toBe("ready");
  });

  it("holds a far scene when the root composition has no data-start of its own, as authored roots usually don't", async () => {
    (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS ??= {};
    globalThis.CSS.escape ??= (v: string) => v;
    document.head.appendChild(
      Object.assign(document.createElement("meta"), { name: STUDIO_PREVIEW_MARK_META }),
    );
    document.body.innerHTML =
      `<div data-composition-id="main" data-root="true" data-duration="60" data-width="1920" data-height="1080">` +
      host("near", 0) +
      host("far", 30) +
      `</div>` +
      ["near", "far"].map(sceneScript).join("");
    window.__timelines = { main: timeline(60) };
    vi.resetModules();
    await import("./entry");
    await vi.waitFor(() => expect(window.__player).toBeDefined());
    await window.__hfWaitForSeekCompletion?.();
    expect(ran()).toBe("near ");
    window.__player!.seek(25);
    await window.__hfWaitForSeekCompletion?.();
    expect(ran()).toBe("near far ");
  });
});
