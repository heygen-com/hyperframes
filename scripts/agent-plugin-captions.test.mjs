// guards: skills/embedded-captions/**, skills/hyperframes/scripts/plugin-cli.mjs, scripts/package-agent-plugin.mjs
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, delimiter } from "node:path";
import { test } from "node:test";

test("extracted captions helpers invoke the pinned CLI without a checkout", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hf-caption-zip-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("unzip", ["-q", resolve("dist/hyperframes-agent-plugin.zip"), "-d", dir]);
  const root = join(dir, "hyperframes");
  const version = JSON.parse(readFileSync(join(root, "plugin.json"))).version;
  const scripts = join(root, "skills/embedded-captions/scripts");
  // Git-based installs include source directories but no built CLI, unlike ZIPs.
  mkdirSync(join(root, "packages/cli"), { recursive: true });
  assert.equal(
    execFileSync(process.execPath, [join(scripts, "hf-cli.cjs")], { encoding: "utf8" }).trim(),
    realpathSync(join(root, "skills/hyperframes/scripts/plugin-cli.mjs")),
  );
  const override = join(dir, "contributor checkout");
  const built = join(override, "packages/cli/dist/cli.js");
  mkdirSync(join(built, ".."), { recursive: true });
  writeFileSync(built, "// built CLI fixture");
  for (const explicitArg of [true, false]) {
    const found = execFileSync(
      process.execPath,
      [join(scripts, "hf-cli.cjs"), ...(explicitArg ? [override] : [])],
      { encoding: "utf8", env: { ...process.env, HYPERFRAMES_ROOT: explicitArg ? "" : override } },
    );
    assert.equal(found.trim(), built);
  }
  rmSync(join(root, "packages"), { recursive: true });
  const project = join(dir, "project with spaces");
  const bin = join(dir, "bin");
  mkdirSync(project);
  mkdirSync(bin);
  mkdirSync(join(dir, "home"));
  mkdirSync(join(project, "frames_fg"));
  writeFileSync(join(project, "source.mp4"), "fixture");
  writeFileSync(join(project, "audio.mp3"), "fixture");
  writeFileSync(join(project, "index.html"), "<html>caption fixture</html>");
  writeFileSync(join(project, "matte.fps"), "24");
  const log = join(dir, "invocation.json");
  writeFileSync(
    join(bin, "npx"),
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify({args:process.argv.slice(2), skip:process.env.HYPERFRAMES_SKIP_SKILLS})); process.exit(23);`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, "ffmpeg"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(bin, "ffprobe"), "#!/bin/sh\nprintf '24/1\\n24/1\\n'\n", { mode: 0o755 });
  const env = {
    ...process.env,
    HOME: join(dir, "home"),
    HYPERFRAMES_ROOT: "",
    TRANSCRIBE_ENGINE: "whisper",
    PATH: `${bin}${delimiter}${process.env.PATH}`,
  };
  for (const [file, command, cliCommand] of [
    ["matte.cjs", process.execPath, "remove-background"],
    ["transcribe.cjs", process.execPath, "transcribe"],
    ["render-and-composite.sh", "bash", "render"],
  ]) {
    rmSync(log, { force: true });
    const result = spawnSync(command, [join(scripts, file), project], {
      cwd: dir,
      env,
      encoding: "utf8",
      timeout: 20000,
    });
    assert.notEqual(result.status, 0, "fake CLI failure must propagate");
    assert.ok(existsSync(log), `${file}: ${result.stdout} ${result.stderr}`);
    const call = JSON.parse(readFileSync(log, "utf8"));
    assert.deepEqual(
      call.args.slice(0, 3),
      ["--yes", `hyperframes@${version}`, cliCommand],
      result.stderr,
    );
    assert.equal(call.skip, "1");
  }
});

const cases = [{ code: 0 }, { code: 23 }, ...["INT", "TERM", "HUP"].map((cancel) => ({ cancel }))];
for (const { code, cancel } of cases) {
  test(`ZIP render waits for CLI completion: code=${code}, cancel=${cancel}`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-caption-render-"));
    const pidFile = join(dir, "pids.json");
    const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      stdio: "ignore",
    });
    t.after(() => unrelated.kill());
    t.after(() => {
      if (existsSync(pidFile)) {
        const { npm, render } = JSON.parse(readFileSync(pidFile));
        for (const pid of [npm, render]) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
      }
      rmSync(dir, { recursive: true, force: true });
    });
    execFileSync("unzip", ["-q", resolve("dist/hyperframes-agent-plugin.zip"), "-d", dir]);
    const script = join(
      dir,
      "hyperframes/skills/embedded-captions/scripts/render-and-composite.sh",
    );
    const project = join(dir, "project");
    const bin = join(dir, "bin");
    mkdirSync(join(project, "frames_fg"), { recursive: true });
    mkdirSync(bin);
    mkdirSync(join(dir, "home"));
    writeFileSync(join(project, "index.html"), "<html>fixture</html>");
    writeFileSync(join(project, "matte.fps"), "24");
    const output = join(project, "bg_plus_caps.mp4");
    const child = join(dir, "child.cjs");
    writeFileSync(
      child,
      `const fs=require('node:fs'); setInterval(()=>fs.appendFileSync(${JSON.stringify(output)},'x'),50);`,
    );
    writeFileSync(
      join(bin, "npx"),
      `#!${process.execPath}
const fs=require('node:fs');
const child=require('node:child_process').spawn(process.execPath,[${JSON.stringify(child)}],{stdio:'ignore'});
fs.writeFileSync(${JSON.stringify(output)},Buffer.alloc(1200000));
fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({wrapper:process.ppid,npm:process.pid,render:child.pid}));
${cancel ? "setInterval(()=>{},1000);" : `setTimeout(()=>{child.kill(); child.once('exit',()=>process.exit(${code}));},1200);`}
`,
      { mode: 0o755 },
    );
    // Only downstream media operations are stubbed; process cleanup and PTY are real.
    writeFileSync(join(bin, "ffprobe"), "#!/bin/sh\necho 2\n", { mode: 0o755 });
    writeFileSync(join(bin, "ffmpeg"), '#!/bin/bash\ntouch "${@: -1}"\n', { mode: 0o755 });
    const terminal = `
