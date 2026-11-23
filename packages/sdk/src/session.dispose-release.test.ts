import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { openComposition } from "./index.js";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

const HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width: 320px; height: 180px" data-duration="1">
  <h1 data-hf-id="hf-title">Owned title</h1>
</div>
`.trim();

const SWAPS = 10;

describe("session disposal releases the parsed film", () => {
  it("keeps no parsed document alive for a disposed session that is still referenced", async () => {
    // Studio's closures and React fibers keep replaced sessions reachable, so the
    // sessions stay referenced here and only their documents may be freed.
    const stale = [];
    const films: WeakRef<object>[] = [];
    for (let i = 0; i < SWAPS; i++) {
      const comp = await openComposition(HTML, { history: false });
      films.push(
        new WeakRef((comp as unknown as { parsed: { document: object } }).parsed.document),
      );
      comp.dispose();
      stale.push(comp);
    }
    // A WeakRef target survives the job that created or read it.
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    gc();
    await new Promise<void>((resolve) => setImmediate(resolve));
    gc();
    expect(stale).toHaveLength(SWAPS);
    expect(films.filter((film) => film.deref() !== undefined)).toHaveLength(0);
  });

  it("warns once outside production when a disposed session is read, and answers empty", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const comp = await openComposition(HTML, { history: false });
      expect(comp.getElements()).not.toHaveLength(0);
      expect(warn).not.toHaveBeenCalled();
      comp.dispose();
      expect(comp.getElements()).toEqual([]);
      expect(comp.getRootElements()).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("disposed Composition was read");
    } finally {
      warn.mockRestore();
    }
  });
});
