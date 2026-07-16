import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Drive `latest` through the REAL getUpdateMeta (defined in the module under
// test) via the mocked config store — self-mocking getUpdateMeta on
// "./updateCheck.js" would only override the export binding, not the internal
// call printStalePinNotice makes to it from within the same module.
let store: Record<string, unknown> = {};
// isDevMode() is true under vitest (module path ends in .ts), which would
// suppress the notice unconditionally — mock ./env.js like updateCheck.test.ts does.
vi.mock("./env.js", () => ({ isDevMode: () => false }));
vi.mock("../telemetry/config.js", () => ({
  readConfig: () => ({ ...store }),
  writeConfig: (c: Record<string, unknown>) => {
    store = { ...c };
    return true;
  },
}));

import { printStalePinNotice } from "./updateCheck.js";

describe("printStalePinNotice", () => {
  let dir: string;
  let writes: string[];
  const origWrite = process.stderr.write.bind(process.stderr);
  beforeEach(() => {
    store = { latestVersion: "0.7.55" };
    writes = [];
    dir = mkdtempSync(join(tmpdir(), "hf-pin-"));
    process.stderr.write = ((s: unknown) => {
      writes.push(String(s));
      return true;
    }) as typeof process.stderr.write;
    delete process.env.CI;
    delete process.env.HYPERFRAMES_NO_UPDATE_CHECK;
  });
  afterEach(() => {
    process.stderr.write = origWrite;
    rmSync(dir, { recursive: true, force: true });
  });

  it("warns once when the project pins an older version", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { render: "npx --yes hyperframes@0.7.48 render" } }),
    );
    printStalePinNotice(dir);
    printStalePinNotice(dir); // throttled — second call silent
    expect(writes.join("")).toContain("0.7.48");
    expect(writes.join("")).toContain("upgrade --project");
    expect(writes.filter((w) => w.includes("upgrade --project")).length).toBe(1);
  });

  it("silent when project pin is current", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { render: "npx --yes hyperframes@0.7.55 render" } }),
    );
    printStalePinNotice(dir);
    expect(writes.join("")).toBe("");
  });

  it("silent under CI", () => {
    process.env.CI = "true";
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { render: "npx --yes hyperframes@0.7.48 render" } }),
    );
    printStalePinNotice(dir);
    expect(writes.join("")).toBe("");
  });
});
