import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { openProjectHistory } from "@hyperframes/studio-server/history";
import { historyDeps } from "../utils/historyOwner.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { expect, it, vi } from "vitest";
import check from "./check.js";
import { consumeCommandResult } from "../utils/commandResult.js";
import { checkExitCode, type CheckReport } from "../utils/checkPipeline.js";

it("persists real lint-blocked reports without overwriting earlier checks or inventing a revision", async () => {
  const project = mkdtempSync(join(tmpdir(), "hf-check-artifacts-"));
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  writeFileSync(
    join(project, "index.html"),
    "<html><body>Missing composition metadata</body></html>",
  );
  try {
    for (let i = 0; i < 2; i++) {
      await runCommand(check, { rawArgs: [project, "--json"] });
      consumeCommandResult();
    }
    const state = JSON.parse(readFileSync(join(project, ".hyperframes/video-state.json"), "utf8"));
    expect(state.checks.unversioned).toHaveLength(2);
    const [first, second] = state.checks.unversioned;
    expect(first.report).not.toBe(second.report);
    expect(first.report).toBe(
      join(project, ".hyperframes", "artifacts", "checks", `${first.id}.json`),
    );
    expect(JSON.parse(readFileSync(first.report, "utf8")).browserSkipped).toBe(true);
    expect(state.checks.latest).toEqual({ revision: null, id: second.id });
    expect(state.checks.revisions).toEqual({});
    const output = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
    expect(output.saved).toEqual({
      id: second.id,
      revision: null,
      report: second.report,
      attribution: "unversioned",
    });
    expect(output.browserSkipped).toBe(true);
  } finally {
    log.mockRestore();
    consumeCommandResult();
    rmSync(project, { recursive: true, force: true });
  }
});

it("only warns when the report cannot be recorded; the exit status is the check's own", async () => {
  const project = mkdtempSync(join(tmpdir(), "hf-check-unrecorded-"));
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  writeFileSync(
    join(project, "index.html"),
    "<html><body>Missing composition metadata</body></html>",
  );
  mkdirSync(join(project, ".hyperframes", "artifacts"), { recursive: true });
  writeFileSync(join(project, ".hyperframes", "artifacts", "checks"), "not a directory");
  try {
    await runCommand(check, { rawArgs: [project, "--json"] });
    const output = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as CheckReport;
    expect(output).not.toHaveProperty("saved");
    expect(output.browserSkipped).toBe(true);
    expect(consumeCommandResult().exitCode).toBe(checkExitCode(output));
    expect(String(warn.mock.calls.at(-1)?.[0])).toContain("Check report was not recorded");
  } finally {
    log.mockRestore();
    warn.mockRestore();
    consumeCommandResult();
    rmSync(project, { recursive: true, force: true });
  }
});

it("records the check when another process holds history, without waiting for it", async () => {
  const project = mkdtempSync(join(tmpdir(), "hf-check-history-held-"));
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  writeFileSync(
    join(project, "index.html"),
    "<html><body>Missing composition metadata</body></html>",
  );
  const previousWait = historyDeps.ownerWaitMs;
  // A wait for the holder outlasts the test: recording the report must not take it.
  historyDeps.ownerWaitMs = 60_000;
  const held = await openProjectHistory({
    projectDir: project,
    historyRoot: historyDeps.historyRoot,
    ownerWaitMs: 0,
  });
  try {
    await runCommand(check, { rawArgs: [project, "--json"] });
    const output = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as CheckReport;
    expect(output).toHaveProperty("saved.id");
    expect(output.browserSkipped).toBe(true);
    expect(consumeCommandResult().exitCode).toBe(checkExitCode(output));
    expect(warn.mock.calls.flat().join("\n")).not.toContain("not recorded");
  } finally {
    historyDeps.ownerWaitMs = previousWait;
    await held.close();
    log.mockRestore();
    warn.mockRestore();
    consumeCommandResult();
    rmSync(project, { recursive: true, force: true });
  }
});

// Windows refuses control characters in folder names.
it.skipIf(process.platform === "win32")(
  "prints the report path and the not-recorded warning with control characters as visible escapes",
  async () => {
    // Built rather than written: a literal control character in the source is a lint error.
    const esc = String.fromCharCode(27);
    const parent = mkdtempSync(join(tmpdir(), "hf-check-escapes-"));
    const project = join(parent, `video${esc}]0;x${String.fromCharCode(7)}${esc}[2J`);
    mkdirSync(join(project, ".hyperframes", "artifacts"), { recursive: true });
    writeFileSync(
      join(project, "index.html"),
      "<html><body>Missing composition metadata</body></html>",
    );
    writeFileSync(join(project, ".hyperframes", "artifacts", "checks"), "not a directory");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await runCommand(check, { rawArgs: [project, "--json"] });
      const printed = [...error.mock.calls, ...warn.mock.calls]
        .map((call) => call.join(" "))
        .join("\n");

      expect(printed.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "")).not.toContain(esc);
      expect(printed).toContain("the report is saved to");
      expect(printed).toContain("Check report was not recorded");
      expect(printed.match(/video\\x1b\]0;x\\x07\\x1b\[2J/g)?.length).toBeGreaterThanOrEqual(2);
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0])).browserSkipped).toBe(true);
    } finally {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
      consumeCommandResult();
      rmSync(parent, { recursive: true, force: true });
    }
  },
);
