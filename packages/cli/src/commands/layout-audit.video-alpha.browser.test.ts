// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "layout-audit.browser.js"),
  "utf-8",
);

interface AuditIssue {
  code: string;
  severity: string;
  selector: string;
  containerSelector?: string;
  message: string;
  coveredFraction?: number;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

// The <video> fills a 1920x1080 frame from a 192x108 source, so one source pixel is 10x10 px.
const SOURCE_WIDTH = 192;
const SOURCE_HEIGHT = 108;
const FRAME: Box = { left: 0, top: 0, width: 1920, height: 1080 };
const WORD_TOP = 500;
const WORD_HEIGHT = 80;

interface VideoScene {
  /** Text elements: id -> words with their left edge and width, all on one line. */
  text: Record<string, Array<{ word: string; left: number; width: number }>>;
  /** Alpha (0-255) the decoded frame paints at a composition point. */
  alphaAt?: (x: number, y: number) => number;
  video?: { readyState?: number; seeking?: boolean; readError?: Error; overlapsText?: boolean };
  /** Computed style the <video> adds to the base, e.g. a transform or a background. */
  videoStyle?: Record<string, string>;
  /** Report each element's text as one line box, as Chromium does, rather than one per word. */
  wholeLine?: boolean;
  textAttrs?: string;
  /** Size each text element to its first word's box instead of the whole frame. */
  sizedText?: boolean;
  /** Attributes on the timed wrapper around the text. */
  lineAttrs?: string;
}

function domRect({ left, top, width, height }: Box): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

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

function wordBox(left: number, width: number): Box {
  return { left, top: WORD_TOP, width, height: WORD_HEIGHT };
}

function installVideoScene(scene: VideoScene): { getImageData: ReturnType<typeof vi.fn> } {
  const spans = Object.entries(scene.text)
    .map(
      ([id, words]) =>
        `<span id="${id}" ${scene.textAttrs ?? ""}>${words.map(({ word }) => word).join(" ")}</span>`,
    )
    .join("");
  document.body.innerHTML = `
    <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
      <div id="line" ${scene.lineAttrs ?? ""}>${spans}</div>
      <video id="clip"></video>
    </div>`;

  const video = document.getElementById("clip") as HTMLVideoElement;
  Object.defineProperties(video, {
    videoWidth: { configurable: true, value: SOURCE_WIDTH },
    videoHeight: { configurable: true, value: SOURCE_HEIGHT },
    readyState: { configurable: true, value: scene.video?.readyState ?? 4 },
    seeking: { configurable: true, value: scene.video?.seeking ?? false },
  });

  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (element) =>
      ({
        ...BASE_STYLE,
        ...(element === video ? scene.videoStyle : {}),
      }) as unknown as CSSStyleDeclaration,
  );
  for (const element of Array.from(document.querySelectorAll("*"))) {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(domRect(FRAME));
  }

