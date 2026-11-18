// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "layout-audit.browser.js"),
  "utf-8",
);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Candidate {
  selector: string;
  dataAttributes: Record<string, string>;
  sourceFile: string;
  text: string;
  wordRects: Box[];
  video: {
    selector: string;
    src: string;
    mediaTime: number;
    box: Box;
    frame: Box;
    flipX: boolean;
    flipY: boolean;
  };
}

interface VideoSpec {
  box?: Box;
  /** Alpha (0-255) of its decoded frame; a frame with any clear pixel is a cutout. */
  alpha?: number;
  style?: Record<string, string>;
  readyState?: number;
}

interface Word {
  word: string;
  x: number;
  width: number;
}

interface Scene {
  /** Words of the one text element (#title), all on one line. */
  words?: Word[];
  titleAttrs?: string;
  wrapperAttrs?: string;
  titleStyle?: Record<string, string>;
  videos?: Record<string, VideoSpec>;
  /** Ids of opaque panels. */
  panels?: string[];
  /** Ids painted at a point, topmost first; "title" is the text. */
  stack?: (x: number) => string[];
}

// A 9:16 canvas; every video decodes a 192x108 (16:9) frame.
const CANVAS: Box = { x: 0, y: 0, width: 1080, height: 1920 };
const SOURCE = { width: 192, height: 108 };
const WORD_Y = 800;
const WORD_HEIGHT = 100;
const HELLO = [{ word: "HELLO", x: 400, width: 200 }];
const PANEL_STYLE = { backgroundColor: "rgb(10, 10, 10)" };

const BASE_STYLE: Record<string, string> = {
  display: "block",
  visibility: "visible",
  opacity: "1",
  overflow: "visible",
  overflowX: "visible",
  overflowY: "visible",
  backgroundColor: "rgba(0, 0, 0, 0)",
  backgroundImage: "none",
  objectFit: "fill",
  objectPosition: "50% 50%",
  fontSize: "36px",
};

function domRect({ x, y, width, height }: Box): DOMRect {
  return {
    left: x,
    top: y,
    width,
    height,
    right: x + width,
    bottom: y + height,
    x,
    y,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

const byId = (id: string) => document.getElementById(id) as HTMLElement;

function installVideos(videos: Record<string, VideoSpec>): void {
  for (const [id, spec] of Object.entries(videos)) {
    const video = byId(id);
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: SOURCE.width },
      videoHeight: { configurable: true, value: SOURCE.height },
      readyState: { configurable: true, value: spec.readyState ?? 4 },
      seeking: { configurable: true, value: false },
      currentTime: { configurable: true, value: 2.5 },
      currentSrc: { configurable: true, value: `http://127.0.0.1:4000/takes/${id}.mp4` },
    });
    vi.spyOn(video, "getBoundingClientRect").mockReturnValue(domRect(spec.box ?? CANVAS));
  }
}

// Range boxes for #title: every word for a whole-node range, one word for a word's own range.
function installTitleRanges(words: Word[]): void {
  const boxes = (picked: Word[]) =>
    picked.map(({ x, width }) =>
      domRect({ x, y: WORD_Y, width, height: WORD_HEIGHT }),
    ) as unknown as DOMRectList;
  vi.spyOn(document, "createRange").mockImplementation(() => {
    let node: Node | null = null;
    let range: [number, number] | null = null;
    return {
      selectNodeContents(selected: Node) {
        node = selected;
      },
      setStart(selected: Node, offset: number) {
        node = selected;
        range = [offset, offset];
      },
      setEnd(_selected: Node, offset: number) {
        range = [range ? range[0] : 0, offset];
      },
      getClientRects() {
        if (node?.parentElement?.id !== "title") return boxes([]);
        if (!range) return boxes(words);
        const text = (node.textContent ?? "").slice(range[0], range[1]);
        return boxes(words.filter(({ word }) => word === text));
      },
      detach() {},
    } as unknown as Range;
  });
}

// Each video's decoded frame is opaque except, for a cutout, one clear corner pixel.
function installFrames(videos: Record<string, VideoSpec>): ReturnType<typeof vi.fn> {
  let drawn = "";
  const getImageData = vi.fn((_x: number, _y: number, width: number, height: number) => {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    data[3] = videos[drawn]?.alpha ?? 255;
    return { data };
  });
  // getContext's overloads resolve to the WebGPU one; the audit only asks for "2d".
  const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext") as unknown as {
    mockReturnValue(value: CanvasRenderingContext2D): void;
  };
  getContextSpy.mockReturnValue({
    clearRect() {},
    drawImage(source: Element) {
      drawn = source.id;
    },
    getImageData,
  } as unknown as CanvasRenderingContext2D);
  return getImageData;
}

