import { runCommand } from "citty";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";

const opened = vi.hoisted(() => [] as string[]);
const plan = vi.hoisted(() => ({ calls: 0 }));

vi.mock("../auth/browser.js", () => ({
  openBrowser: async (url: string) => void opened.push(url),
}));
vi.mock("../heygen/plan.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../heygen/plan.js")>();
  return {
    ...real,
    readPlan: async () => ({
      plan: ++plan.calls === 1 ? "none" : "pro",
      credits: plan.calls === 1 ? 0 : 500,
    }),
  };
});

const { default: billing } = await import("./billing.js");

afterEach(() => {
  opened.length = 0;
  plan.calls = 0;
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

describe("billing add-credits", () => {
  it.each(["add-credits", "top-up"])(
    "opens the credits page for `%s`, with no notice",
    async (name) => {
      vi.stubEnv("HYPERFRAMES_PLANS_URL", "https://plans.test/p");
      vi.stubEnv("HYPERFRAMES_CREDITS_URL", "https://credits.test/c");
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.useFakeTimers();
      const done = runCommand(billing, { rawArgs: [name] });
      await vi.advanceTimersByTimeAsync(2000);
      await done;
      vi.useRealTimers();
      vi.unstubAllEnvs();
      expect(new URL(opened[0] ?? "").origin).toBe("https://credits.test");
      expect(error).not.toHaveBeenCalled();
      expect(log.mock.calls.flat().join("\n")).not.toMatch(/deprecat|renamed|top-up/i);
    },
  );
});