  if (scene.sizedText) {
    for (const [id, words] of Object.entries(scene.text)) {
      const first = words[0];
      const element = document.getElementById(id);
      if (first && element) {
        vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
          domRect(wordBox(first.left, first.width)),
        );
      }
    }
  }

  const wordRect = (node: Node | null, start: number, end: number): DOMRect[] => {
    const owner = node?.parentElement?.id ?? "";
    const word = (node?.textContent ?? "").slice(start, end);
    const entry = scene.text[owner]?.find((candidate) => candidate.word === word);
    return entry ? [domRect(wordBox(entry.left, entry.width))] : [];
  };
  vi.spyOn(document, "createRange").mockImplementation(() => {
    let node: Node | null = null;
    let start = 0;
    let end: number | null = null;
    return {
      selectNodeContents(selected: Node) {
        node = selected;
      },
      setStart(selected: Node, offset: number) {
        node = selected;
        start = offset;
      },
      setEnd(_selected: Node, offset: number) {
        end = offset;
      },
      getClientRects() {
        const owner = node?.parentElement?.id ?? "";
        if (end === null) {
          const boxes = (scene.text[owner] ?? []).map(({ left, width }) => wordBox(left, width));
          if (scene.wholeLine && boxes.length > 0) {
            const left = Math.min(...boxes.map((box) => box.left));
            const right = Math.max(...boxes.map((box) => box.left + box.width));
            return [domRect(wordBox(left, right - left))] as unknown as DOMRectList;
          }
          return boxes.map(domRect) as unknown as DOMRectList;
        }
        return wordRect(node, start, end) as unknown as DOMRectList;
      },
      detach() {},
    } as unknown as Range;
  });

  const overlapsText = scene.video?.overlapsText ?? true;
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: (x: number) => {
      const textElement = Object.keys(scene.text)
        .map((id) => document.getElementById(id))
        .find((element) => {
          const words = scene.text[element?.id ?? ""] ?? [];
          return words.some(({ left, width }) => x >= left && x < left + width);
        });
      return [...(overlapsText ? [video] : []), textElement, video].filter(Boolean);
    },
  });

  const alphaAt = scene.alphaAt ?? (() => 255);
  const getImageData = vi.fn((_x: number, _y: number, width: number, height: number) => {
    if (scene.video?.readError) throw scene.video.readError;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const x = ((col + 0.5) * FRAME.width) / width;
        const y = ((row + 0.5) * FRAME.height) / height;
        data[(row * width + col) * 4 + 3] = alphaAt(x, y);
      }
    }
    return { data };
  });
  // getContext's overloads resolve to the WebGPU one; the audit only asks for "2d".
  const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext") as unknown as {
    mockReturnValue(value: CanvasRenderingContext2D): void;
  };
  getContextSpy.mockReturnValue({
    clearRect() {},
    drawImage() {},
    getImageData,
  } as unknown as CanvasRenderingContext2D);

  window.eval(script);
  return { getImageData };
}

function runAudit(): AuditIssue[] {
  const audit = (
    window as unknown as {
      __hyperframesLayoutAudit: (options: { time: number; tolerance: number }) => AuditIssue[];
    }
  ).__hyperframesLayoutAudit;
  return audit({ time: 1, tolerance: 2 });
}

const occlusionOf = (issues: AuditIssue[], id: string) =>
  issues.find((issue) => issue.code === "text_occluded" && issue.selector === `#${id}`);

const coverOf = (issues: AuditIssue[]) => issues.find((issue) => issue.code === "canvas_covered");

const SHIP = { ship: [{ word: "SHIP", left: 800, width: 200 }] };
const subjectLeftOf = (edge: number) => (x: number) => (x < edge ? 255 : 0);

