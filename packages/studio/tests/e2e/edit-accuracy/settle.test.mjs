import { describe, expect, it } from "vitest";
import { swapPending, unsettledBy } from "./case.mjs";
import { heldSize } from "./sequences.mjs";

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

  it("never waits on a swap in a case without keyframes, so its undo keeps main's timing", async () => {
    expect(await swapPending({ page: swapping })).toBe(false);
    expect(await swapPending({ page: swapping, keys: undefined, selector: "#other" })).toBe(false);
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
