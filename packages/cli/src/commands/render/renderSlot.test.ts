import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderLockOptions } from "../../utils/renderLock.js";
import type { RenderPlan } from "./plan.js";

const ESC = String.fromCharCode(27);
const ODD = `od${ESC}[2Jd\x07`;
const SHOWN = "od\\x1b[2Jd\\x07";

vi.mock("../../utils/renderLock.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/renderLock.js")>()),
  acquireRenderLock: async (options: RenderLockOptions) => {
    options.onWait?.(
      { pid: 7, project: `/films/${ODD}`, startedAt: Date.now() } as never,
      `/locks/${ODD}/render.lock`,
    );
    return () => {};
  },
}));

const { acquireRenderSlot } = await import("./renderSlot.js");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("waiting for the render slot", () => {
  // fails without the fix: the other render's project and the lock's path are printed as they were read.
  it("shows control characters in the holder and the lock path as text", async () => {
    const said: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      said.push(args.join(" "));
    });
    const plan = { project: { dir: "/films/mine" }, waitForRenderSlot: true } as RenderPlan;
    await acquireRenderSlot(plan);
    const line = said.join("\n").replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
    expect(line).toContain(`pid 7, project /films/${SHOWN}, running 0s`);
    expect(line).toContain(`Lock: /locks/${SHOWN}/render.lock`);
    expect(line).not.toContain(ESC);
    expect(line).not.toContain("\x07");
  });
});
