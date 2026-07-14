import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: vi.fn((_command: string, args: string[]) => {
      if (args[0] === "whisper") return "/fake/python-whisper\n";
      throw new Error(`${args[0]} not found`);
    }),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

describe("findWhisper", () => {
  it("does not treat the OpenAI Python whisper command as whisper.cpp", async () => {
    const { findWhisper } = await import("./manager.js");

    expect(findWhisper()).toBeUndefined();
  });
});