describe("layout-audit.browser text behind a <video>", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    Reflect.deleteProperty(document, "elementsFromPoint");
    Reflect.deleteProperty(window, "__hyperframesLayoutAudit");
  });

  it("does not call a cutout that is mostly transparent a cover of the canvas", () => {
    installVideoScene({
      text: SHIP,
      sizedText: true,
      alphaAt: (x) => (x >= 640 && x < 1280 ? 255 : 0),
    });
    expect(coverOf(runAudit())).toBeUndefined();
  });

  it("still calls a fully opaque frame over buried content a cover of the canvas", () => {
    installVideoScene({ text: SHIP, sizedText: true });
    expect(coverOf(runAudit())).toMatchObject({ severity: "error", selector: "#clip" });
  });

  it("reports the word's own clip window, shifted only by composition hosts", () => {
    installVideoScene({
      text: SHIP,
      textAttrs: 'data-start="2.4" data-duration="0.4"',
      lineAttrs: 'data-start="2" data-duration="5"',
    });
    expect(occlusionOf(runAudit(), "ship")).toMatchObject({
      lifetime: { start: 2.4, end: 2.8 },
    });
  });

  it("shifts the window by an anonymous host and its in-point, and cuts it to the host slot", () => {
    installVideoScene({
      text: SHIP,
      textAttrs: 'data-start="0.2" data-duration="1"',
      lineAttrs:
        'data-composition-src="beat.html" data-start="2" data-media-start="0.5" data-duration="3"',
    });
    expect(occlusionOf(runAudit(), "ship")).toMatchObject({
      lifetime: { start: 2, end: 2.7 },
    });
  });

  it("reads an invalid playback-start as absent and cuts to a host that ends with data-end", () => {
    installVideoScene({
      text: SHIP,
      textAttrs: 'data-start="0.2" data-duration="5"',
      lineAttrs:
        'data-composition-src="beat.html" data-start="2" data-playback-start="-1" data-media-start="0.5" data-end="3"',
    });
    expect(occlusionOf(runAudit(), "ship")).toMatchObject({
      lifetime: { start: 2, end: 3 },
    });
  });

  it("keeps a fully opaque frame occluding like any raster", () => {
    installVideoScene({ text: SHIP });
    expect(occlusionOf(runAudit(), "ship")).toMatchObject({
      severity: "error",
      containerSelector: "#clip",
      coveredFraction: 1,
      message: "Text is hidden beneath an opaque element.",
    });
  });

  it("does not flag text under the transparent part of a cutout", () => {
    installVideoScene({ text: SHIP, alphaAt: subjectLeftOf(400) });
    expect(occlusionOf(runAudit(), "ship")).toBeUndefined();
  });

  it("reports a partly covered word as info with its share under the matte", () => {
    installVideoScene({ text: SHIP, alphaAt: subjectLeftOf(860) });
    expect(occlusionOf(runAudit(), "ship")).toMatchObject({
      severity: "info",
      coveredFraction: 0.3,
      message: `Text sits partly behind a transparent video's matte; its most covered word "SHIP" is 30% hidden.`,
    });
  });

  it("fails a word that is 80% or more behind the matte", () => {
    installVideoScene({ text: SHIP, alphaAt: subjectLeftOf(970) });
    expect(occlusionOf(runAudit(), "ship")).toMatchObject({
      severity: "error",
      coveredFraction: 0.85,
      message: `"SHIP" is 85% behind a transparent video's matte.`,
    });
  });

  it("judges each rendered word, so one lost word fails a mostly clear line", () => {
    installVideoScene({
      text: {
        line1: [
          { word: "a", left: 200, width: 40 },
          { word: "big", left: 260, width: 100 },
          { word: "launch", left: 380, width: 240 },
        ],
      },
      alphaAt: (x) => (x >= 370 ? 255 : 0),
    });
    expect(occlusionOf(runAudit(), "line1")).toMatchObject({
      severity: "error",
      coveredFraction: 1,
      message: `"launch" is 100% behind a transparent video's matte.`,
    });
  });

  it("fails two neighbouring words that are each half covered", () => {
    installVideoScene({
      text: {
        pair: [
          { word: "IN", left: 200, width: 100 },
          { word: "SHIP", left: 320, width: 200 },
        ],
      },
      alphaAt: (_x, y) => (y >= 530 ? 255 : 0),
    });
    expect(occlusionOf(runAudit(), "pair")).toMatchObject({
      severity: "error",
      coveredFraction: 0.63,
      message: `Neighbouring words "IN" and "SHIP" are 63% and 63% behind a transparent video's matte.`,
    });
  });

  it("applies the neighbour rule across one-word sibling elements", () => {
    installVideoScene({
      text: {
        first: [{ word: "IN", left: 200, width: 100 }],
        second: [{ word: "SHIP", left: 320, width: 200 }],
      },
      alphaAt: (_x, y) => (y >= 530 ? 255 : 0),
    });
    const issues = runAudit();
    expect(occlusionOf(issues, "first")?.severity).toBe("error");
    expect(occlusionOf(issues, "second")?.severity).toBe("error");
  });

  it("keeps a single half-covered word at info", () => {
    installVideoScene({
      text: {
        first: [{ word: "IN", left: 200, width: 100 }],
        second: [{ word: "SHIP", left: 320, width: 200 }],
      },
      alphaAt: (x, y) => (x < 310 && y >= 530 ? 255 : 0),
    });
    const issues = runAudit();
    expect(occlusionOf(issues, "first")?.severity).toBe("info");
    expect(occlusionOf(issues, "second")).toBeUndefined();
  });

  it("fails a word hidden by a matte feature that falls between two probe columns", () => {
    // One 1800px line box: its 20% and 35% probe columns sit at x 360 and 630, the strip at 440-540.
    installVideoScene({
      text: {
        caption: [
          { word: "a", left: 0, width: 40 },
          { word: "gh", left: 460, width: 60 },
          { word: "end", left: 1700, width: 100 },
        ],
      },
      wholeLine: true,
      alphaAt: (x) => (x >= 440 && x < 540 ? 255 : 0),
    });
    expect(occlusionOf(runAudit(), "caption")).toMatchObject({
      severity: "error",
      containerSelector: "#clip",
      message: `"gh" is 100% behind a transparent video's matte.`,
    });
  });

  it("reads a mirrored video's alpha on the side it is painted", () => {
    installVideoScene({
      text: {
        shown: [{ word: "SHIP", left: 200, width: 200 }],
        hidden: [{ word: "SHIP", left: 1500, width: 200 }],
      },
      videoStyle: { transform: "matrix(-1, 0, 0, 1, 0, 0)" },
      // Source alpha: the subject fills the source's left half, so it paints on the right.
      alphaAt: subjectLeftOf(960),
    });
    const issues = runAudit();
    expect(occlusionOf(issues, "shown")).toBeUndefined();
    expect(occlusionOf(issues, "hidden")).toMatchObject({ severity: "error", coveredFraction: 1 });
  });

  it("keeps a video's opaque CSS background occluding behind its clear pixels", () => {
    installVideoScene({
      text: SHIP,
      videoStyle: { backgroundColor: "rgb(18, 52, 86)" },
      alphaAt: subjectLeftOf(400),
    });
    expect(occlusionOf(runAudit(), "ship")).toMatchObject({
      severity: "error",
      message: "Text is hidden beneath an opaque element.",
    });
  });

  it("respects data-layout-allow-occlusion", () => {
    installVideoScene({
      text: SHIP,
      alphaAt: subjectLeftOf(970),
      textAttrs: "data-layout-allow-occlusion",
    });
    expect(occlusionOf(runAudit(), "ship")).toBeUndefined();
  });

  it("reads each probed video's frame once per sample and leaves videos under no text alone", () => {
    const covering = installVideoScene({ text: SHIP, alphaAt: subjectLeftOf(860) });
    runAudit();
    expect(covering.getImageData).toHaveBeenCalledTimes(1);
    runAudit();
    expect(covering.getImageData).toHaveBeenCalledTimes(2);

    vi.restoreAllMocks();
    const beneath = installVideoScene({ text: SHIP, video: { overlapsText: false } });
    runAudit();
    expect(beneath.getImageData).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a video with no decoded frame",
      video: { readyState: 1 },
      alphaAt: undefined,
      reason: "no frame was decoded at this time",
    },
    {
      name: "a video still seeking",
      video: { seeking: true },
      alphaAt: undefined,
      reason: "the seek had not landed",
    },
    {
      name: "a cross-origin video",
      video: { readError: Object.assign(new Error("tainted"), { name: "SecurityError" }) },
      alphaAt: undefined,
      reason: "its source is cross-origin",
    },
    {
      name: "a rotated video",
      video: {},
      videoStyle: { transform: "matrix(0, 1, -1, 0, 0, 0)" },
      alphaAt: subjectLeftOf(400),
      reason: "it is rotated, skewed or transformed in 3D",
    },
    {
      name: "a frame that reads back fully transparent",
      video: {},
      alphaAt: () => 0,
      reason: "its frame read back fully transparent",
    },
  ])(
    "falls back to opaque with an info note for $name",
    ({ video, videoStyle, alphaAt, reason }) => {
      installVideoScene({ text: SHIP, video, videoStyle, alphaAt });
      const issues = runAudit();
      expect(occlusionOf(issues, "ship")).toMatchObject({ severity: "error", coveredFraction: 1 });
      expect(issues).toContainEqual(
        expect.objectContaining({
          code: "video_alpha_unread",
          severity: "info",
          selector: "#clip",
          message: `Could not read this video's frame alpha (${reason}), so text under it was judged as if the video were opaque.`,
        }),
      );
    },
  );
});
