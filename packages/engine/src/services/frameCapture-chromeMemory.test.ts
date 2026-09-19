import { describe, expect, it } from "vitest";
import { classifyChromeProcesses, readChromePids } from "./frameCapture.js";

describe("classifyChromeProcesses", () => {
  it("splits CDP SystemInfo.getProcessInfo rows by type and keeps the browser pid", () => {
    const pids = classifyChromeProcesses(100, [
      { type: "browser", id: 100, cpuTime: 0 },
      { type: "renderer", id: 101, cpuTime: 0 },
      { type: "renderer", id: 102, cpuTime: 0 },
      { type: "GPU", id: 103, cpuTime: 0 },
      { type: "utility", id: 104, cpuTime: 0 },
    ]);
    expect(pids).toEqual({ browser: 100, renderers: [101, 102], gpu: [103] });
  });

  it("works without a browser pid", () => {
    expect(classifyChromeProcesses(undefined, [{ type: "renderer", id: 7, cpuTime: 0 }])).toEqual({
      renderers: [7],
      gpu: [],
    });
  });

  it("keeps the browser pid even when CDP reports no children", () => {
    expect(classifyChromeProcesses(100, [])).toEqual({ browser: 100, renderers: [], gpu: [] });
  });

  it("ignores process types that are neither renderer nor GPU", () => {
    // Guard mutation: dropping the `type` checks would fold utility/browser
    // rows into `renderers` and inflate the renderer peak.
    expect(
      classifyChromeProcesses(1, [
        { type: "utility", id: 2, cpuTime: 0 },
        { type: "browser", id: 1, cpuTime: 0 },
        { type: "gpu", id: 3, cpuTime: 0 },
      ]),
    ).toEqual({ browser: 1, renderers: [], gpu: [] });
  });
});

describe("readChromePids", () => {
  // Chrome answers SystemInfo.getProcessInfo ONLY on the browser target; a
  // page-target session rejects with "is only supported on the browser
  // target". A page session here yields zero samples for the whole render and
  // the telemetry is silently always-null, so the fake refuses it the way
  // Chrome does.
  function fakeCdp(target: "page" | "browser") {
    let detached = false;
    return {
      session: {
        send: async (method: "SystemInfo.getProcessInfo") => {
          if (target === "page") {
            throw new Error(
              `Protocol error (${method}): ${method} is only supported on the browser target`,
            );
          }
          return {
            processInfo: [
              { type: "browser", id: 10, cpuTime: 0 },
              { type: "renderer", id: 11, cpuTime: 0 },
              { type: "GPU", id: 12, cpuTime: 0 },
            ],
          };
        },
        detach: async () => {
          detached = true;
        },
      },
      wasDetached: () => detached,
    };
  }

  it("reads process info from the browser target", async () => {
    const cdp = fakeCdp("browser");
    await expect(readChromePids(10, async () => cdp.session)).resolves.toEqual({
      browser: 10,
      renderers: [11],
      gpu: [12],
    });
    expect(cdp.wasDetached()).toBe(true);
  });

  it("rejects when handed a page-target session, instead of silently sampling nothing", async () => {
    const cdp = fakeCdp("page");
    await expect(readChromePids(10, async () => cdp.session)).rejects.toThrow(
      "only supported on the browser target",
    );
    // Still detached: a failed probe must not leak a CDP session per tick.
    expect(cdp.wasDetached()).toBe(true);
  });
});
