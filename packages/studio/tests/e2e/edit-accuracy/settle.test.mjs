import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  STILL_FRAMES,
  backgroundRequest,
  heldStill,
  measureShown,
  networkBusy,
  openStudio,
  seekBound,
  swapPending,
  unsettledBy,
  waitingQuad,
} from "./case.mjs";
import { heldSize, keyedBy, restedFor, shownOnceRested } from "./sequences.mjs";

describe("settling on the shown preview", () => {
  const read = (pending, x = 0, frames = "a") => ({
    pending,
    frames,
    m: {
      visible: [
        [x, 0],
        [x + 1, 0],
        [x + 1, 1],
        [x, 1],
      ],
    },
  });

  it("keeps waiting while a shadow preview is loading, and restarts once it is promoted", () => {
    expect(unsettledBy(read(false), read(false))).toBe(false);
    expect(unsettledBy(read(false), read(true))).toBe(true);
    expect(unsettledBy(read(true), read(false))).toBe(true);
    expect(unsettledBy(read(false), read(false, 0.02))).toBe(true);
  });

  const frame = (url, shown, holds) => ({
    url: () => url,
    frameElement: async () => ({ evaluate: async () => shown }),
    $: async () => (holds ? {} : null),
  });
  const keys = { times: [0, 3] };
  const page = (...frames) => ({ frames: () => frames });
  const swapping = page(frame("/preview/a", true, true), frame("/preview/a?_t=1", false, true));

  it("calls a swap pending only for a hidden preview that holds the target", async () => {
    expect(await swapPending({ page: page(frame("/preview/a", true, true)), keys })).toBe(false);
    expect(await swapPending({ page: swapping, keys })).toBe(true);
    expect(await swapPending({ page: page(frame("/preview/a?_t=1", false, false)), keys })).toBe(
      false,
    );
    expect(await swapPending({ page: page(frame("/studio", false, true)), keys })).toBe(false);
  });

  it("reads a preview that went away mid-read as holding nothing, not as an error", async () => {
    const gone = {
      url: () => "/preview/a?_t=1",
      frameElement: async () => ({
        evaluate: async () => {
          throw new Error("Attempted to use detached Frame");
        },
      }),
      $: async () => ({}),
    };
    expect(await swapPending({ page: page(gone), keys })).toBe(false);
  });

  it("reads a frame detached before the read as holding nothing: puppeteer throws that synchronously", async () => {
    const detached = () => {
      throw new Error("Attempted to use detached Frame");
    };
    const gone = { url: () => "/preview/a?_t=1", frameElement: detached, $: detached };
    const hostGone = { ...frame("/preview/a?_t=1", false, true), $: detached };
    expect(await swapPending({ page: page(gone), keys })).toBe(false);
    expect(await swapPending({ page: page(hostGone), keys })).toBe(false);
  });

  it("calls a swap pending while Studio says the preview is changing, with no hidden preview yet", async () => {
    const changing = (on) => ({ frames: () => [], evaluate: async () => on });
    expect(await swapPending({ page: changing(true), keys })).toBe(true);
    expect(await swapPending({ page: changing(false), keys })).toBe(false);
    expect(await swapPending({ page: changing(true) }), "a case without keyframes").toBe(false);
  });

  it("never waits on a swap in a case without keyframes, so its undo keeps main's timing", async () => {
    expect(await swapPending({ page: swapping })).toBe(false);
    expect(await swapPending({ page: swapping, keys: undefined, selector: "#other" })).toBe(false);
  });
});

describe("a plain element that gains keyframes mid-sequence", () => {
  const changing = { frames: () => [], evaluate: async () => true };
  const plain = () => ({ A: { page: changing }, B: { page: changing } });

  it("waits out Studio's swap from the step that writes its first keyframe", async () => {
    const ctx = plain();
    keyedBy(ctx, { do: "drag" }, { autokey: false });
    expect(await swapPending(ctx.A), "a drag with auto-keyframe off writes none").toBe(false);
    keyedBy(ctx, { do: "addkey" }, { autokey: false });
    expect(await swapPending(ctx.A)).toBe(true);
  });

  it("keys the element a drag with auto-keyframe on moved, and only that one", async () => {
    const ctx = plain();
    keyedBy(ctx, { do: "drag", element: "B" }, { autokey: true });
    expect([await swapPending(ctx.A), await swapPending(ctx.B)]).toEqual([false, true]);
  });
});

