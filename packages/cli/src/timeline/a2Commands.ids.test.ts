import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";
import { fileContentVersion } from "@hyperframes/studio-server";
import { readEditPlan, runIds, runUndo } from "./a2Commands.js";

const hooks = vi.hoisted(() => ({ minting: undefined as (() => void) | undefined }));
vi.mock("@hyperframes/parsers/hf-ids", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/parsers/hf-ids")>();
  return {
    ...actual,
    ensureHfIds: (html: string) => {
      hooks.minting?.();
      return actual.ensureHfIds(html);
    },
  };
});

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("timeline ids", () => {
  it("keeps a save that lands while ids are minted instead of writing over it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-timeline-ids-"));
    dirs.push(dir);
    const indexPath = join(dir, "index.html");
    writeFileSync(
      indexPath,
      `<div data-composition-id="main" data-duration="4"><div id="clip" data-start="0" data-duration="2" data-track-index="0"></div></div>`,
    );
    const save = `<div data-composition-id="main" data-duration="4"><div id="clip" data-start="1" data-duration="2" data-track-index="0"></div></div>`;
    hooks.minting = () => {
      hooks.minting = undefined;
      writeFileSync(indexPath, save);
    };
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runIds({ dir, json: true });

    expect(readFileSync(indexPath, "utf-8")).toBe(save);
    expect(consumeCommandResult().exitCode).toBe(2);
    expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0]))).toMatchObject({
      ok: false,
      error: { code: "refused", message: "file changed since the timeline was read" },
      reason: "file changed since the timeline was read",
    });
  });
});

describe("timeline apply plan file", () => {
  it("reads an edit plan saved with a UTF-8 BOM", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-timeline-plan-"));
    dirs.push(dir);
    const file = join(dir, "plan.json");
    writeFileSync(file, '\uFEFF[{"op":"trim"}]');
    expect(readEditPlan(file)).toEqual({ ok: true, edits: [{ op: "trim" }] });
  });
});

describe("timeline undo", () => {
  // fails without the fix: the file named in the receipt was printed as it is on disk
  // Windows refuses control characters in file names.
  it.skipIf(process.platform === "win32")(
    "shows control characters in the undone file's name as text",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-timeline-undo-"));
      dirs.push(dir);
      const file = "sc\u0007ene.html";
      writeFileSync(join(dir, file), "<div>after</div>");
      writeFileSync(join(dir, "backup.html"), "<div>before</div>");
      const receipt = {
        file,
        version: fileContentVersion("<div>after</div>"),
        backupPath: "backup.html",
      };
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await runUndo({ dir, receipt: JSON.stringify(receipt) });

      expect(readFileSync(join(dir, file), "utf-8")).toBe("<div>before</div>");
      expect(log.mock.calls.map((call) => call.join(" "))).toEqual(["undid sc\\x07ene.html"]);
      consumeCommandResult();
    },
  );
});