function installScene(scene: Scene): { getImageData: ReturnType<typeof vi.fn> } {
  const words = scene.words ?? HELLO;
  const videos = scene.videos ?? { take: {} };
  const panels = scene.panels ?? [];
  const tags = [
    ...Object.keys(videos).map((id) => `<video id="${id}"></video>`),
    ...panels.map((id) => `<div id="${id}"></div>`),
  ];
  document.body.innerHTML = `
    <div id="root" data-composition-id="main" data-width="1080" data-height="1920">
      ${tags.join("")}
      <div id="wrapper" ${scene.wrapperAttrs ?? ""}><span id="title" ${scene.titleAttrs ?? ""}>${words
        .map(({ word }) => word)
        .join(" ")}</span></div>
    </div>`;

  for (const element of Array.from(document.querySelectorAll("*"))) {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(domRect(CANVAS));
  }
  installVideos(videos);
  const styles = new Map<Element, Record<string, string>>([
    [byId("title"), scene.titleStyle ?? {}],
    ...panels.map((id): [Element, Record<string, string>] => [byId(id), PANEL_STYLE]),
    ...Object.entries(videos).map(([id, spec]): [Element, Record<string, string>] => [
      byId(id),
      spec.style ?? {},
    ]),
  ]);
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (element) => ({ ...BASE_STYLE, ...styles.get(element) }) as unknown as CSSStyleDeclaration,
  );
  installTitleRanges(words);

  const stack = scene.stack ?? (() => ["title", ...Object.keys(videos)]);
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: (x: number) => [...stack(x).map(byId), byId("wrapper"), byId("root")],
  });

  const getImageData = installFrames(videos);
  window.eval(script);
  return { getImageData };
}

interface AuditWindow {
  __hyperframesLayoutAudit(options: { time: number; tolerance: number }): unknown[];
  __hyperframesTextOverVideo(options: { time: number }): Candidate[];
}

function textOverVideo(time = 1, askedTime = time): Candidate[] {
  const page = window as unknown as AuditWindow;
  page.__hyperframesLayoutAudit({ time, tolerance: 2 });
  return page.__hyperframesTextOverVideo({ time: askedTime });
}

const CUTOUT: VideoSpec = { alpha: 0 };

