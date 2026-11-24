import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
      mkdirSync(join(dir, ".hyperframes", "backup"), { recursive: true });
      writeFileSync(join(dir, ".hyperframes", "backup", "scene"), "<div>before</div>");
      const receipt = {
        file,
        version: fileContentVersion("<div>after</div>"),
        backupPath: ".hyperframes/backup/scene",
      };
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await runUndo({ dir, receipt: JSON.stringify(receipt) });

      expect(readFileSync(join(dir, file), "utf-8")).toBe("<div>before</div>");
      expect(log.mock.calls.map((call) => call.join(" "))).toEqual(["undid sc\\x07ene.html"]);
      consumeCommandResult();
    },
  );

  // fails without the fix: the receipt's paths were joined onto the project folder and followed wherever they led
  describe("refuses a receipt that reaches outside what the timeline edits", () => {
    const AFTER = "<div>after</div>";
    const OUTSIDE = "outside the project";
    function setup() {
      const root = mkdtempSync(join(tmpdir(), "hf-timeline-undo-paths-"));
      dirs.push(root);
      const dir = join(root, "project");
      mkdirSync(join(dir, ".hyperframes", "backup"), { recursive: true });
      mkdirSync(join(dir, ".git"));
      writeFileSync(join(dir, "index.html"), AFTER);
      writeFileSync(join(dir, ".git", "config"), AFTER);
      writeFileSync(join(dir, ".hyperframes", "backup", "index"), "<div>before</div>");
      writeFileSync(join(root, "outside.html"), AFTER);
      writeFileSync(join(root, "secret.txt"), OUTSIDE);
      const links = process.platform !== "win32";
      if (links) {
        symlinkSync(join(root, "outside.html"), join(dir, "linked.html"));
        symlinkSync(join(root, "secret.txt"), join(dir, ".hyperframes", "backup", "linked"));
      }
      const snapshot = () =>
        [
          join(dir, "index.html"),
          join(dir, ".git", "config"),
          join(root, "outside.html"),
          join(root, "secret.txt"),
        ].map((path) => readFileSync(path, "utf-8"));
      return { root, dir, links, snapshot };
    }

    const cases: Array<[string, (root: string) => { file: string; backupPath: string }, boolean?]> =
      [
        [
          "a target above the project",
          () => ({ file: "../outside.html", backupPath: ".hyperframes/backup/index" }),
        ],
        [
          "an absolute target",
          (root) => ({ file: join(root, "outside.html"), backupPath: ".hyperframes/backup/index" }),
        ],
        [
          "a protected target in the project",
          () => ({ file: ".git/config", backupPath: ".hyperframes/backup/index" }),
        ],
        [
          "a target that links outside",
          () => ({ file: "linked.html", backupPath: ".hyperframes/backup/index" }),
          true,
        ],
        ["a backup above the project", () => ({ file: "index.html", backupPath: "../secret.txt" })],
        [
          "a backup climbing out of the backup folder",
          () => ({ file: "index.html", backupPath: ".hyperframes/backup/../../../secret.txt" }),
        ],
        [
          "an absolute backup",
          (root) => ({ file: "index.html", backupPath: join(root, "secret.txt") }),
        ],
        [
          "a backup outside the backup folder",
          () => ({ file: "index.html", backupPath: "index.html" }),
        ],
        [
          "a backup that links outside",
          () => ({ file: "index.html", backupPath: ".hyperframes/backup/linked" }),
          true,
        ],
      ];

    it.each(cases)("%s", async (_name, receiptFor, needsLinks) => {
      const { root, dir, links, snapshot } = setup();
      if (needsLinks && !links) return;
      const before = snapshot();
      const receipt = { ...receiptFor(root), version: fileContentVersion(AFTER) };
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await runUndo({ dir, json: true, receipt: JSON.stringify(receipt) });

      expect(consumeCommandResult().exitCode).toBe(2);
      const printed = JSON.parse(String(log.mock.calls[0]?.[0]));
      expect(printed.ok).toBe(false);
      expect(printed.reason).toMatch(/^timeline undo: /);
      expect(JSON.stringify(printed)).not.toContain(OUTSIDE);
      expect(snapshot()).toEqual(before);
    });
  });
});
