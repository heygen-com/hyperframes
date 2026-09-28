import { describe, expect, it, vi } from "vitest";
import { CliRuntimeError } from "../utils/commandResult.js";
import projectsCommand from "./projects.js";

describe("hyperframes projects", () => {
  it("refuses a root it cannot read instead of reporting no projects", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const run = projectsCommand.run!({ args: { json: true, root: "/no/such/folder" } } as never);

    await expect(run).rejects.toBeInstanceOf(CliRuntimeError);
    expect(log).not.toHaveBeenCalled();
  });
});
