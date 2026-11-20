import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { corsForSealedMedia } from "./sealedMediaCors";

const PREVIEW = "http://localhost:4817/api/projects/demo/preview/~token/";
let observer: MutationObserver | null = null;

// MutationObserver callbacks run as a microtask after the insertion.
const settled = () => Promise.resolve();

function add(html: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

beforeEach(() => {
  document.head.innerHTML = `<base href="${PREVIEW}">`;
  document.body.innerHTML = "";
});

afterEach(() => {
  observer?.disconnect();
  observer = null;
  vi.unstubAllGlobals();
});

describe("corsForSealedMedia", () => {
  it("opts the preview's own video and audio into CORS in a sealed document", async () => {
    vi.stubGlobal("origin", "null");
    observer = corsForSealedMedia();
    const host = add(
      `<video src="media/clip.mp4"></video><audio src="${PREVIEW}media/music.mp3"></audio>`,
    );
    await settled();
    const crossOrigins = [...host.querySelectorAll("video, audio")].map((el) =>
      el.getAttribute("crossorigin"),
    );
    expect(crossOrigins).toEqual(["anonymous", "anonymous"]);
  });

  it("leaves media from another host as authored, since that host may not answer CORS", async () => {
    vi.stubGlobal("origin", "null");
    observer = corsForSealedMedia();
    const host = add(
      `<video src="https://cdn.example.com/clip.mp4"></video>` +
        `<video><source src="media/a.mp4"><source src="https://cdn.example.com/a.webm"></video>`,
    );
    await settled();
    expect([...host.querySelectorAll("video")].map((el) => el.hasAttribute("crossorigin"))).toEqual(
      [false, false],
    );
  });

  it("opts in a video whose <source> arrives after it", async () => {
    vi.stubGlobal("origin", "null");
    observer = corsForSealedMedia();
    const host = add(`<video></video>`);
    await settled();
    const video = host.querySelector("video")!;
    expect(video.hasAttribute("crossorigin")).toBe(false);
    const source = document.createElement("source");
    source.setAttribute("src", "media/late.mp4");
    video.append(source);
    await settled();
    expect(video.getAttribute("crossorigin")).toBe("anonymous");
  });

  it("opts in a video whose src a script sets after inserting it", async () => {
    vi.stubGlobal("origin", "null");
    observer = corsForSealedMedia();
    const video = add(`<video></video>`).querySelector("video")!;
    await settled();
    video.src = "media/later.mp4";
    await settled();
    expect(video.getAttribute("crossorigin")).toBe("anonymous");
  });

  it("takes back only its own crossorigin when a script moves a video to another host", async () => {
    vi.stubGlobal("origin", "null");
    observer = corsForSealedMedia();
    const host = add(
      `<video src="media/a.mp4"></video><video src="media/b.mp4" crossorigin="anonymous"></video>`,
    );
    await settled();
    const [ours, authored] = host.querySelectorAll("video");
    ours.src = "https://cdn.example.com/a.mp4";
    authored.src = "https://cdn.example.com/b.mp4";
    await settled();
    expect([ours.hasAttribute("crossorigin"), authored.getAttribute("crossorigin")]).toEqual([
      false,
      "anonymous",
    ]);
  });

  it("covers media already in the page when it starts, and keeps an authored crossorigin", async () => {
    const host = add(
      `<video src="media/early.mp4"></video><video src="media/b.mp4" crossorigin="use-credentials"></video>`,
    );
    vi.stubGlobal("origin", "null");
    observer = corsForSealedMedia();
    expect([...host.querySelectorAll("video")].map((el) => el.getAttribute("crossorigin"))).toEqual(
      ["anonymous", "use-credentials"],
    );
  });

  it("changes nothing in a document with its own origin", async () => {
    observer = corsForSealedMedia();
    const host = add(`<video src="media/clip.mp4"></video>`);
    await settled();
    expect(observer).toBeNull();
    expect(host.querySelector("video")!.hasAttribute("crossorigin")).toBe(false);
  });
});
