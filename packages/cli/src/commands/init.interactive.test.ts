import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";

const prompts = vi.hoisted(() => ({ errors: [] as string[], typedName: "" }));

vi.mock("@clack/prompts", () => ({
  intro: () => undefined,
  cancel: () => undefined,
  isCancel: () => false,
  text: async () => prompts.typedName,
  log: { error: (message: string) => prompts.errors.push(message) },
}));
vi.mock("../ui/banner.js", () => ({ printBanner: () => undefined }));

describe("interactive init with a name too long for a folder", () => {
  let dir: string;
  let stdoutTty: PropertyDescriptor | undefined;
  const unit = process.platform === "linux" ? "bytes" : "characters";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-init-interactive-"));
    prompts.errors = [];
    stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    if (stdoutTty) Object.defineProperty(process.stdout, "isTTY", stdoutTty);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
    rmSync(dir, { recursive: true, force: true });
  });

  const runInit = async (rawArgs: string[]) => {
    const command = (await import("./init.js")).default;
    await runCommand(command, { rawArgs });
  };

  it("shows the plain sentence for a name given on the command line, before any folder is made", async () => {
    const target = `${dir}/${"z".repeat(257)}/../${"a".repeat(256)}`;
    await expect(runInit([target])).rejects.toThrow("Command failed");
    expect(prompts.errors).toEqual([
      `That name is 256 ${unit} long; a folder name can be at most 255 ${unit}.`,
    ]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("shows the plain sentence for a name typed into the prompt", async () => {
    prompts.typedName = `${dir}/${"z".repeat(301)}/../${"b".repeat(300)}`;
    await expect(runInit([])).rejects.toThrow("Command failed");
    expect(prompts.errors).toEqual([
      `That name is 300 ${unit} long; a folder name can be at most 255 ${unit}.`,
    ]);
    expect(readdirSync(dir)).toEqual([]);
  });
});