describe("layout-audit.browser text in front of a <video>", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    Reflect.deleteProperty(document, "elementsFromPoint");
    Reflect.deleteProperty(window, "__hyperframesLayoutAudit");
    Reflect.deleteProperty(window, "__hyperframesTextOverVideo");
  });

  it("reports text painted above an opaque video with its word boxes and the video's state", () => {
    installScene({ titleAttrs: 'data-layer-id="promo"' });
    expect(textOverVideo()).toEqual([
      {
        selector: "#title",
        dataAttributes: { "data-layer-id": "promo" },
        sourceFile: "index.html",
        text: "HELLO",
        rect: expect.objectContaining({ left: 400, top: 800, width: 200, height: 100 }),
        wordRects: [{ x: 400, y: 800, width: 200, height: 100 }],
        video: {
          selector: "#take",
          src: "http://127.0.0.1:4000/takes/take.mp4",
          mediaTime: 2.5,
          box: CANVAS,
          frame: CANVAS,
          flipX: false,
          flipY: false,
        },
      },
    ]);
  });

  it("gives one box per word", () => {
    installScene({
      words: [
        { word: "15%", x: 300, width: 150 },
        { word: "OFF", x: 500, width: 180 },
      ],
    });
    expect(textOverVideo()[0]?.wordRects).toEqual([
      { x: 300, y: 800, width: 150, height: 100 },
      { x: 500, y: 800, width: 180, height: 100 },
    ]);
  });

  it.each([
    // 16:9 into 9:16: cover scales to the height and spills sideways, contain letterboxes.
    ["cover", "50% 50%", { x: -1166.67, y: 0, width: 3413.33, height: 1920 }],
    ["cover", "0% 50%", { x: 0, y: 0, width: 3413.33, height: 1920 }],
    ["contain", "50% 50%", { x: 0, y: 656.25, width: 1080, height: 607.5 }],
    ["contain", "50% 0%", { x: 0, y: 0, width: 1080, height: 607.5 }],
    ["none", "50% 50%", { x: 444, y: 906, width: 192, height: 108 }],
  ])("places the frame for object-fit %s at %s", (objectFit, objectPosition, frame) => {
    installScene({ videos: { take: { style: { objectFit, objectPosition } } } });
    expect(textOverVideo()[0]?.video).toMatchObject({ box: CANVAS, frame });
  });

  it("cuts the video's box to the canvas and keeps the frame whole", () => {
    const box = { x: -100, y: 400, width: 1280, height: 720 };
    installScene({ videos: { take: { box } } });
    expect(textOverVideo()[0]?.video).toMatchObject({
      box: { x: 0, y: 400, width: 1080, height: 720 },
      frame: box,
    });
  });

  it("marks a mirrored video", () => {
    installScene({ videos: { take: { style: { transform: "matrix(-1, 0, 0, 1, 0, 0)" } } } });
    expect(textOverVideo()[0]?.video).toMatchObject({ flipX: true, flipY: false, frame: CANVAS });
  });

  it("skips a rotated video instead of guessing where its frame lands", () => {
    installScene({
      videos: { take: { style: { transform: "matrix(0.866, 0.5, -0.5, 0.866, 0, 0)" } } },
    });
    expect(textOverVideo()).toEqual([]);
  });

  it("skips a video whose frame is not decoded", () => {
    installScene({ videos: { take: { readyState: 1 } } });
    expect(textOverVideo()).toEqual([]);
  });

  it.each([
    ["the element", { titleAttrs: "data-layout-allow-on-face" }],
    ["an ancestor", { wrapperAttrs: "data-layout-allow-on-face" }],
  ])("honours data-layout-allow-on-face on %s", (_where, attrs) => {
    installScene(attrs);
    expect(textOverVideo()).toEqual([]);
  });

  it("looks through a transparent cutout beneath the text to the take under it", () => {
    installScene({
      videos: { cutout: CUTOUT, take: {} },
      stack: () => ["title", "cutout", "take"],
    });
    expect(textOverVideo().map((candidate) => candidate.video.selector)).toEqual(["#take"]);
  });

  it("does not take a lone cutout for a video to look for faces in", () => {
    installScene({ videos: { cutout: CUTOUT } });
    expect(textOverVideo()).toEqual([]);
  });

  it("leaves text behind a cutout to text_occluded", () => {
    installScene({
      videos: { cutout: CUTOUT, take: {} },
      stack: () => ["cutout", "title", "take"],
    });
    expect(textOverVideo()).toEqual([]);
  });

  it("does not report text that is beneath the video", () => {
    installScene({ stack: () => ["take", "title"] });
    expect(textOverVideo()).toEqual([]);
  });

  it("does not report text that sits on an opaque panel over the video", () => {
    installScene({ panels: ["card"], stack: () => ["title", "card", "take"] });
    expect(textOverVideo()).toEqual([]);
  });

  it("counts only the stretch of a word that is in front of the video", () => {
    installScene({
      panels: ["card"],
      stack: (x) => (x < 500 ? ["title", "card", "take"] : ["title", "take"]),
    });
    expect(textOverVideo()[0]?.wordRects).toEqual([{ x: 500, y: 800, width: 100, height: 100 }]);
  });

  it("splits a word across two videos side by side", () => {
    installScene({
      videos: {
        left: { box: { x: 0, y: 0, width: 500, height: 1920 } },
        right: { box: { x: 500, y: 0, width: 580, height: 1920 } },
      },
      stack: (x) => ["title", x < 500 ? "left" : "right"],
    });
    expect(
      textOverVideo().map((candidate) => [candidate.video.selector, candidate.wordRects]),
    ).toEqual([
      ["#left", [{ x: 400, y: 800, width: 100, height: 100 }]],
      ["#right", [{ x: 500, y: 800, width: 100, height: 100 }]],
    ]);
  });

  it("does not report text that is still fading in", () => {
    installScene({ titleStyle: { opacity: "0.3" } });
    expect(textOverVideo()).toEqual([]);
  });

  it("costs nothing without a video: no candidates and no frame read", () => {
    const { getImageData } = installScene({ videos: {}, stack: () => ["title"] });
    expect(textOverVideo()).toEqual([]);
    expect(getImageData).not.toHaveBeenCalled();
  });

  it("answers only for the time its audit ran at", () => {
    installScene({});
    expect(textOverVideo(1, 2)).toEqual([]);
  });
});