describe("settling on the page's network", () => {
  const read = (busy, activity) => ({
    pending: false,
    frames: "a",
    m: { visible: [[0, 0]] },
    net: { busy, activity },
  });

  it("restarts on a request in flight or any network activity since the window began", () => {
    expect(unsettledBy(read(false, 3), read(false, 3))).toBe(false);
    expect(unsettledBy(read(false, 3), read(true, 3))).toBe(true);
    expect(unsettledBy(read(false, 3), read(false, 4))).toBe(true);
  });

  it("holds after STILL_FRAMES quiet reads, or after the fixed window when one is set", () => {
    const since = Date.now();
    expect(heldStill(read(false, 0), STILL_FRAMES - 1, since, null)).toBe(false);
    expect(heldStill(read(false, 0), STILL_FRAMES, since, null)).toBe(true);
    expect(heldStill(read(true, 0), STILL_FRAMES, since, null)).toBe(false);
    expect(heldStill({ ...read(false, 0), pending: true }, STILL_FRAMES, since, null)).toBe(false);
    expect(heldStill(read(false, 0), 100, since, 500)).toBe(false);
    expect(heldStill(read(false, 0), 0, since - 500, 500)).toBe(true);
  });

  it("restarts a window that began busy once its request's frame is gone", () => {
    const request = { frame: () => ({ detached: false }) };
    const net = {
      inflight: new Set([request]),
      activity: 0,
      announced: new Map(),
      since: Date.now(),
    };
    const ctx = { dir: tmpdir(), files: [], net };
    const start = { ...read(false, 0), net: networkBusy(ctx) };
    expect(start.net.busy).toBe(true);
    request.frame = () => null;
    const now = { ...read(false, 0), net: networkBusy(ctx) };
    expect(now.net.busy).toBe(false);
    expect(unsettledBy(start, now)).toBe(true);
  });

  it("never waits on thumbnails, their blob images or background lint, which do not change the preview", () => {
    const request = (url, type = "fetch") => ({ url: () => url, resourceType: () => type });
    const api = "http://127.0.0.1:5910/api/projects/case";
    expect(backgroundRequest(request(`${api}/lint`))).toBe(true);
    expect(backgroundRequest(request(`${api}/thumbnail/index.html?t=3.00`))).toBe(true);
    expect(backgroundRequest(request(`${api}/events`, "eventsource"))).toBe(true);
    expect(backgroundRequest(request("blob:http://127.0.0.1:5910/7baf001f", "image"))).toBe(true);
    expect(backgroundRequest(request(`${api}/preview`, "document"))).toBe(false);
    expect(backgroundRequest(request(`${api}/files/index.html`))).toBe(false);
    expect(backgroundRequest(request(`${api}/lint-rules`))).toBe(false);
  });

  it("waits for requests in live frames and for the server to announce each written file", () => {
    const dir = mkdtempSync(join(tmpdir(), "edit-bench-net-"));
    try {
      writeFileSync(join(dir, "index.html"), "");
      const since = Date.now() / 1000;
      utimesSync(join(dir, "index.html"), since - 10, since - 10);
      const request = (detached) => ({ frame: () => (detached === null ? null : { detached }) });
      const live = request(false);
      const net = {
        inflight: new Set([live, request(true), request(null)]),
        activity: 7,
        announced: new Map(),
        since: since * 1000,
      };
      const ctx = { dir, files: ["index.html"], net };
      expect(networkBusy(ctx)).toEqual({ busy: true, activity: 9 });
      expect([...net.inflight]).toEqual([live]);
      net.inflight.clear();
      expect(networkBusy(ctx).busy).toBe(false);
      utimesSync(join(dir, "index.html"), since + 5, since + 5);
      expect(networkBusy(ctx).busy).toBe(true);
      net.announced.set("index.html", since * 1000 + 6000);
      expect(networkBusy(ctx).busy).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("seeking to the playhead after a reload", () => {
  it("seeks only once Studio reports the composition's duration, so the timeline bind cannot replay it", async () => {
    // Studio before its timeline bind: a seek still moves the playhead, but the duration reads 0.
    const calls = [];
    let looks = 0;
    const studio = {
      studio_look: () => ({ ok: true, duration: ++looks > 2 ? 4 : 0 }),
      studio_seek: ({ time }) => ({ ok: true, playhead: time, duration: looks > 2 ? 4 : 0 }),
    };
    globalThis.window = {
      __editBench: { call: (name, args) => (calls.push(name), studio[name](args)) },
    };
    const host = { evaluate: async () => true, boundingBox: async () => ({ width: 1, height: 1 }) };
    const preview = { url: () => "/preview", $: async () => ({}), frameElement: async () => host };
    const page = { evaluate: async (fn, ...args) => fn(...args), frames: () => [preview] };
    try {
      expect(await seekBound({ page, playhead: 2 })).toMatchObject({ playhead: 2, duration: 4 });
      expect(calls).toEqual(["studio_look", "studio_look", "studio_look", "studio_seek"]);
    } finally {
      delete globalThis.window;
    }
  });

  it("waits in the page for Studio to report the composition loaded, and names its last report if it never does", async () => {
    let loaded;
    const page = {
      waitForFunction: async (fn) => {
        loaded = fn;
        throw new Error("Waiting failed: 90000ms exceeded");
      },
      evaluate: async () => ({ ok: true, duration: 0, playhead: 0, sceneStatus: "loading" }),
    };
    await expect(openStudio({ page })).rejects.toThrow(
      'studio never reported the composition loaded: last {"duration":0,"playhead":0,"scene":"loading"}',
    );
    let duration = 0;
    globalThis.window = {};
    try {
      expect(await loaded(), "before Studio registers its tools").toBe(false);
      window.__editBench = { has: () => true, call: async () => ({ ok: true, duration }) };
      expect(await loaded(), "before the timeline bind").toBe(false);
      duration = 4;
      expect(await loaded()).toBe(true);
    } finally {
      delete globalThis.window;
    }
  });
});

describe("the size auto-record keys hold", () => {
  const keys = new Map([
    [3, { width: 440, height: 294 }],
    [2, { width: 380, height: 250 }],
  ]);

  it("holds the first key before it and the last after it, and leaves eased spans unscored", () => {
    expect(heldSize(keys, 1)).toEqual({ width: 380, height: 250 });
    expect(heldSize(keys, 3)).toEqual({ width: 440, height: 294 });
    expect(heldSize(keys, 5)).toEqual({ width: 440, height: 294 });
    expect(heldSize(keys, 2.5)).toBeUndefined();
    expect(heldSize(new Map(), 1)).toBeUndefined();
  });
});

describe("the box a press is measured against", () => {
  const quad = (x) => [
    [x, 0],
    [x + 1, 0],
    [x + 1, 1],
    [x, 1],
  ];
  const marker = (answers) => ({
    evaluate: async () => answers.shift() ?? false,
    dispose: async () => {},
  });
  const read = async () => ({ map: { toComp: (p) => p }, visible: quad(0) });
  const page = (markers) => ({ $: async () => markers.shift() ?? null });

  it("reads the waiting marker while a press waits for its replay, not the element under it", async () => {
    const shown = await measureShown({ page: page([marker([true])]) }, "move", read, async () =>
      quad(260),
    );
    expect(shown.m.visible[0][0]).toBe(260);
    expect(shown.actual[0][0]).toBe(0);
  });

  // fails without the fix: the press itself read the waiting outline, so a sealed press jumped 0.2 px.
  it("reads the element at the press, before the pointer moves", async () => {
    const shown = await measureShown(
      { page: { $: async (selector) => (selector.includes('="frame"') ? null : marker([true])) } },
      "move",
      read,
      async () => quad(260),
      false,
    );
    expect(shown.m.visible[0][0]).toBe(0);
  });

  // fails without the fix: a press made while Studio saved read the element, still where the last save
  // left it, 312 px from the box Studio draws at the pointer.
  it("reads the waiting box at the press while it waits on a save", async () => {
    const shown = await measureShown(
      { page: { $: async () => marker([true]) } },
      "move",
      read,
      async () => quad(260),
      false,
    );
    expect(shown.m.visible[0][0]).toBe(260);
  });

  it("reads the element when nothing waits", async () => {
    const shown = await measureShown({ page: page([]) }, "move", read, async () => quad(260));
    expect(shown.m.visible[0][0]).toBe(0);
  });

  it("reads again when the replay took the marker away between the two reads", async () => {
    const shown = await measureShown({ page: page([marker([false])]) }, "move", read, async () =>
      quad(260),
    );
    expect(shown.m.visible[0][0]).toBe(0);
  });

  // fails without the fix: a sealed fast-keys drag threw "element has no rendered box" when Studio
  // remounted the selection box right after the replay, before the marker's box was read.
  it("reads again when Studio took the waiting box out of the page before its box was read", async () => {
    const gone = async () => {
      throw new Error("element has no rendered box");
    };
    const shown = await measureShown({ page: page([marker([false])]) }, "move", read, gone);
    expect(shown.m.visible[0][0]).toBe(0);
  });

  it("still fails when a waiting box in the page has no box", async () => {
    const empty = async () => {
      throw new Error("element has no rendered box");
    };
    await expect(
      measureShown({ page: page([marker([true])]) }, "move", read, empty),
    ).rejects.toThrow("element has no rendered box");
  });

  // The box as each read finds it: Studio's own check runs on it, in the page or out of it.
  const box = (...states) => ({
    evaluate: async (check) => {
      const [isConnected, waiting] = states.shift() ?? [false, false];
      return check({ isConnected, hasAttribute: () => waiting });
    },
    dispose: async () => {},
  });
  const gone = async () => {
    throw new Error("element has no rendered box");
  };
  const map = { toComp: (p) => p };

  it("does not take the quad of a box that left the page, still marked waiting, after it was read", async () => {
    const shown = await measureShown({ page: page([box([false, true])]) }, "move", read, async () =>
      quad(260),
    );
    expect(shown.m.visible[0][0]).toBe(0);
  });

  // fails without the fix: the read before the press threw when Studio remounted the waiting box first.
  it("before the press, a waiting box that left the page is no waiting box", async () => {
    expect(await waitingQuad(page([box([false, false])]), map, gone)).toBeNull();
    expect(await waitingQuad(page([box([false, true])]), map, async () => quad(260))).toBeNull();
  });

  it("before the press, a waiting box in the page gives its quad, or fails when it has none", async () => {
    expect((await waitingQuad(page([box([true, true])]), map, async () => quad(260)))[0][0]).toBe(
      260,
    );
    await expect(waitingQuad(page([box([true, true])]), map, gone)).rejects.toThrow(
      "element has no rendered box",
    );
  });
});

// fails without the fix: the sequence read the file once its write count was met, while a sealed press that waited for
// the previous save was still saving, so the last gesture's edit looked lost.
describe("the end of a sequence", () => {
  // Each frame advances a fake clock by 10 ms, so the times are exact.
  const reads = (states) => {
    let [at, ms] = [0, 0];
    return {
      busy: async () => states[Math.min(at++, states.length - 1)],
      frame: async () => void (ms += 10),
      now: () => ms,
      read: () => at,
    };
  };

  it("waits until no press waits and no edit saves, two reads in a row", async () => {
    const { busy, frame, now, read } = reads([true, true, false, true, false, false, true]);
    await restedFor(busy, frame, { now });
    expect(read()).toBe(6);
  });

  it("says how long until the first of the clear reads, the undo's time to show", async () => {
    const { busy, frame, now } = reads([true, true, false, false]);
    expect(await restedFor(busy, frame, { now })).toBe(20);
  });

  // fails without the fix: the undo was read while its reload was on the way, 240-329 px from where it landed.
  it("reads an undo's box once Studio says its reload is done, and how long that took", async () => {
    const { busy, frame, now, read } = reads([true, true, true, false, false]);
    const settle = async () => (read() > 3 ? "undone" : "before");
    expect(await shownOnceRested(busy, frame, settle, { now })).toEqual({
      box: "undone",
      shownMs: 30,
    });
  });

  it("gives up with a reason when an edit never stops saving", async () => {
    const { busy, frame, now } = reads([true]);
    await expect(restedFor(busy, frame, { now, timeout: 30 })).rejects.toThrow(
      /still waiting or saving/,
    );
  });
});
