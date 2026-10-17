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

  it("rewrites project-root shell wrapper pins alongside package scripts", async () => {
    const d = project({ render: "npx --yes hyperframes@0.7.48 render" });
    const fullCpu = join(d, "hyperframes-full-cpu.sh");
    const publish = join(d, "publish-wrapper.sh");
    writeFileSync(fullCpu, "npx --yes hyperframes@0.7.48 render --workers 2\n");
    writeFileSync(publish, "./publish.sh 0.7.48 hyperframes@0.7.48\n");

    await upgradeProjectPins(d, { json: false, check: false });

    expect(readFileSync(fullCpu, "utf8")).toContain("hyperframes@0.7.55");
    expect(readFileSync(publish, "utf8")).toContain("hyperframes@0.7.55");
  });

  it("--check reports without writing", async () => {
    const d = project({ render: "npx --yes hyperframes@0.7.48 render" });
    const before = readFileSync(join(d, "package.json"), "utf-8");
    const r = await upgradeProjectPins(d, { json: false, check: true });
    expect(r.changed).toBe(true);
    expect(readFileSync(join(d, "package.json"), "utf-8")).toBe(before);
  });

  it("upgrades Hyperframes pins without changing unrelated package pins", async () => {
    const unrelated = "npx @acme/hyperframes@1.2.3 preview";
    const d = project({ render: "npx hyperframes@0.7.48 render", unrelated });
    const wrapperPath = join(d, "render.sh");
    writeFileSync(
      wrapperPath,
      "npx custom-hyperframes@1.2.3 preview\nnpx hyperframes@0.7.48 render\n",
    );

    const result = await upgradeProjectPins(d, { json: true, check: false });

    expect(result.from).toEqual(["0.7.48"]);
    const pkg = JSON.parse(readFileSync(join(d, "package.json"), "utf-8"));
    expect(pkg.scripts).toEqual({ render: "npx hyperframes@0.7.55 render", unrelated });
    expect(readFileSync(wrapperPath, "utf-8")).toBe(
      "npx custom-hyperframes@1.2.3 preview\nnpx hyperframes@0.7.55 render\n",
    );
  });

  it("leaves an unrelated-only project's files intact in check and apply modes", async () => {
    const d = project({ preview: "npx @acme/hyperframes@1.2.3 preview" });
    const wrapperPath = join(d, "preview.sh");
    writeFileSync(wrapperPath, "npx custom-hyperframes@1.2.3 preview\n");
    const packageBefore = readFileSync(join(d, "package.json"), "utf-8");
    const wrapperBefore = readFileSync(wrapperPath, "utf-8");

    for (const check of [true, false]) {
      const result = await upgradeProjectPins(d, { json: true, check });

      expect(result.changed).toBe(false);
      expect(result.from).toEqual([]);
      expect(readFileSync(join(d, "package.json"), "utf-8")).toBe(packageBefore);
      expect(readFileSync(wrapperPath, "utf-8")).toBe(wrapperBefore);
    }
  });
});
