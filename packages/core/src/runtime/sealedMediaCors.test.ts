import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preloadMedia } from "./preloadMedia";
import { corsForSealedMedia } from "./sealedMediaCors";

const PREVIEW = "http://localhost:4817/api/projects/demo/preview/~token/";
let observer: MutationObserver | null = null;

// MutationObserver callbacks run as a microtask after the insertion.
const settled = () => Promise.resolve();
const answered = () => new Promise<void>((resolve) => setTimeout(resolve));

/** The first frame of a load, of `url`: what makes a no-CORS fallback count as having played. */
function playsFrom(media: HTMLMediaElement, url: string) {
  Object.defineProperty(media, "currentSrc", { value: url, configurable: true });
  media.dispatchEvent(new Event("loadeddata"));
}

function add(html: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

beforeEach(() => {
  document.head.innerHTML = `<base href="${PREVIEW}">`;
  document.body.innerHTML = "";
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
});

afterEach(async () => {
  await answered();
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
        `<video><source src="https://cdn.example.com/a.webm"><source src="media/a.mp4"></video>`,
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

  // fails without the fix: a host with no CORS headers failed every opted-in video, and nothing loaded it again.
  it("loads a video again once without crossorigin when its CORS load fails, and says so once it plays", async () => {
    vi.stubGlobal("origin", "null");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    observer = corsForSealedMedia();
    const video = add(`<video src="media/plain-host.mp4"></video>`).querySelector("video")!;
    await settled();
    const load = vi.spyOn(video, "load").mockImplementation(() => {});
    expect(video.getAttribute("crossorigin")).toBe("anonymous");

    video.dispatchEvent(new Event("error"));
    expect(video.hasAttribute("crossorigin")).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    playsFrom(video, `${PREVIEW}media/plain-host.mp4`);
    await answered();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain(`${PREVIEW}media/plain-host.mp4`);

    video.dispatchEvent(new Event("error"));
    expect(load).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("keeps a refusal to the element it happened on", async () => {
    vi.stubGlobal("origin", "null");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    observer = corsForSealedMedia();
    const first = add(`<video src="media/refused.mp4"></video>`).querySelector("video")!;
    await settled();
    vi.spyOn(first, "load").mockImplementation(() => {});
    first.dispatchEvent(new Event("error"));
    playsFrom(first, `${PREVIEW}media/refused.mp4`);
    await answered();

    const second = add(`<video src="media/refused.mp4"></video>`).querySelector("video")!;
    first.src = `${PREVIEW}media/refused.mp4`;
    await settled();
    expect(second.getAttribute("crossorigin")).toBe("anonymous");
    expect(first.hasAttribute("crossorigin")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("drops CORS at once when a source fails with it, so the browser picks again as without it, and leaves other elements alone", async () => {
    vi.stubGlobal("origin", "null");
    observer = corsForSealedMedia();
    const host = add(
      `<video><source src="media/gone.mp4"><source src="media/healthy.mp4"></video>`,
    );
    await settled();
    const video = host.querySelector("video")!;
    const load = vi.spyOn(video, "load").mockImplementation(() => {});
    video.querySelector("source")!.dispatchEvent(new Event("error"));
    expect([video.hasAttribute("crossorigin"), load.mock.calls.length]).toEqual([false, 1]);
    const later = add(`<video src="media/healthy.mp4"></video>`).querySelector("video")!;
    await settled();
    expect(later.getAttribute("crossorigin")).toBe("anonymous");
  });
  it("plays a source that refused CORS without it, says so once, and opts nothing back in for it", async () => {
    vi.stubGlobal("origin", "null");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    observer = corsForSealedMedia();
    const host = add(
      `<video><source src="media/no-cors-a.mp4"><source src="media/no-cors-b.mp4"></video>`,
    );
    await settled();
    const video = host.querySelector("video")!;
    const load = vi.spyOn(video, "load").mockImplementation(() => {});
    video.querySelector("source")!.dispatchEvent(new Event("error"));
    playsFrom(video, `${PREVIEW}media/no-cors-a.mp4`);
    await answered();
    playsFrom(video, `${PREVIEW}media/no-cors-a.mp4`);
    expect([video.hasAttribute("crossorigin"), load.mock.calls.length]).toEqual([false, 1]);
    expect(warn.mock.calls.map(([line]) => String(line).split(" ")[1])).toEqual([
      `${PREVIEW}media/no-cors-a.mp4`,
    ]);
    warn.mockRestore();
  });
  it("opts a source back in once its host answers CORS after a failed CORS load, and asks that host once", async () => {
    vi.stubGlobal("origin", "null");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    observer = corsForSealedMedia();
    const host = add(`<video src="media/blip.mp4"></video>`);
    await settled();
    const video = host.querySelector("video")!;
    const load = vi.spyOn(video, "load").mockImplementation(() => {});
    video.dispatchEvent(new Event("error"));
    playsFrom(video, `${PREVIEW}media/blip.mp4`);
    await answered();
    expect(video.getAttribute("crossorigin")).toBe("anonymous");
    video.dispatchEvent(new Event("error"));
    playsFrom(video, `${PREVIEW}media/blip.mp4`);
    await settled();
    expect([fetch.mock.calls, video.hasAttribute("crossorigin"), load.mock.calls.length]).toEqual([
      [
        [
          `${PREVIEW}media/blip.mp4`,
          { method: "HEAD", mode: "cors", cache: "no-store", redirect: "error" },
        ],
      ],
      false,
      3,
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it("says nothing while its CORS question is still out, and opts back in when the host answers", async () => {
    vi.stubGlobal("origin", "null");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let answer!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    observer = corsForSealedMedia();
    const host = add(`<video src="media/slow.mp4"></video>`);
    await settled();
    const video = host.querySelector("video")!;
    vi.spyOn(video, "load").mockImplementation(() => {});
    video.dispatchEvent(new Event("error"));
    playsFrom(video, `${PREVIEW}media/slow.mp4`);
    playsFrom(video, `${PREVIEW}media/slow.mp4`);
    await answered();
    expect(warn).not.toHaveBeenCalled();
    answer(new Response(null, { status: 200 }));
    await answered();
    expect([warn.mock.calls.length, video.getAttribute("crossorigin")]).toEqual([0, "anonymous"]);
    warn.mockRestore();
  });
  it("keeps a source without CORS when its host refuses the CORS question too", async () => {
    vi.stubGlobal("origin", "null");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    observer = corsForSealedMedia();
    const host = add(`<video src="media/no-cors.mp4"></video>`);
    await settled();
    const video = host.querySelector("video")!;
    const load = vi.spyOn(video, "load").mockImplementation(() => {});
    video.dispatchEvent(new Event("error"));
    playsFrom(video, `${PREVIEW}media/no-cors.mp4`);
    await answered();
    expect(warn).toHaveBeenCalledTimes(1);
    expect([video.hasAttribute("crossorigin"), load.mock.calls.length]).toEqual([false, 1]);
    warn.mockRestore();
  });
  it("takes back its own crossorigin when its src returns to a URL that refused CORS on it, and keeps an authored one", async () => {
    vi.stubGlobal("origin", "null");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    observer = corsForSealedMedia();
    const host = add(
      `<video src="media/refused-once.mp4"></video><video src="media/fine-b.mp4" crossorigin="anonymous"></video>`,
    );
    await settled();
    const [ours, authored] = host.querySelectorAll("video");
    vi.spyOn(ours!, "load").mockImplementation(() => {});
    ours!.dispatchEvent(new Event("error"));
    playsFrom(ours!, `${PREVIEW}media/refused-once.mp4`);
    ours!.src = "media/fine-a.mp4";
    await settled();
    expect(ours!.getAttribute("crossorigin")).toBe("anonymous");
    ours!.src = "media/refused-once.mp4";
    authored!.src = "media/refused-once.mp4";
    await settled();
    expect([ours!.hasAttribute("crossorigin"), authored!.getAttribute("crossorigin")]).toEqual([
      false,
      "anonymous",
    ]);
    warn.mockRestore();
  });

  it("forgets a source that failed without CORS too, and opts back in once it plays", async () => {
    vi.stubGlobal("origin", "null");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    observer = corsForSealedMedia();
    const video = add(`<video src="media/down.mp4"></video>`).querySelector("video")!;
    await settled();
    const load = vi.spyOn(video, "load").mockImplementation(() => {});
    video.dispatchEvent(new Event("error"));
    video.dispatchEvent(new Event("error"));
    expect([load.mock.calls.length, warn.mock.calls.length]).toEqual([1, 0]);
    expect(video.hasAttribute("crossorigin")).toBe(false);
    const fresh = add(`<video src="media/down.mp4"></video>`).querySelector("video")!;
    await settled();
    expect(fresh.getAttribute("crossorigin")).toBe("anonymous");

    playsFrom(video, `${PREVIEW}media/down.mp4`);
    expect(video.getAttribute("crossorigin")).toBe("anonymous");
    expect(load).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("loads nothing more while a host stays down both ways", async () => {
    vi.stubGlobal("origin", "null");
    observer = corsForSealedMedia();
    const video = add(`<video src="media/gone.mp4"></video>`).querySelector("video")!;
    await settled();
    const load = vi.spyOn(video, "load").mockImplementation(() => {});
    for (let selection = 0; selection < 4; selection++) video.dispatchEvent(new Event("error"));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("opts back in for an own source played without CORS behind a host that is down, and drops it again if it refuses", async () => {
    vi.stubGlobal("origin", "null");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    observer = corsForSealedMedia();
    const video = add(
      `<video><source src="media/down.mp4"><source src="media/own.mp4"></video>`,
    ).querySelector("video")!;
    await settled();
    const load = vi.spyOn(video, "load").mockImplementation(() => {});
    const [down, own] = video.querySelectorAll("source");
    down!.dispatchEvent(new Event("error"));
    down!.dispatchEvent(new Event("error"));
    playsFrom(video, `${PREVIEW}media/own.mp4`);
    expect([video.getAttribute("crossorigin"), load.mock.calls.length]).toEqual(["anonymous", 2]);
    down!.dispatchEvent(new Event("error"));
    expect(load).toHaveBeenCalledTimes(2);
    own!.dispatchEvent(new Event("error"));
    playsFrom(video, `${PREVIEW}media/own.mp4`);
    expect([video.hasAttribute("crossorigin"), load.mock.calls.length]).toEqual([false, 3]);
  });

  it("loads a list naming another host as written, and keeps it so while the other host's source plays", async () => {
    vi.stubGlobal("origin", "null");
    observer = corsForSealedMedia();
    const video = add(
      `<video><source src="https://cdn.example.com/x.webm"><source src="media/own.mp4"></video>`,
    ).querySelector("video")!;
    await settled();
    expect(video.hasAttribute("crossorigin")).toBe(false);
    const load = vi.spyOn(video, "load").mockImplementation(() => {});
    playsFrom(video, "https://cdn.example.com/x.webm");
    expect([video.hasAttribute("crossorigin"), load.mock.calls.length]).toEqual([false, 0]);
  });

  it("opts in an own source that plays first in a list naming another host", async () => {
    vi.stubGlobal("origin", "null");
    observer = corsForSealedMedia();
    const video = add(
      `<video><source src="media/own.mp4"><source src="https://cdn.example.com/x.webm"></video>`,
    ).querySelector("video")!;
    await settled();
    const load = vi.spyOn(video, "load").mockImplementation(() => {});
    playsFrom(video, `${PREVIEW}media/own.mp4`);
    expect([video.getAttribute("crossorigin"), load.mock.calls.length]).toEqual(["anonymous", 1]);
  });

  it("opts in an own source reached after another host's failed, and keeps that source through the reload", async () => {
    vi.stubGlobal("origin", "null");
    observer = corsForSealedMedia();
    const video = add(
      `<video><source src="https://cdn.example.com/x.webm"><source src="media/own.mp4"></video>`,
    ).querySelector("video")!;
    await settled();
    const load = vi.spyOn(video, "load").mockImplementation(() => {});
    const [foreign] = video.querySelectorAll("source");
    foreign!.dispatchEvent(new Event("error"));
    playsFrom(video, `${PREVIEW}media/own.mp4`);
    expect([video.getAttribute("crossorigin"), load.mock.calls.length]).toEqual(["anonymous", 1]);
    expect(foreign!.hasAttribute("type")).toBe(true);
    foreign!.dispatchEvent(new Event("error"));
    expect(load).toHaveBeenCalledTimes(1);
    playsFrom(video, `${PREVIEW}media/own.mp4`);
    expect([foreign!.hasAttribute("type"), video.getAttribute("crossorigin")]).toEqual([
      false,
      "anonymous",
    ]);
  });
  it("keeps a type the composition writes on a source sitting out a reload", async () => {
    vi.stubGlobal("origin", "null");
    observer = corsForSealedMedia();
    const video = add(
      `<video><source src="https://cdn.example.com/x.webm"><source src="media/own.mp4"></video>`,
    ).querySelector("video")!;
    await settled();
    vi.spyOn(video, "load").mockImplementation(() => {});
    const [foreign] = video.querySelectorAll("source");
    foreign!.dispatchEvent(new Event("error"));
    playsFrom(video, `${PREVIEW}media/own.mp4`);
    foreign!.setAttribute("type", "video/webm");
    playsFrom(video, `${PREVIEW}media/own.mp4`);
    expect(foreign!.getAttribute("type")).toBe("video/webm");
  });

  it("pins out every source ahead of the one playing, past a skipped copy of its URL", async () => {
    vi.stubGlobal("origin", "null");
    observer = corsForSealedMedia();
    const video = add(
      `<video><source src="media/own.mp4" type="video/x-unplayable"><source src="https://cdn.example.com/x.webm"><source src="media/own.mp4"></video>`,
    ).querySelector("video")!;
    await settled();
    vi.spyOn(video, "load").mockImplementation(() => {});
    const foreign = video.querySelectorAll("source")[1]!;
    foreign.dispatchEvent(new Event("error"));
    playsFrom(video, `${PREVIEW}media/own.mp4`);
    expect([video.getAttribute("crossorigin"), foreign.hasAttribute("type")]).toEqual([
      "anonymous",
      true,
    ]);
  });

  it("pins out a failed copy of the playing URL and a foreign source after it", async () => {
    vi.stubGlobal("origin", "null");
    observer = corsForSealedMedia();
    const video = add(
      `<video><source src="media/own.mp4"><source src="https://cdn.example.com/x.webm"><source src="media/own.mp4"></video>`,
    ).querySelector("video")!;
    await settled();
    vi.spyOn(video, "load").mockImplementation(() => {});
    video.dispatchEvent(new Event("loadstart"));
    const [first, foreign, last] = video.querySelectorAll("source");
    first!.dispatchEvent(new Event("error"));
    foreign!.dispatchEvent(new Event("error"));
    playsFrom(video, `${PREVIEW}media/own.mp4`);
    expect([first, foreign, last].map((el) => el!.hasAttribute("type"))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("follows the first source the browser would pick when the list changes", async () => {
    vi.stubGlobal("origin", "null");
    observer = corsForSealedMedia();
    const video = add(`<video><source src="media/a.mp4"></video>`).querySelector("video")!;
    await settled();
    vi.spyOn(video, "load").mockImplementation(() => {});
    video.querySelector("source")!.dispatchEvent(new Event("error"));
    const source = (src: string) => Object.assign(document.createElement("source"), { src });
    video.append(source("media/b.mp4"));
    await settled();
    expect(video.hasAttribute("crossorigin")).toBe(false);
    video.prepend(source("media/c.mp4"));
    await settled();
    expect(video.getAttribute("crossorigin")).toBe("anonymous");
  });

  it("keeps the playhead, rate and play state across its own load", async () => {
    vi.stubGlobal("origin", "null");
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    observer = corsForSealedMedia();
    const video = add(`<video><source src="media/a.mp4"></video>`).querySelector("video")!;
    await settled();
    video.currentTime = 2;
    video.playbackRate = 1.5;
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    vi.spyOn(video, "load").mockImplementation(() => {
      video.currentTime = 0;
      video.playbackRate = 1;
    });
    video.querySelector("source")!.dispatchEvent(new Event("error"));
    expect(video.currentTime).toBeCloseTo(2, 4);
    expect([video.playbackRate, play.mock.calls.length]).toEqual([1.5, 1]);
  });
  it("keeps a crossorigin the composition sets on media that was there when it started", async () => {
    vi.stubGlobal("origin", "null");
    const video = add(`<video src="media/clip.mp4"></video>`).querySelector("video")!;
    observer = corsForSealedMedia();
    expect(video.getAttribute("crossorigin")).toBe("anonymous");
    await settled();
    video.setAttribute("crossorigin", "use-credentials");
    await settled();
    video.setAttribute("src", "https://cdn.example.com/clip.mp4");
    await settled();
    expect(video.getAttribute("crossorigin")).toBe("use-credentials");
  });

  it("leaves an authored crossorigin and its errors alone", async () => {
    vi.stubGlobal("origin", "null");
    observer = corsForSealedMedia();
    const host = add(`<video crossorigin="use-credentials" src="media/own.mp4"></video>`);
    const video = host.querySelector("video")!;
    await settled();
    const load = vi.spyOn(video, "load").mockImplementation(() => {});
    video.dispatchEvent(new Event("error"));
    expect(video.getAttribute("crossorigin")).toBe("use-credentials");
    expect(load).not.toHaveBeenCalled();
  });

  it("changes nothing in a document with its own origin", async () => {
    observer = corsForSealedMedia();
    const host = add(`<video src="media/clip.mp4"></video>`);
    await settled();
    expect(observer).toBeNull();
    expect(host.querySelector("video")!.hasAttribute("crossorigin")).toBe(false);
  });
  it("tries a down source again when the composition calls load(), and only then", async () => {
    vi.stubGlobal("origin", "null");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    observer = corsForSealedMedia();
    const video = add(
      `<video><source src="media/down.mp4"><source src="media/own.mp4"></video>`,
    ).querySelector("video")!;
    await settled();
    const down = video.querySelector("source")!;
    down.dispatchEvent(new Event("error"));
    down.dispatchEvent(new Event("error"));
    playsFrom(video, `${PREVIEW}media/own.mp4`);
    video.dispatchEvent(new Event("loadstart"));
    down.dispatchEvent(new Event("error"));
    expect([video.getAttribute("crossorigin"), load.mock.calls.length]).toEqual(["anonymous", 2]);
    video.load();
    down.dispatchEvent(new Event("error"));
    expect([video.hasAttribute("crossorigin"), load.mock.calls.length]).toEqual([false, 4]);
  });

  // fails without the fix: the runtime's preload load() 2 ms after our reload cleared the mark, costing two loads.
  it("keeps a down mark through a load() made before our reload's selection starts", async () => {
    vi.stubGlobal("origin", "null");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    observer = corsForSealedMedia();
    const video = add(
      `<video><source src="media/down.mp4"><source src="media/own.mp4"></video>`,
    ).querySelector("video")!;
    await settled();
    const down = video.querySelector("source")!;
    down.dispatchEvent(new Event("error"));
    down.dispatchEvent(new Event("error"));
    playsFrom(video, `${PREVIEW}media/own.mp4`);
    preloadMedia(video);
    video.dispatchEvent(new Event("loadstart"));
    down.dispatchEvent(new Event("error"));
    expect([video.getAttribute("crossorigin"), load.mock.calls.length]).toEqual(["anonymous", 3]);
  });

  // fails without the fix: the runtime's binding preload mid-selection cleared the mark; the clip loaded twice more.
  it("keeps a down mark through the runtime's preload in the middle of a selection", async () => {
    vi.stubGlobal("origin", "null");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    observer = corsForSealedMedia();
    const video = add(
      `<video><source src="media/down.mp4"><source src="media/own.mp4"></video>`,
    ).querySelector("video")!;
    await settled();
    const down = video.querySelector("source")!;
    down.dispatchEvent(new Event("error"));
    down.dispatchEvent(new Event("error"));
    playsFrom(video, `${PREVIEW}media/own.mp4`);
    video.dispatchEvent(new Event("loadstart"));
    down.dispatchEvent(new Event("error"));
    preloadMedia(video);
    video.dispatchEvent(new Event("loadstart"));
    down.dispatchEvent(new Event("error"));
    expect([video.getAttribute("crossorigin"), load.mock.calls.length]).toEqual(["anonymous", 3]);
  });

  it("tries a down source again when the composition calls load() after the runtime's preload", async () => {
    vi.stubGlobal("origin", "null");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    observer = corsForSealedMedia();
    const video = add(
      `<video><source src="media/down.mp4"><source src="media/own.mp4"></video>`,
    ).querySelector("video")!;
    await settled();
    const down = video.querySelector("source")!;
    down.dispatchEvent(new Event("error"));
    down.dispatchEvent(new Event("error"));
    playsFrom(video, `${PREVIEW}media/own.mp4`);
    video.dispatchEvent(new Event("loadstart"));
    preloadMedia(video);
    video.load();
    video.dispatchEvent(new Event("loadstart"));
    down.dispatchEvent(new Event("error"));
    expect([video.hasAttribute("crossorigin"), load.mock.calls.length]).toEqual([false, 5]);
  });

  // fails if every load() before loadstart joined our selection: the author's swapped sources kept the old mark.
  it("counts a load() after the author swaps sources before loadstart as a new attempt", async () => {
    vi.stubGlobal("origin", "null");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    observer = corsForSealedMedia();
    const video = add(
      `<video><source src="media/down.mp4"><source src="media/own.mp4"></video>`,
    ).querySelector("video")!;
    await settled();
    const [first, second] = [...video.querySelectorAll("source")];
    first!.dispatchEvent(new Event("error"));
    first!.dispatchEvent(new Event("error"));
    playsFrom(video, `${PREVIEW}media/own.mp4`);
    first!.setAttribute("src", "media/own.mp4");
    second!.setAttribute("src", "media/down.mp4");
    await settled();
    video.load();
    video.dispatchEvent(new Event("loadstart"));
    second!.dispatchEvent(new Event("error"));
    expect([video.hasAttribute("crossorigin"), load.mock.calls.length]).toEqual([false, 4]);
  });

  it("settles the composition's play() with the playback its load retried", async () => {
    vi.stubGlobal("origin", "null");
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined)
      .mockImplementationOnce(() => Promise.reject(new DOMException("load()", "AbortError")))
      .mockImplementationOnce(() => Promise.resolve())
      .mockImplementationOnce(() => Promise.reject(new DOMException("load()", "AbortError")))
      .mockImplementationOnce(() => Promise.reject(new DOMException("none", "NotSupportedError")));
    observer = corsForSealedMedia();
    const [first, second] = [0, 1].map(
      () => add(`<video><source src="media/a.mp4"></video>`).querySelector("video")!,
    );
    await settled();
    const outcomes = [first!, second!].map((video) => {
      vi.spyOn(video, "load").mockImplementation(() => {});
      Object.defineProperty(video, "paused", { configurable: true, value: false });
      const outcome = video.play().then(
        () => "resolved",
        (error: DOMException) => error.name,
      );
      video.querySelector("source")!.dispatchEvent(new Event("error"));
      return outcome;
    });
    expect(await Promise.all(outcomes)).toEqual(["resolved", "NotSupportedError"]);
    expect(play).toHaveBeenCalledTimes(4);
  });
});
