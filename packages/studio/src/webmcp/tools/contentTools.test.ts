// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  studioSetStyle,
  studioSetText,
  type ContentToolDeps,
  type StudioSetStyleResult,
  type StudioSetTextResult,
} from "./contentTools";
import { expectFailure, expectOk, previewElement, selectionFor } from "../webmcpTestUtils";

function contentDeps(overrides: Partial<ContentToolDeps> = {}): ContentToolDeps {
  const element = previewElement('<h1 id="headline">Ship it</h1>', "headline");
  return {
    getCurrentSelection: () => selectionFor(element),
    getWriteBlockedReason: () => null,
    setText: async () => ({ ok: true }),
    setStyle: async () => ({ ok: true }),
    ...overrides,
  };
}

describe("studioSetText", () => {
  it("writes the text and reports what it now is", async () => {
    const setText = vi.fn(async () => ({ ok: true }) as const);

    const result = await studioSetText(contentDeps({ setText }), { text: "Ship it faster" });

    const ok = expectOk<StudioSetTextResult>(result);
    expect(ok.text).toBe("Ship it faster");
    expect(ok.changed).toBe(true);
    expect(setText).toHaveBeenCalledWith("Ship it faster", undefined);
  });

  it("reports changed:false when the text already said that", async () => {
    const result = await studioSetText(contentDeps(), { text: "Ship it" });

    expect(expectOk<StudioSetTextResult>(result).changed).toBe(false);
  });

  it("refuses to write while a conflict is waiting for the user", async () => {
    // The paused-save and conflict states are banners with no lock behind them.
    // Nothing else stops a programmatic write landing on top of a decision the
    // user has been asked to make.
    const setText = vi.fn();

    const result = expectFailure(
      await studioSetText(
        contentDeps({
          getWriteBlockedReason: () => "an external change to this file is waiting to be resolved",
          setText,
        }),
        { text: "Ship it faster" },
      ),
    );

    expect(result.kind).toBe("blocked");
    expect(result.reason).toMatch(/external change/);
    expect(setText).not.toHaveBeenCalled();
  });

  it("does not report success when the commit declined", async () => {
    // The whole reason the handlers now return an outcome: they resolve on
    // failure, so awaiting them proves nothing.
    const result = expectFailure(
      await studioSetText(
        contentDeps({ setText: async () => ({ ok: false, reason: "persist-failed" }) }),
        { text: "Ship it faster" },
      ),
    );

    expect(result.kind).toBe("failed");
    expect(result.reason).toMatch(/persist-failed/);
  });

  it("turns a decline reason into a hint naming what to do instead", async () => {
    const result = expectFailure(
      await studioSetText(
        contentDeps({ setText: async () => ({ ok: false, reason: "not-text-editable" }) }),
        { text: "x" },
      ),
    );

    expect(result.kind).toBe("blocked");
    expect(result.hint).toMatch(/studio_inspect/);
  });

  it("rejects a non-string text without dispatching", async () => {
    const setText = vi.fn();

    const result = expectFailure(await studioSetText(contentDeps({ setText }), { text: 42 }));

    expect(result.kind).toBe("invalid");
    expect(setText).not.toHaveBeenCalled();
  });

  it("fails when nothing is selected", async () => {
    const setText = vi.fn();

    const result = expectFailure(
      await studioSetText(contentDeps({ getCurrentSelection: () => null, setText }), { text: "x" }),
    );

    expect(result.kind).toBe("invalid");
    expect(result.hint).toMatch(/studio_select/);
    expect(setText).not.toHaveBeenCalled();
  });
});

describe("studioSetStyle", () => {
  it("applies every property and reports them", async () => {
    const setStyle = vi.fn(async () => ({ ok: true }) as const);

    const result = await studioSetStyle(contentDeps({ setStyle }), {
      styles: { color: "red", "font-size": "48px" },
    });

    const ok = expectOk<StudioSetStyleResult>(result);
    expect(ok.applied).toEqual({ color: "red", "font-size": "48px" });
    expect(ok.rejected).toEqual({});
    expect(setStyle).toHaveBeenCalledTimes(2);
  });

  it("commits sequentially, never concurrently", async () => {
    // Two commits racing through Studio's client-side read-modify-write can
    // record undo entries that both claim the same starting content.
    let inFlight = 0;
    let maxInFlight = 0;
    const setStyle = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { ok: true } as const;
    });

    await studioSetStyle(contentDeps({ setStyle }), {
      styles: { color: "red", "font-size": "48px", opacity: "0.5" },
    });

    expect(maxInFlight).toBe(1);
  });

  it("reports a partial success as partial, not whole", async () => {
    const setStyle = vi.fn(async (property: string) =>
      property === "left"
        ? ({ ok: false, reason: "geometry-property" } as const)
        : ({ ok: true } as const),
    );

    const result = await studioSetStyle(contentDeps({ setStyle }), {
      styles: { color: "red", left: "10px" },
    });

    const ok = expectOk<StudioSetStyleResult>(result);
    expect(ok.applied).toEqual({ color: "red" });
    expect(ok.rejected).toEqual({ left: "geometry-property" });
  });

  it("fails when every property was refused", async () => {
    const result = expectFailure(
      await studioSetStyle(
        contentDeps({ setStyle: async () => ({ ok: false, reason: "styles-not-editable" }) }),
        { styles: { color: "red" } },
      ),
    );

    expect(result.kind).toBe("blocked");
    expect(result.reason).toMatch(/styles-not-editable/);
  });

  it("rejects an empty styles object rather than committing nothing", async () => {
    const setStyle = vi.fn();

    const result = expectFailure(await studioSetStyle(contentDeps({ setStyle }), { styles: {} }));

    expect(result.kind).toBe("invalid");
    expect(setStyle).not.toHaveBeenCalled();
  });

  it("rejects a non-object styles value", async () => {
    for (const styles of ["color: red", 42, null, ["color"]]) {
      const result = expectFailure(await studioSetStyle(contentDeps(), { styles }));
      expect(result.kind).toBe("invalid");
    }
  });

  it("refuses to write while a conflict is waiting for the user", async () => {
    const setStyle = vi.fn();

    const result = expectFailure(
      await studioSetStyle(
        contentDeps({ getWriteBlockedReason: () => "Auto-save is paused", setStyle }),
        { styles: { color: "red" } },
      ),
    );

    expect(result.kind).toBe("blocked");
    expect(setStyle).not.toHaveBeenCalled();
  });
});
