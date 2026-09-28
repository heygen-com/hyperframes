import { describe, expect, it } from "vitest";
import { CliUsageError } from "../utils/commandResult.js";
import projectsCommand from "./projects.js";

describe("hyperframes projects", () => {
  it("refuses a root that is not a folder instead of reporting no projects", async () => {
    const run = projectsCommand.run!({ args: { json: true, root: "/no/such/folder" } } as never);

    await expect(run).rejects.toBeInstanceOf(CliUsageError);
  });
});
