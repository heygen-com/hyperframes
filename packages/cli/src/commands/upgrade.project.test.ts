import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../utils/updateCheck.js", async (orig) => ({
  ...(await orig<typeof import("../utils/updateCheck.js")>()),
  checkForUpdate: vi.fn(async () => ({
    current: "0.7.48",
    latest: "0.7.55",
    updateAvailable: true,
  })),
}));

import { resolveProjectArgs, upgradeProjectPins } from "./upgrade.js";

describe("resolveProjectArgs", () => {
  it("reclaims a flag eaten as the --project value", () => {
    expect(resolveProjectArgs("--check", { check: false, json: false })).toEqual({
      dir: ".",
      check: true,
      json: false,
    });
    expect(resolveProjectArgs("--json", { check: false, json: false })).toEqual({
      dir: ".",
      check: false,
      json: true,
    });
  });

  it("defaults to the current directory for a bare or boolean --project", () => {
    expect(resolveProjectArgs(true, { check: true, json: false })).toEqual({
      dir: ".",
      check: true,
      json: false,
    });
    expect(resolveProjectArgs("", { check: false, json: false })).toEqual({
      dir: ".",
      check: false,
      json: false,
    });
  });

  it("passes a real directory through untouched", () => {
    expect(resolveProjectArgs("apps/site", { check: false, json: true })).toEqual({
      dir: "apps/site",
      check: false,
      json: true,
    });
  });

  it("drops an unrelated eaten flag instead of treating it as a directory", () => {
    expect(resolveProjectArgs("--yes", { check: false, json: false })).toEqual({
      dir: ".",
      check: false,
      json: false,
    });
  });
});

describe("upgradeProjectPins", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  function project(scripts: Record<string, string>): string {
    const d = mkdtempSync(join(tmpdir(), "hf-proj-"));
    dirs.push(d);
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "x", scripts }, null, 2));
    return d;
  }

  it("rewrites pinned scripts to latest and reports the delta", async () => {
    const d = project({ render: "npx --yes hyperframes@0.7.48 render" });
    const r = await upgradeProjectPins(d, { json: false, check: false });
    expect(r.changed).toBe(true);
    expect(r.from).toEqual(["0.7.48"]);
    expect(r.to).toBe("0.7.55");
    const pkg = JSON.parse(readFileSync(join(d, "package.json"), "utf-8"));
    expect(pkg.scripts.render).toBe("npx --yes hyperframes@0.7.55 render");
  });

  it("--check reports without writing", async () => {
    const d = project({ render: "npx --yes hyperframes@0.7.48 render" });
    const before = readFileSync(join(d, "package.json"), "utf-8");
    const r = await upgradeProjectPins(d, { json: false, check: true });
    expect(r.changed).toBe(true);
    expect(readFileSync(join(d, "package.json"), "utf-8")).toBe(before);
  });
});
