import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import render from "./render.js";
import { CliUsageError, consumeCommandResult } from "../../utils/commandResult.js";

const bodies: unknown[] = [];
const baseArgs = ["--asset-id", "asst_fixture", "--no-wait", "--json"];

beforeEach(() => {
  bodies.length = 0;
  vi.stubEnv("HEYGEN_API_KEY", "fixture-key");
  vi.stubEnv("HEYGEN_API_URL", "https://cloud.fixture.invalid");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    expect(String(url)).toBe("https://cloud.fixture.invalid/v3/hyperframes/renders");
    expect(init?.method).toBe("POST");
    if (typeof init?.body !== "string") throw new Error("Expected a JSON submit body");
    const body: unknown = JSON.parse(init.body);
    bodies.push(body);
    return Response.json({ data: { render_id: "hfr_fixture" } }, { status: 202 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  consumeCommandResult();
});

describe("cloud render page motion blur", () => {
  it("writes explicit off into the public API request", async () => {
    await runCommand(render, { rawArgs: [...baseArgs, "--page-motion-blur", "off"] });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toHaveProperty("page_motion_blur", "off");
    expect(bodies[0]).not.toHaveProperty("pageMotionBlur");
  });

  it("omits the override when the flag is absent", async () => {
    await runCommand(render, { rawArgs: baseArgs });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty("page_motion_blur");
  });

  it.each(["on", "false", "", "OFF"])("rejects %j before any cloud request", async (value) => {
    await expect(
      runCommand(render, { rawArgs: [...baseArgs, "--page-motion-blur", value] }),
    ).rejects.toThrow(CliUsageError);
    expect(bodies).toHaveLength(0);
  });
});
