import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { expect, it, vi } from "vitest";
import check from "./check.js";
import { consumeCommandResult } from "../utils/commandResult.js";
import type { CheckReport } from "../utils/checkPipeline.js";

// The history capture answers only once the check has started: a check that waits for it never runs.
const gate = vi.hoisted(() => {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open: () => open() };
});

vi.mock("../utils/artifactCapture.js", () => ({
  captureArtifactRevision: async () => {
    await gate.opened;
    return undefined;
  },
}));

vi.mock("../utils/checkPipeline.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/checkPipeline.js")>();
  return {
    ...actual,
    runCheckPipeline: (...args: Parameters<typeof actual.runCheckPipeline>) => {
      gate.open();
      return actual.runCheckPipeline(...args);
    },
  };
});

it("runs the check while its history capture is still under way", async () => {
  const project = mkdtempSync(join(tmpdir(), "hf-check-capture-"));
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  writeFileSync(
    join(project, "index.html"),
    "<html><body>Missing composition metadata</body></html>",
  );
  try {
    await runCommand(check, { rawArgs: [project, "--json"] });
    const output = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as CheckReport;
    expect(output.browserSkipped).toBe(true);
    expect(output).not.toHaveProperty("saved");
  } finally {
    log.mockRestore();
    consumeCommandResult();
    rmSync(project, { recursive: true, force: true });
  }
});