import os, pty, select, signal, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.execvp("bash", ["bash", sys.argv[1], sys.argv[2]])
deadline = time.monotonic() + 15
sent = False
while time.monotonic() < deadline:
    if not sent and os.path.exists(sys.argv[3]):
        if sys.argv[4] == "INT": os.write(fd, b"\\x03")
        else: os.killpg(pid, getattr(signal, "SIG" + sys.argv[4]))
        sent = True
    if select.select([fd], [], [], 0.05)[0]:
        try: os.read(fd, 65536)
        except OSError: pass
    ended, status = os.waitpid(pid, os.WNOHANG)
    if ended:
        time.sleep(0.5)
        sys.exit(0 if sent and os.waitstatus_to_exitcode(status) != 0 else 1)
os.kill(pid, signal.SIGKILL)
sys.exit(2)
`;
    const result = spawnSync(
      cancel ? "python3" : "bash",
      cancel ? ["-c", terminal, script, project, pidFile, cancel] : [script, project],
      {
        encoding: "utf8",
        timeout: 20000,
        env: {
          ...process.env,
          HOME: join(dir, "home"),
          HYPERFRAMES_ROOT: "",
          PATH: `${bin}${delimiter}${process.env.PATH}`,
        },
      },
    );
    assert.equal(result.error, undefined, result.stderr);
    assert.equal(result.status, cancel ? 0 : code === 0 ? 0 : 1, result.stdout + result.stderr);
    assert.equal(unrelated.exitCode, null);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    if (cancel || code !== 0) assert.equal(existsSync(join(project, "final.mp4")), false);
    const pids = JSON.parse(readFileSync(pidFile));
    for (const pid of Object.values(pids)) {
      const status = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
      assert.ok(
        status.status === 1 || /^\s*Z/.test(status.stdout),
        `PID ${pid} survives: ${status.stdout} ${status.stderr}`,
      );
    }
    const before = readFileSync(output).length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(readFileSync(output).length, before, "render still writes output after returning");
  });
}
