import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const workflows = [
  new URL("../SKILL.md", import.meta.url),
  new URL("../../talking-head-recut/SKILL.md", import.meta.url),
];
const pinned = 'npx --yes "hyperframes@$HF_CLI_VERSION"';
function write(path, content) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

test("standalone workflows keep the preflight release for every later CLI command", () => {
  for (const file of workflows) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /HF_CLI_VERSION="<exact-version>"/);
    assert.match(source, /same exact release/);
    assert.doesNotMatch(source, /npx hyperframes\b/);
    const commands = source.match(/npx[^\n`]*hyperframes[^\n`]*/g) ?? [];
    assert.ok(commands.length > 0);
    for (const command of commands) assert.ok(command.startsWith(pinned), command);
  }
  const source = readFileSync(workflows[0], "utf8");
  const init = source.indexOf(`${pinned} init`);
  const plugin = source.indexOf('node "<PLUGIN_ROOT>/skills/pr-to-video/scripts/preflight.mjs"');
  const standalone = source.indexOf('node "<SKILL_DIR>/scripts/preflight.mjs" "$HF_CLI_VERSION"');
  assert.ok(plugin >= 0 && standalone >= 0 && init > plugin && init > standalone);
});

test("real npx uses the workflow pin despite an older project-local CLI", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "hf-npx-resolution-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = join(root, "release");
  const project = join(root, "project");
  const manifest = { name: "hyperframes", version: "1.2.3", bin: { hyperframes: "cli.mjs" } };
  write(join(pkg, "package.json"), JSON.stringify(manifest));
  write(
    join(pkg, "cli.mjs"),
    '#!/usr/bin/env node\nif (process.argv[2] === "--help") console.log("  check Validate project"); else if (process.argv[2] === "check") console.log("pinned release check"); else process.exit(1);',
  );
  chmodSync(join(pkg, "cli.mjs"), 0o755);
  const env = {
    ...process.env,
    npm_config_cache: join(root, "cache"),
    npm_config_update_notifier: "false",
    npm_config_audit: "false",
    npm_config_fetch_retries: "0",
  };
  const options = { env, shell: process.platform === "win32", timeout: 30000 };
  const packed = await run("npm", ["pack", "--json", "--ignore-scripts", "--offline"], {
    ...options,
    cwd: pkg,
  });
  const [artifact] = JSON.parse(packed.stdout);
  const archive = readFileSync(join(pkg, artifact.filename));
  const server = createServer((request, response) => {
    if (request.url === "/release.tgz") return response.end(archive);
    if (request.url !== "/hyperframes") {
      response.writeHead(404);
      return response.end();
    }
    const address = server.address();
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        name: "hyperframes",
        "dist-tags": { latest: manifest.version },
        versions: {
          [manifest.version]: {
            ...manifest,
            dist: {
              tarball: `http://127.0.0.1:${address.port}/release.tgz`,
              integrity: artifact.integrity,
            },
          },
        },
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  env.npm_config_registry = `http://127.0.0.1:${server.address().port}`;
  write(join(project, "package.json"), JSON.stringify({ name: "fixture", private: true }));
  write(
    join(project, "node_modules/hyperframes/package.json"),
    JSON.stringify({ ...manifest, version: "0.0.1" }),
  );
  const oldCli = join(project, "node_modules/hyperframes/cli.mjs");
  write(oldCli, '#!/usr/bin/env node\nconsole.error("unknown command check"); process.exit(1);');
  chmodSync(oldCli, 0o755);
  const bin = join(project, "node_modules/.bin/hyperframes");
  write(bin, readFileSync(oldCli));
  chmodSync(bin, 0o755);
  write(`${bin}.cmd`, `@echo off\r\n"${process.execPath}" "${oldCli}" %*\r\n`);
  const preflight = fileURLToPath(new URL("./preflight.mjs", import.meta.url));
  const probe = await run(process.execPath, [preflight, manifest.version], {
    ...options,
    shell: false,
    cwd: project,
  });
  assert.match(probe.stdout, /required CLI capabilities are available/);
  await assert.rejects(
    run("npx", ["--offline", "hyperframes", "check"], { ...options, cwd: project }),
    (error) => /unknown command check/.test(error.stderr),
  );
  const source = readFileSync(workflows[0], "utf8");
  const command = source.match(/`(npx[^`\n]+ check)`/)[1];
  const args = command
    .replace('"hyperframes@$HF_CLI_VERSION"', `hyperframes@${manifest.version}`)
    .split(" ");
  const program = args.shift();
  assert.equal(program, "npx");
  const result = await run(program, args, { ...options, cwd: project });
  assert.match(result.stdout, /pinned release check/);
});
