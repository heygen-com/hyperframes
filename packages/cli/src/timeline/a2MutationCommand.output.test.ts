import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";
import { runMutation } from "./a2MutationCommand.js";

// Only a test that sets `receipts.version` changes what the write reports; the write itself is real.
const receipts = vi.hoisted(() => ({ version: undefined as string | undefined }));
vi.mock("@hyperframes/studio-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/studio-server")>();
  return {
    ...actual,
    applyFileMutations: (...args: Parameters<typeof actual.applyFileMutations>) =>
      actual
        .applyFileMutations(...args)
        .map((receipt) => ({ ...receipt, version: receipts.version ?? receipt.version })),
  };
});

const dirs: string[] = [];
afterEach(() => {
  receipts.version = undefined;
  consumeCommandResult();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A one-clip project; `clip` is the clip's attributes. */
function project(clip: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-timeline-output-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "index.html"),
    `<div data-composition-id="main" data-duration="12">\n<div ${clip} data-start="1" data-duration="2" data-track-index="0"></div>\n</div>`,
  );
  return dir;
}

const printed = (spy: { mock: { calls: unknown[][] } }): string =>
  spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");

// fails without the fix: the clip's id from the file and the receipt's version were printed as they arrived
it("shows control characters in a moved clip's name and its receipt as text", async () => {
  const dir = project('id="cl\u0007ip"');
  receipts.version = "v1\u0007";
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  await runMutation("move", { dir, ref: "#cl\u0007ip", time: "4" });

  expect(printed(log)).toBe("move #cl\\x07ip: 1-3s -> 4-6s\nreceipt: v1\\x07");
});

// fails without the fix: the changed lines of the file were printed as they are in the file
it("shows control characters in a planned change's diff as text", async () => {
  const dir = project('id="clip" title="a\u0007b"');
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  await runMutation("move", { dir, ref: "#clip", time: "4", plan: true });

  const diff = printed(log).split("\ndiff:\n")[1];
  expect(diff).toContain('title="a\\x07b"');
  expect(diff).toContain("\n");
  expect(diff).not.toContain("\u0007");
});

// fails without the fix: each changed line of a file with Windows line endings ended in a visible \x0d
it("leaves a Windows line ending out of a planned change's diff and still shows one inside a line", async () => {
  const dir = project('id="clip" title="a\rb"');
  const file = join(dir, "index.html");
  writeFileSync(file, readFileSync(file, "utf8").replaceAll("\n", "\r\n"));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  await runMutation("move", { dir, ref: "#clip", time: "4", plan: true });

  const lines = printed(log).split("\ndiff:\n")[1]!.split("\n");
  expect(lines.filter((line) => line.includes('title="a\\x0db"'))).toHaveLength(2);
  expect(lines.filter((line) => line.endsWith("\\x0d") || line.includes("\r"))).toEqual([]);
});
