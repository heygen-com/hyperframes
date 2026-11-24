import { SourceIgnoreError, ReviewFailed } from "@hyperframes/share";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "citty";
import { consumeCommandResult } from "../utils/commandResult.js";
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  status: vi.fn(),
  confirm: vi.fn(),
  received: null as null | "unchecked" | { path: string; listed: string[]; hashes: string[] },
  unattended: true,
  progress: undefined as undefined | ((value: { step: string; slow?: boolean } | null) => void),
}));
vi.mock("../utils/project.js", () => ({ resolveProjectOrThrow: () => ({ dir: "/project" }) }));
vi.mock("../utils/privateProjectFile.js", () => ({
  receivedRecordStatus: () => mocks.received,
}));
vi.mock("../utils/attendedTerminal.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/attendedTerminal.js")>()),
  isUnattended: () => mocks.unattended,
}));
vi.mock("../ui/prompts.js", () => ({
  confirm: mocks.confirm,
  select: vi.fn(),
  isCancel: (value: unknown) => typeof value === "symbol",
}));
vi.mock("../share/service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../share/service.js")>()),
  createShareService: (_dir: string, progress: typeof mocks.progress) => {
    mocks.progress = progress;
    return { run: mocks.run, status: mocks.status };
  },
}));
import command from "./share.js";
beforeEach(() => {
  consumeCommandResult();
  mocks.run.mockReset();
  mocks.status.mockReset();
  mocks.confirm.mockReset();
  mocks.received = null;
  mocks.unattended = true;
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
it("escapes dynamic text for terminal output and preserves failure fields in JSON", async () => {
  const raw = "detail" + String.fromCharCode(27, 13, 7, 155, 9, 10);
  const shown = "detail\\x1b\\x0d\\x07\\x9b\\x09\\x0a";
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.run.mockResolvedValue({
    state: "failed",
    source: {},
    version: { failure: raw },
    previousUrl: raw,
  });
  await runCommand(command, { rawArgs: ["--status"] });
  expect(err).toHaveBeenCalledWith(shown);
  expect(out).toHaveBeenCalledWith(`Previous shared version: ${shown}`);
  await runCommand(command, { rawArgs: ["--status", "--json"] });
  expect(JSON.parse(String(out.mock.calls.at(-1)?.[0]))).toMatchObject({
    error: { message: raw },
    version: { failure: raw },
    previousUrl: raw,
  });
  err.mockClear();
  mocks.run.mockRejectedValue(new Error(raw));
  await runCommand(command, { rawArgs: ["--status"] });
  expect(err).toHaveBeenCalledWith(shown);
  await runCommand(command, { rawArgs: ["--status", "--json"] });
  expect(JSON.parse(String(out.mock.calls.at(-1)?.[0])).error.message).toBe(raw);
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

// fails without the fix: the failure line reached the terminal with its control characters live.
it("prints a failure's control characters as visible escapes", async () => {
  const esc = String.fromCharCode(27);
  const friendly = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.run.mockRejectedValue(new Error(`Sharing blocked${esc}[2J.\nTry again`));
  await runCommand(command, { rawArgs: ["--private", "-y"] });
  expect(friendly).toHaveBeenLastCalledWith("Sharing blocked\\x1b[2J.\\x0aTry again");
});

// fails without the fix: a failed export's reason reached the terminal with its control characters live.
it("prints a failed export's control characters as visible escapes", async () => {
  const esc = String.fromCharCode(27);
  const friendly = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.run.mockResolvedValue({
    state: "failed",
    ready: false,
    url: null,
    previousUrl: null,
    manageUrl: "https://hyperframes.dev/shares",
    source: { at: "not_checked" },
    version: { failure: `Export stopped${esc}]0;t${String.fromCharCode(7)}` },
  });
  await runCommand(command, { rawArgs: ["--status"] });
  expect(friendly).toHaveBeenLastCalledWith("Export stopped\\x1b]0;t\\x07");
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

describe("a received folder whose record names an existing review", () => {
  const linked = {
    reviewId: "rev_theirs",
    reviewTitle: "Their \u001b[31mreview",
    share: { projectId: "rev_theirs", access: "private", url: "https://hyperframes.dev/r/theirs" },
    state: "ready",
    ready: true,
    url: "https://hyperframes.dev/r/theirs",
    version: { last: { current: true } },
  };
  beforeEach(() => {
    mocks.received = { path: "/project/.hyperframes/received-files.json", listed: [], hashes: [] };
    mocks.status.mockResolvedValue(linked);
    mocks.run.mockResolvedValue({ state: "ready", ready: true, url: linked.url, source: {} });
  });

  it("shows the review and changes nothing when the person declines", async () => {
    mocks.unattended = false;
    mocks.confirm.mockResolvedValue(false);
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCommand(command, { rawArgs: ["--public"] });
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Share to this review?" }),
    );
    const shown = out.mock.calls.flat().join("\n");
    expect(shown).toContain('Review: "Their \\x1b[31mreview" (rev_theirs)');
    expect(shown).toContain("Link: https://hyperframes.dev/r/theirs");
    expect(err).toHaveBeenCalledWith("Sharing cancelled.");
    expect(consumeCommandResult().exitCode).toBe(2);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("shares to the review the person confirmed", async () => {
    mocks.unattended = false;
    mocks.confirm.mockResolvedValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommand(command, { rawArgs: ["--update"] });
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ action: "update", confirmedReview: "rev_theirs" }),
    );
  });

  it.each([[["--yes"]], [["--json"]], [[]]])(
    "refuses to change it unattended without --review %j",
    async (flags: string[]) => {
      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      await runCommand(command, { rawArgs: ["--update", ...flags] });
      expect(consumeCommandResult().exitCode).toBe(2);
      expect(mocks.confirm).not.toHaveBeenCalled();
      expect(mocks.run).not.toHaveBeenCalled();
      if (flags[0] === "--json")
        expect(JSON.parse(String(out.mock.calls[0]?.[0]))).toMatchObject({
          error: { code: "review_confirmation_required" },
        });
    },
  );

  it("shares unattended to the review --review names", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommand(command, { rawArgs: ["--public", "--review", "rev_theirs", "--json"] });
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ audience: "public", confirmedReview: "rev_theirs" }),
    );
  });

  it("refuses a --review that names another review", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommand(command, { rawArgs: ["--update", "--review", "rev_mine", "--json"] });
    expect(consumeCommandResult().exitCode).toBe(2);
    expect(JSON.parse(String(out.mock.calls[0]?.[0]))).toMatchObject({
      error: { code: "review_mismatch" },
    });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("counts a folder whose received-files records cannot be read as received", async () => {
    mocks.received = "unchecked";
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommand(command, { rawArgs: ["--update", "--json"] });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("returns the existing link without asking, held to the review it read", async () => {
    mocks.status
      .mockResolvedValueOnce(linked)
      .mockResolvedValue({ ...linked, reviewId: "rev_other" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommand(command, { rawArgs: ["--json"] });
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ confirmedReview: "rev_theirs" }),
    );
  });

  it("holds a first share to a new review when the record names none at the read", async () => {
    mocks.status
      .mockResolvedValueOnce({ ...linked, reviewId: null, share: null, ready: false, url: null })
      .mockResolvedValue(linked);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommand(command, { rawArgs: ["--public", "--json"] });
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({ audience: "public", confirmedReview: null }),
    );
  });

  it.each([
    ["a share still in progress", { ...linked, activity: { step: "uploading" }, ready: false }],
    ["an unopened record with no share yet", { ...linked, share: null, ready: false, url: null }],
  ])("refuses unattended without --review for %s", async (_label, state) => {
    mocks.status.mockResolvedValue(state);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommand(command, { rawArgs: ["--json"] });
    expect(consumeCommandResult().exitCode).toBe(2);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("asks nothing in a folder that is not received", async () => {
    mocks.received = null;
    mocks.unattended = false;
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runCommand(command, { rawArgs: ["--update"] });
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.run).toHaveBeenCalledWith(
      expect.not.objectContaining({ confirmedReview: expect.anything() }),
    );
  });
});

// fails without the fix: the finished share's link reached the terminal with its control characters live.
it("prints a ready share's link with control characters as visible escapes", async () => {
  const esc = String.fromCharCode(27);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.run.mockResolvedValue({
    state: "shared",
    ready: true,
    url: `https://hyperframes.dev/review/a${esc}[2J`,
    previousUrl: null,
    manageUrl: "https://hyperframes.dev/shares",
    source: { at: "not_checked" },
    version: {},
  });
  await runCommand(command, { rawArgs: ["--status"] });
  expect(log).toHaveBeenLastCalledWith(
    "Shared video ready: https://hyperframes.dev/review/a\\x1b[2J",
  );
});

// fails without the fix: the earlier version's link reached the terminal with its control characters live.
it("prints the earlier version's link with control characters as visible escapes", async () => {
  const esc = String.fromCharCode(27);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.run.mockResolvedValue({
    state: "failed",
    ready: false,
    url: null,
    previousUrl: `https://hyperframes.dev/review/b${esc}[2J`,
    manageUrl: "https://hyperframes.dev/shares",
    source: { at: "not_checked" },
    version: { failure: "Export stopped" },
  });
  await runCommand(command, { rawArgs: ["--status"] });
  expect(log).toHaveBeenLastCalledWith(
    "Previous shared version: https://hyperframes.dev/review/b\\x1b[2J",
  );
});
