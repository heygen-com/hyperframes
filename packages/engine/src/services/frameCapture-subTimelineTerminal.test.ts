import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import { pollSubCompositionTimelines } from "./frameCapture.js";

const PENDING_ID = "scene\u001b]0;title\u0007";

// The id scan returns a composition id that carries terminal controls; every other evaluate says "not ready".
function pageWithPendingId(): Page {
  return {
    evaluate: vi.fn(async (expr: string | (() => unknown)) => {
      if (typeof expr === "function") return true;
      return expr.includes("m.push(id)") ? [PENDING_ID] : false;
    }),
  } as unknown as Page;
}

function printedWarnings(warn: ReturnType<typeof vi.spyOn>): string {
  return warn.mock.calls.map((call: unknown[]) => call.join(" ")).join("\n");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pollSubCompositionTimelines warnings that name compositions and scripts", () => {
  it("write control characters out as visible escapes when a script failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const outcome = await pollSubCompositionTimelines(pageWithPendingId(), 60_000, {
      intervalMs: 5,
      getScriptLoadFailures: () => ["http://localhost/a\u001b[2K.js"],
      scriptFailureGraceMs: 10,
    });

    expect(outcome).toBe("script_failure");
    const printed = printedWarnings(warn);
    expect(printed).toContain("a\\x1b[2K.js");
    expect(printed).toContain("scene\\x1b]0;title\\x07");
    for (const control of ["\u001b", "\u0007"]) expect(printed).not.toContain(control);
  });

  it("write control characters out as visible escapes when the wait times out", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const outcome = await pollSubCompositionTimelines(pageWithPendingId(), 30, { intervalMs: 5 });

    expect(outcome).toBe("timeout");
    const printed = printedWarnings(warn);
    expect(printed).toContain("scene\\x1b]0;title\\x07");
    for (const control of ["\u001b", "\u0007"]) expect(printed).not.toContain(control);
  });
});
