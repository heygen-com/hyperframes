// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, expect, it } from "vitest";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "../..");
const scripts = mkdtempSync(join(tmpdir(), "hf-build-worker-exit-"));
afterAll(() => rmSync(scripts, { recursive: true, force: true }));
const build = pathToFileURL(join(packageDir, "src/helpers/subCompositionBuild.ts")).href;
let hosts = 0;

/** Runs `body` in a fresh Node host with `runOffThread` and two pages, `small` and `slow` (one that takes the worker a
 * while); `made` holds the workers it started. What the host prints, and how it ended, within 20 s. */
function host(body: string) {
  const script = `
import workerThreads from "node:worker_threads";
import { syncBuiltinESMExports } from "node:module";
const made = [];
const Real = workerThreads.Worker;
workerThreads.Worker = class extends Real {
  constructor(...args) {
    super(...args);
    made.push(this);
  }
};
syncBuiltinESMExports();
const { runOffThread, runRootOffThread } = await import(${JSON.stringify(build)});
const options = { capture: false, gsapBaseUrl: "", sandboxedCapture: false };
const page = (html, ms) => runOffThread(
  { kind: "finish", html, runtimeUrl: "/api/runtime.js", signature: "s", projectDir: process.cwd(),
    compPath: "index.html", options },
  performance.now() + ms,
  "index.html",
);
const small = (ms = 60_000) => page("<html><body><p>Hi</p></body></html>", ms);
const slow = (ms) =>
  page("<html><body>" + "<div><p>x</p><span>y</span></div>".repeat(60_000) + "</body></html>", ms);
${body}
`;
  // A file, not -e: the worker inherits the host's flags, and --input-type would stop it from starting.
  const file = join(scripts, `host-${(hosts += 1)}.mjs`);
  writeFileSync(file, script);
  return spawnSync(process.execPath, ["--import", "tsx", file], {
    cwd: packageDir,
    encoding: "utf8",
    timeout: 20_000,
  });
}

const ended = (child: ReturnType<typeof host>, said: string | RegExp) => {
  expect(child.stdout.trim(), child.stderr).toMatch(said);
  expect(child.signal).toBeNull();
  expect(child.status).toBe(0);
};

// fails without the fix: the worker was unref'd before its "message" listener, which refs it again, so it stayed
// ref'd after its last job and a host that built one page never exited (a test file or CLI run hung until killed).
it("a host that built a page on the build worker exits on its own", () => {
  ended(host(`console.log((await small()).includes("Hi") ? "built" : "not built");`), /^built$/);
}, 30_000);

it("a host exits once a job past its deadline is refused and the one behind it is built", () => {
  const child = host(`
const [late, next] = await Promise.allSettled([slow(20), small()]);
console.log(late.status, next.status);
`);
  ended(child, /^rejected fulfilled$/);
}, 30_000);

// fails without the fix: one worker ran every job in turn, so a root page asked for while a project's sub-compositions
// were building waited behind all of them (19 of them: a 15 s blank root page on a devbox).
it("a root page is built while a slow sub-composition holds the other worker", () => {
  const child = host(`
const order = [];
const sub = slow(60_000).then(() => order.push("sub"));
const root = runRootOffThread(
  { kind: "parts", html: "<html><body><p>Hi</p></body></html>", ignore: [] },
  performance.now() + 60_000,
  "index.html",
).then(() => order.push("root"));
await Promise.all([sub, root]);
console.log(order.join(" "));
`);
  ended(child, /^root sub$/);
}, 30_000);

it("a host exits after its build worker dies mid-job", () => {
  const child = host(`
const job = slow(60_000);
made[0].once("online", () => made[0].terminate());
console.log(await job.then(() => "built", (error) => error.message));
`);
  // Its exit code is the platform's (0 on some runners, 1 on others).
  ended(child, /^the build worker exited \(\d+\)$/);
}, 30_000);
