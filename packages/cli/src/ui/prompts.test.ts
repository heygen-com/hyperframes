import { afterEach, describe, expect, it, vi } from "vitest";
import { CliUsageError } from "../utils/commandResult.js";

const state = vi.hoisted(() => ({ unattended: true }));
vi.mock("../utils/attendedTerminal.js", () => ({ isUnattended: () => state.unattended }));
const clack = vi.hoisted(() => ({
  confirm: vi.fn(async () => true),
  select: vi.fn(async () => "a"),
  text: vi.fn(async () => "t"),
  password: vi.fn(async () => "p"),
  spinner: vi.fn(() => ({ fromClack: true })),
}));
vi.mock("@clack/prompts", () => clack);

const prompts = await import("./prompts.js");

afterEach(() => {
  vi.clearAllMocks();
  state.unattended = true;
});

describe("prompt wrapper", () => {
  it.each([
    ["confirm", () => prompts.confirm({ message: "?" })],
    ["select", () => prompts.select({ message: "?", options: [{ value: "a" }] })],
    ["text", () => prompts.text({ message: "?" })],
    ["password", () => prompts.password({ message: "?" })],
  ])("%s refuses to prompt when unattended", (name, ask) => {
    expect(ask).toThrow(CliUsageError);
    expect(clack[name as keyof typeof clack]).not.toHaveBeenCalled();
  });

  it("asks when a person is at the terminal", async () => {
    state.unattended = false;
    await expect(prompts.confirm({ message: "?" })).resolves.toBe(true);
  });

  it("confirmationRequired is a usage error that carries the hint", () => {
    try {
      prompts.confirmationRequired("hyperframes publish", "Pass --yes.");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CliUsageError);
      expect((error as CliUsageError).result.exitCode).toBe(2);
      expect((error as CliUsageError).hint).toBe("Pass --yes.");
    }
  });

  it("an unattended spinner writes its start and outcome, not its progress, on stderr", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const spin = prompts.spinner();
      spin.start("\u001b[36mTranscoding\u001b[39m clip.mov");
      spin.message("Still transcoding...");
      spin.stop("\u001b[32mDone\u001b[39m");
      expect(write.mock.calls).toEqual([["Transcoding clip.mov\n"], ["Done\n"]]);
      expect(clack.spinner).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });

  it("an attended spinner is clack's", () => {
    state.unattended = false;
    expect(prompts.spinner()).toEqual({ fromClack: true });
  });
});
