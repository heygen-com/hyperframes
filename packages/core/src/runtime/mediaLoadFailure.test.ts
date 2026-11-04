import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postRuntimeMessage } from "./bridge";
import { watchAudioLoadErrors } from "./mediaLoadFailure";
import { RUNTIME_MEDIA_LOAD_FAILED } from "./protocol";
import { WebAudioTransport } from "./webAudioTransport";

vi.mock("./bridge", () => ({ postRuntimeMessage: vi.fn() }));

const posted = vi.mocked(postRuntimeMessage);
const failures = () =>
  posted.mock.calls
    .map(([message]) => message)
    .filter((m) => m.type === "diagnostic" && m.code === RUNTIME_MEDIA_LOAD_FAILED)
    .map((m) => (m as { details: Record<string, unknown> }).details);

function audio(src: string, id = "music"): HTMLAudioElement {
  const el = document.createElement("audio");
  el.id = id;
  el.setAttribute("src", src);
  return el;
}

function transport(decode: () => Promise<AudioBuffer>) {
  const t = new WebAudioTransport();
  (t as unknown as { _ctx: unknown })._ctx = { state: "running", decodeAudioData: vi.fn(decode) };
  return t;
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  posted.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a preview media load that fails is reported, not swallowed", () => {
  it("a fetch the server refuses says its status, once however often playback retries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    const t = transport(async () => ({}) as AudioBuffer);
    const el = audio("assets/Don't (mix).mp3");
    await t.decodeAudioElement(el);
    await t.decodeAudioElement(el);
    expect(failures()).toEqual([
      expect.objectContaining({
        elementId: "music",
        kind: "audio",
        stage: "fetch",
        code: 404,
        extension: "mp3",
      }),
    ]);
  });

  it("bytes the browser cannot decode say decode and how many bytes came", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
    );
    const t = transport(async () => {
      throw new Error("unsupported codec");
    });
    await t.decodeAudioElement(audio("assets/song.wav"));
    expect(failures()).toEqual([
      expect.objectContaining({ stage: "decode", code: null, bytes: 8, extension: "wav" }),
    ]);
  });

  it("an audio element that fails to load says its error code; a video's is left to the proxy", () => {
    const stop = watchAudioLoadErrors(document);
    const el = audio("assets/gone.mp3", "gone");
    Object.defineProperty(el, "error", { value: { code: 4 } });
    const video = document.createElement("video");
    document.body.append(el, video);
    el.dispatchEvent(new Event("error"));
    video.dispatchEvent(new Event("error"));
    stop();
    el.dispatchEvent(new Event("error"));
    expect(failures()).toEqual([
      expect.objectContaining({ elementId: "gone", stage: "element", code: 4 }),
    ]);
    el.remove();
    video.remove();
  });
  it("an audio element fed by <source> children reports when a source fails to load", () => {
    const stop = watchAudioLoadErrors(document);
    const el = document.createElement("audio");
    el.id = "sourced";
    const source = document.createElement("source");
    source.setAttribute("src", "assets/gone.ogg");
    el.append(source);
    document.body.append(el);
    source.dispatchEvent(new Event("error"));
    stop();
    expect(failures()).toEqual([
      expect.objectContaining({ elementId: "sourced", stage: "element" }),
    ]);
    el.remove();
  });
});
