import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runCommand } from "citty";
import { consumeCommandResult } from "../utils/commandResult.js";
const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../utils/project.js", () => ({ resolveProjectOrThrow: () => ({ dir: "/project" }) }));
vi.mock("../share/service.js", () => ({ createShareService: () => ({ run: mocks.run }) }));
import command from "./share.js";
beforeEach(() => {
  consumeCommandResult();
  mocks.run.mockResolvedValue({
    state: "failed",
    ready: false,
    url: null,
    previousUrl: "https://hyperframes.dev/r/previous",
    manageUrl: "https://hyperframes.dev/shares",
    source: { at: "not_checked" },
    version: { failure: "This video can't be shared." },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  consumeCommandResult();
});
it("returns a failure envelope and the previous ready URL for a failed status", async () => {
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  await runCommand(command, { rawArgs: ["--status", "--json"] });
  expect(consumeCommandResult().exitCode).toBe(1);
  expect(out).toHaveBeenCalledOnce();
  expect(JSON.parse(String(out.mock.calls[0]?.[0]))).toMatchObject({
    ok: false,
    state: "failed",
    ready: false,
    url: null,
    previousUrl: "https://hyperframes.dev/r/previous",
    error: { code: "share_export_failed", message: "This video can't be shared." },
  });
});
it("reports the failed attempt on stderr without calling the previous version ready", async () => {
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  await runCommand(command, { rawArgs: ["--status"] });
  expect(consumeCommandResult().exitCode).toBe(1);
  expect(err).toHaveBeenCalledWith("This video can't be shared.");
  expect(out).toHaveBeenCalledWith("Previous shared version: https://hyperframes.dev/r/previous");
  expect(out.mock.calls.flat().join(" ")).not.toContain("still processing");
});
it("still opens management when the latest export failed", async () => {
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  await runCommand(command, { rawArgs: ["--manage", "--json"] });
  expect(consumeCommandResult().exitCode).toBe(0);
  expect(JSON.parse(String(out.mock.calls[0]?.[0])).ok).toBe(true);
});
