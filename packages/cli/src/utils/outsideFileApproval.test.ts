import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvedOutsideFiles, stageWithOutsideFileApproval } from "./outsideFileApproval.js";
import { stagePublishFiles } from "./publishProject.js";

let root: string;
let project: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hf-outside-approval-"));
  project = join(root, "p");
  mkdirSync(join(root, "shared"), { recursive: true });
  mkdirSync(project);
  writeFileSync(join(root, "shared", "logo.png"), "png");
  writeFileSync(join(project, "index.html"), `<img src="../shared/logo.png">`);
  vi.stubEnv("HYPERFRAMES_CONFIG_DIR", join(root, "config"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

const stage = (onOutsideFile: Parameters<typeof stagePublishFiles>[3]) =>
  stagePublishFiles(project, Infinity, undefined, onOutsideFile);
const extKeys = (staged: Map<string, unknown>) =>
  [...staged.keys()].filter((key) => key.startsWith("_ext/"));

describe("uploading files from outside the project", () => {
  it("leaves them out when nobody can be asked", async () => {
    const { staged, outsideFiles } = await stageWithOutsideFileApproval(
      project,
      { includeAll: false },
      stage,
    );
    expect(extKeys(staged)).toEqual([]);
    expect(outsideFiles).toEqual([]);
  });

  it("asks once, defaulting to no, and leaves them out on no", async () => {
    const ask = vi.fn(async () => false);
    const { staged } = await stageWithOutsideFileApproval(
      project,
      { includeAll: false, ask },
      stage,
    );
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith([expect.objectContaining({ path: "../shared/logo.png" })]);
    expect(extKeys(staged)).toEqual([]);
    expect(approvedOutsideFiles(project).size).toBe(0);
  });

  it("uploads them on yes and remembers that in the config folder, not the project", async () => {
    const ask = vi.fn(async () => true);
    const { staged, outsideFiles } = await stageWithOutsideFileApproval(
      project,
      { includeAll: false, ask },
      stage,
    );
    expect(extKeys(staged)).toEqual(["_ext/shared/logo.png"]);
    expect(outsideFiles).toHaveLength(1);
    expect(existsSync(join(project, ".hyperframes"))).toBe(false);
    const saved = join(root, "config", "outside-files.json");
    if (process.platform !== "win32") expect(statSync(saved).mode & 0o777).toBe(0o600);
    expect(Object.values(JSON.parse(readFileSync(saved, "utf-8")))).toEqual([
      ["../shared/logo.png"],
    ]);

    const again = vi.fn(async () => false);
    const next = await stageWithOutsideFileApproval(
      project,
      { includeAll: false, ask: again },
      stage,
    );
    expect(again).not.toHaveBeenCalled();
    expect(extKeys(next.staged)).toEqual(["_ext/shared/logo.png"]);
  });

  it("asks again about a file approved for another project", async () => {
    await stageWithOutsideFileApproval(
      project,
      { includeAll: false, ask: async () => true },
      stage,
    );
    const other = join(root, "q");
    mkdirSync(other);
    writeFileSync(join(other, "index.html"), `<img src="../shared/logo.png">`);
    const { staged } = await stageWithOutsideFileApproval(other, { includeAll: false }, (gate) =>
      stagePublishFiles(other, Infinity, undefined, gate),
    );
    expect(extKeys(staged)).toEqual([]);
  });

  it("uploads them without asking or remembering with --include-outside-files", async () => {
    const ask = vi.fn(async () => false);
    const { staged } = await stageWithOutsideFileApproval(
      project,
      { includeAll: true, ask },
      stage,
    );
    expect(ask).not.toHaveBeenCalled();
    expect(extKeys(staged)).toEqual(["_ext/shared/logo.png"]);
    expect(approvedOutsideFiles(project).size).toBe(0);
  });
});
