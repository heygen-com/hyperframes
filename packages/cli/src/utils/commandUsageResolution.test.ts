import { describe, expect, it, vi } from "vitest";
import { defineCommand } from "citty";
import { resolveCommandUsage } from "./commandUsageResolution.js";

describe("resolveCommandUsage", () => {
  it("resolves the deepest lazy subcommand and its immediate parent", async () => {
    const render = defineCommand({
      meta: { name: "render" },
      args: { fps: { type: "string" } },
    });
    const loadRender = vi.fn(async () => render);
    const cloud = defineCommand({
      meta: { name: "cloud" },
      subCommands: { render: loadRender },
    });
    const root = defineCommand({
      meta: { name: "hyperframes" },
      subCommands: { cloud: async () => cloud },
    });

    const resolved = await resolveCommandUsage(root, ["cloud", "render", "--help"]);

    expect(resolved.command).toBe(render);
    expect(resolved.parent).toBe(cloud);
    expect(loadRender).toHaveBeenCalledTimes(1);
  });

  it("keeps group and root help at the requested level", async () => {
    const cloud = defineCommand({ meta: { name: "cloud" }, subCommands: {} });
    const root = defineCommand({
      meta: { name: "hyperframes" },
      subCommands: { cloud: async () => cloud },
    });

    expect((await resolveCommandUsage(root, ["cloud", "--help"])).command).toBe(cloud);
    expect((await resolveCommandUsage(root, ["--help"])).command).toBe(root);
  });
});

describe("resolveCommandUsage path and unknown words", () => {
  const render = defineCommand({ meta: { name: "render" } });
  const cloud = defineCommand({ meta: { name: "cloud" }, subCommands: { render } });
  const root = defineCommand({ meta: { name: "hyperframes" }, subCommands: { cloud } });

  it("returns the words that named the command", async () => {
    expect((await resolveCommandUsage(root, ["cloud", "render", "x"])).path).toEqual([
      "cloud",
      "render",
    ]);
  });

  it("names the first word that is not a subcommand of a group", async () => {
    const resolved = await resolveCommandUsage(root, ["cloud", "rendr"]);
    expect(resolved.command).toBe(cloud);
    expect(resolved.path).toEqual(["cloud"]);
    expect(resolved.unknownSubcommand).toBe("rendr");
  });

  it("does not treat a leaf command's positional as an unknown command", async () => {
    expect(
      (await resolveCommandUsage(root, ["cloud", "render", "./dir"])).unknownSubcommand,
    ).toBeUndefined();
  });
});
