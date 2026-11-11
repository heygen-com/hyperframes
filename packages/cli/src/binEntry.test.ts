import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

// Runs the published bin over stub dist files from a folder outside the project; the stub CLI
// reports the folder it runs in and whether the launcher's project folder reached it.
function runBin(handover: (project: string) => string | undefined) {
  const root = mkdtempSync(join(tmpdir(), "hf-bin-entry-"));
  roots.push(root);
  const project = join(root, "user project");
  const outside = join(root, "home");
  for (const dir of [project, outside, join(root, "pkg/bin"), join(root, "pkg/dist")]) {
    mkdirSync(dir, { recursive: true });
  }
  const bin = join(root, "pkg/bin/hyperframes.mjs");
  copyFileSync(fileURLToPath(new URL("../bin/hyperframes.mjs", import.meta.url)), bin);
  writeFileSync(
    join(root, "pkg/dist/runtimeVersion.js"),
    "export const runtimeVersionError = () => null;\n",
  );
  writeFileSync(
    join(root, "pkg/dist/cli.js"),
    "console.log(JSON.stringify({ cwd: process.cwd(), pwd: process.env.PWD, passedOn: process.env.HYPERFRAMES_PLUGIN_CWD ?? null }));\n",
  );
  // npm's shell sets PWD to the folder npx started in.
  const env: NodeJS.ProcessEnv = { ...process.env, PWD: outside };
  delete env.HYPERFRAMES_PLUGIN_CWD;
  const named = handover(project);
  if (named !== undefined) env.HYPERFRAMES_PLUGIN_CWD = named;
  const result = spawnSync(process.execPath, [bin, "info"], {
    cwd: outside,
    encoding: "utf8",
    env,
  });
  expect(result.status, result.stderr).toBe(0);
  return {
    seen: JSON.parse(result.stdout),
    project: realpathSync(project),
    projectNamed: project,
    outside: realpathSync(outside),
    outsideNamed: outside,
  };
}

describe("bin/hyperframes.mjs", () => {
  it("runs in the project the plugin launcher names, and does not pass that on", () => {
    const { seen, project, projectNamed } = runBin((dir) => dir);
    expect(seen).toEqual({ cwd: project, pwd: projectNamed, passedOn: null });
  });

  it("stays in its working folder without a launcher", () => {
    const { seen, outside, outsideNamed } = runBin(() => undefined);
    expect(seen).toEqual({ cwd: outside, pwd: outsideNamed, passedOn: null });
  });
});
