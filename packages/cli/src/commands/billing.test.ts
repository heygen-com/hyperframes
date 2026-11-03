import { runCommand } from "citty";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";

const opened = vi.hoisted(() => [] as string[]);

vi.mock("../auth/browser.js", () => ({
  openBrowser: async (url: string) => void opened.push(url),
}));
vi.mock("../heygen/plan.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../heygen/plan.js")>();
  let calls = 0;
  return {
    ...real,
    readPlan: async () => ({ plan: ++calls === 1 ? "none" : "pro", credits: 0 }),
  };
});

const { default: billing } = await import("./billing.js");

afterEach(() => {
  opened.length = 0;
  vi.restoreAllMocks();
  consumeCommandResult();
});

describe("billing subscribe", () => {
  it("opens the plans page credited to the feature and run that sent the person", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const done = runCommand(billing, {
      rawArgs: ["subscribe", "--feature", "reverse", "--session", "rvs_abc"],
    });
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    vi.useRealTimers();
    const url = new URL(opened[0] ?? "");
    expect(url.searchParams.get("feature")).toBe("reverse");
    expect(url.searchParams.get("rs")).toBe("rvs_abc");
  });
});
