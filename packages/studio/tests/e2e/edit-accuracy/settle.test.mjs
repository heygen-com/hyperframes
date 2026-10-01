import { describe, expect, it } from "vitest";
import { swapPending, unsettledBy } from "./case.mjs";

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

  it("calls a swap pending only for a hidden preview that holds the target", async () => {
    const frame = (url, shown, holds) => ({
      url: () => url,
      frameElement: async () => ({ evaluate: async () => shown }),
      $: async () => (holds ? {} : null),
    });
    const page = (...frames) => ({ frames: () => frames });
    expect(await swapPending(page(frame("/preview/a", true, true)))).toBe(false);
    expect(
      await swapPending(
        page(frame("/preview/a", true, true), frame("/preview/a?_t=1", false, true)),
      ),
    ).toBe(true);
    expect(await swapPending(page(frame("/preview/a?_t=1", false, false)))).toBe(false);
    expect(await swapPending(page(frame("/studio", false, true)))).toBe(false);
  });
});
