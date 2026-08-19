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
