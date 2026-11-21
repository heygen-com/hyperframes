import { afterEach, describe, expect, it, vi } from "vitest";
import {
  holdScenes,
  markScenesStaleIn,
  parseHoldScenes,
  parseMarkScenesStale,
  parseSwapScenes,
  swapScenes,
} from "./scenes";

afterEach(() => {
  delete window.__hfHoldScenes;
  delete window.__hfSwapScenes;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("hold-scenes", () => {
  it("waits for the runtime to mount the named scenes", async () => {
    let mounted = false;
    window.__hfHoldScenes = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      mounted = true;
    });
    expect(await holdScenes({ names: ["intro"] })).toEqual({ held: true });
    expect(window.__hfHoldScenes).toHaveBeenCalledWith(["intro"]);
    expect(mounted).toBe(true);
  });

  it("says nothing was held where the preview mounts every scene", async () => {
    expect(await holdScenes({ names: ["intro"] })).toEqual({ held: false });
  });
});

describe("swap-scenes", () => {
  it("swaps from the sent document", async () => {
    window.__hfSwapScenes = vi.fn(async () => {});
    expect(await swapScenes({ html: "<p>next</p>", timeoutMs: 5000 })).toEqual({ swapped: true });
    expect(window.__hfSwapScenes).toHaveBeenCalledWith("<p>next</p>", expect.any(AbortSignal));
  });

  it("answers the runtime's refusal as data", async () => {
    window.__hfSwapScenes = async () => {
      throw new Error("scenes were added or removed");
    };
    expect(await swapScenes({ html: "<p></p>", timeoutMs: 5000 })).toEqual({
      swapped: false,
      reason: "Error: scenes were added or removed",
    });
  });

  it("aborts a swap that outlasts its time", async () => {
    let signal: AbortSignal | undefined;
    window.__hfSwapScenes = (_html, s) => {
      signal = s;
      return new Promise((_resolve, reject) =>
        s?.addEventListener("abort", () => reject(s.reason)),
      );
    };
    const reply = await swapScenes({ html: "<p></p>", timeoutMs: 20 });
    expect(signal?.aborted).toBe(true);
    expect(reply).toEqual({ swapped: false, reason: "Error: the swap took too long" });
  });
});

describe("mark-scenes-stale", () => {
  it("clears the hash of each scene a file is inlined in, and the shared hash for a file with no host", () => {
    document.head.innerHTML = `<meta name="hf-scene-parts" content='{"shared":"s","scenes":{"a":"1","b":"2"}}'>`;
    document.body.innerHTML = `<div data-hf-scene="a"><div data-composition-file="card.html"></div></div>`;

    markScenesStaleIn(document, ["card.html", "index.html"]);

    const meta = document.querySelector("meta")!;
    expect(JSON.parse(meta.content)).toEqual({ shared: "", scenes: { a: "", b: "2" } });
  });
});

describe("scene parsers", () => {
  it("accept bounded requests", () => {
    expect(parseHoldScenes({ names: ["a"] })).toEqual({ names: ["a"] });
    expect(parseMarkScenesStale({ files: ["a.html"] })).toEqual({ files: ["a.html"] });
    expect(parseSwapScenes({ html: "<p></p>", timeoutMs: 5000 })).toEqual({
      html: "<p></p>",
      timeoutMs: 5000,
    });
  });

  it.each([
    ["a hold with an extra field", () => parseHoldScenes({ names: [], holder: "x" })],
    ["a hold of a non-string", () => parseHoldScenes({ names: [1] })],
    ["a stale mark of too many files", () => parseMarkScenesStale({ files: Array(257).fill("a") })],
    ["a swap with no html", () => parseSwapScenes({ html: "", timeoutMs: 5000 })],
    ["a swap with no deadline", () => parseSwapScenes({ html: "<p></p>", timeoutMs: 0 })],
    ["a swap with a script field", () => parseSwapScenes({ html: "x", timeoutMs: 1, script: "" })],
  ])("refuse %s", (_label, parse) => {
    expect(parse()).toBeNull();
  });
});
