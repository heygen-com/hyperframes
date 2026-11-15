import { SourceIgnoreError, ReviewFailed } from "@hyperframes/share";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runCommand } from "citty";
import { consumeCommandResult } from "../utils/commandResult.js";
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  progress: undefined as undefined | ((value: { step: string; slow?: boolean } | null) => void),
}));
vi.mock("../utils/project.js", () => ({ resolveProjectOrThrow: () => ({ dir: "/project" }) }));
vi.mock("../share/service.js", () => ({
  createShareService: (_dir: string, progress: typeof mocks.progress) => {
    mocks.progress = progress;
    return { run: mocks.run };
  },
}));
import command from "./share.js";
beforeEach(() => {
  consumeCommandResult();
  mocks.run.mockReset();
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

it.each(["--status", "--manage", "--update"])(
  "rejects ignored audience flags with %s",
  async (action) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommand(command, { rawArgs: [action, "--public", "--json"] });
    expect(consumeCommandResult().exitCode).toBe(2);
    expect(mocks.run).not.toHaveBeenCalled();
  },
);
it("says there is nothing to manage before a first share", async () => {
  mocks.run.mockResolvedValue({ state: "not_shared" });
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  await runCommand(command, { rawArgs: ["--manage", "--json"] });
  expect(JSON.parse(String(out.mock.calls[0]?.[0]))).toMatchObject({
    ok: false,
    error: { code: "not_shared" },
  });
});

it("deduplicates progress and terminates each message before the friendly error", async () => {
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const friendly = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.run.mockImplementation(async () => {
    mocks.progress?.({ step: "preparing" });
    mocks.progress?.({ step: "preparing" });
    mocks.progress?.({ step: "uploading" });
    mocks.progress?.(null);
    throw new Error("Sharing blocked.");
  });
  await runCommand(command, { rawArgs: ["--private", "-y"] });
  expect(err.mock.calls.map(([message]) => message)).toEqual([
    "Sharing: preparing\n",
    "Sharing: uploading\n",
  ]);
  expect(friendly).toHaveBeenCalledWith("Sharing blocked.");
});

it.each(["owner@example.com", "another@example.com"])(
  "keeps the owner error code stable for %s",
  async (owner) => {
    mocks.run.mockRejectedValue(new ReviewFailed(403, `owner_signed_out:${owner}`));
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommand(command, { rawArgs: ["--status", "--json"] });
    expect(consumeCommandResult().exitCode).toBe(1);
    expect(out).toHaveBeenCalledOnce();
    expect(JSON.parse(String(out.mock.calls[0]?.[0]))).toEqual({
      ok: false,
      error: {
        code: "owner_signed_out",
        owner,
        message: `This review belongs to ${owner}. Switch to that account to manage it.`,
      },
    });
  },
);

it("reports an unchanged update in human and JSON output", async () => {
  mocks.run.mockResolvedValue({
    state: "ready",
    ready: true,
    upToDate: true,
    source: { at: "ready" },
  });
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  await runCommand(command, { rawArgs: ["--update"] });
  expect(out).toHaveBeenCalledWith("Already up to date.");
  await runCommand(command, { rawArgs: ["--update", "--json"] });
  expect(JSON.parse(String(out.mock.calls.at(-1)?.[0]))).toMatchObject({
    ok: true,
    upToDate: true,
  });
});

it("reports a specific code for an invalid ignore file", async () => {
  mocks.run.mockRejectedValue(new SourceIgnoreError("Invalid ignore pattern"));
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  await runCommand(command, { rawArgs: ["--public", "--json"] });
  expect(JSON.parse(String(out.mock.calls[0]?.[0]))).toMatchObject({
    ok: false,
    error: { code: "invalid_source_ignore" },
  });
});

it.each([[[]], [["--json"]], [["--yes"]], [["--video-only"]]])(
  "defaults to video-only without source consent %j",
  async (flags) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runCommand(command, { rawArgs: ["--public", ...flags] });
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ includeSource: false }));
  },
);
it("accepts explicit source inclusion and rejects conflicting choices", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  await runCommand(command, { rawArgs: ["--public", "--include-source", "--json"] });
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ includeSource: true }));
  mocks.run.mockClear();
  await runCommand(command, {
    rawArgs: ["--public", "--include-source", "--video-only", "--json"],
  });
  expect(consumeCommandResult().exitCode).toBe(2);
  expect(mocks.run).not.toHaveBeenCalled();
});
