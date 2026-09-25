import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";
import { runIds } from "./a2Commands.js";

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
    vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    await runIds({ dir, json: true });

    expect(readFileSync(indexPath, "utf-8")).toBe(save);
    expect(consumeCommandResult().exitCode).toBe(2);
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toMatchObject({
      ok: false,
      reason: "file changed since the timeline was read",
    });
  });
});
