import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const demoHtml = readFileSync(
  resolve(__dirname, "../../../../registry/examples/airbnb-deck/demo.html"),
  "utf8",
);

it("accepts only current-player sound names while preserving unlock and mute behavior", async () => {
  const clips: Array<{
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    volume: number;
    currentTime: number;
  }> = [];
  const dom = new JSDOM(demoHtml, {
    runScripts: "dangerously",
    beforeParse(window) {
      Object.defineProperty(window, "Audio", {
        value: function () {
          const clip = {
            play: vi.fn(() => Promise.resolve()),
            pause: vi.fn(),
            volume: 1,
            currentTime: 0,
          };
          clips.push(clip);
          return clip;
        },
      });
    },
  });
  try {
    const w = dom.window;
    const player = w.document.querySelector("hyperframes-player")!;
    const frame = w.document.createElement("iframe");
    player.append(frame);
    Object.defineProperty(player, "iframeElement", { get: () => player.querySelector("iframe") });
    const original = frame.contentWindow;
    const send = (source: MessageEventSource | null, name: unknown) =>
      w.dispatchEvent(new w.MessageEvent("message", { source, data: { type: "hf-sfx", name } }));
    send(original, "advance");
    expect(clips.every((clip) => clip.play.mock.calls.length === 0)).toBe(true);
    w.dispatchEvent(new w.Event("pointerdown"));
    await Promise.resolve();
    clips.forEach((clip) => clip.play.mockClear());
    for (const name of ["advance", "fragment", "branch-enter", "back"]) send(original, name);
    expect(clips.map((clip) => clip.play.mock.calls.length)).toEqual([1, 1, 1, 1]);
    for (const name of ["__proto__", "constructor", "unknown", ["advance"]]) send(original, name);
    expect(Object.hasOwn(w.Object.prototype, "currentTime")).toBe(false);
    send(null, "advance");
    const foreign = w.document.createElement("iframe");
    w.document.body.append(foreign);
    send(foreign.contentWindow, "advance");
    expect(clips.map((clip) => clip.play.mock.calls.length)).toEqual([1, 1, 1, 1]);
    const replacement = w.document.createElement("iframe");
    frame.replaceWith(replacement);
    send(original, "advance");
    expect(clips[0]!.play).toHaveBeenCalledTimes(1);
    send(replacement.contentWindow, "advance");
    expect(clips[0]!.play).toHaveBeenCalledTimes(2);
    const slideshow = w.document.querySelector("hyperframes-slideshow")!;
    slideshow.dispatchEvent(new w.CustomEvent("hf-sound", { detail: { muted: true } }));
    send(replacement.contentWindow, "advance");
    expect(clips[0]!.play).toHaveBeenCalledTimes(2);
    slideshow.dispatchEvent(new w.CustomEvent("hf-sound", { detail: { muted: false } }));
    send(replacement.contentWindow, "advance");
    expect(clips[0]!.play).toHaveBeenCalledTimes(3);
    expect(clips.map((clip) => clip.volume)).toEqual([0.45, 0.4, 0.4, 0.4]);
  } finally {
    dom.window.close();
  }
});
