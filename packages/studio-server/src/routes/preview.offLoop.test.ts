// @vitest-environment node
// A host runs these routes on its own event loop: a synchronous read of a folder whose drive stopped answering holds
// that loop, and with it every other request, for as long as the drive stays silent.
import { afterEach, expect, it, vi } from "vitest";
import fs, {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

const SYNC = [
  "existsSync",
  "statSync",
  "lstatSync",
  "realpathSync",
  "readFileSync",
  "readdirSync",
  "readlinkSync",
  "accessSync",
  "openSync",
] as const;
const ASYNC = ["stat", "lstat", "realpath", "readFile", "readlink"] as const;

let projectDir = "";
const wake: (() => void)[] = [];

afterEach(() => {
  for (const one of wake.splice(0)) one();
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  rmSync(projectDir, { recursive: true, force: true });
});

const adapter = (dir: string): StudioApiAdapter => ({
  listProjects: () => [],
  resolveProject: async (id: string) => ({ id, dir }),
  bundle: async () => null,
  lint: async () => ({ findings: [] }),
  runtimeUrl: "/api/runtime.js",
  rendersDir: () => "/tmp/renders",
  startRender: () => ({
    id: "job-1",
    status: "rendering",
    progress: 0,
    outputPath: "/tmp/out.mp4",
  }),
});

/** Every sync fs call on the project folder while watched; its fs/promises reads wait while it sleeps. */
function sleepyDrive(dir: string) {
  const onDrive = (path: unknown) => String(path).startsWith(dir);
  const drive = { watching: false, asleep: false, sync: [] as string[] };
  const record = (name: string, path: unknown) => {
    if (drive.watching && onDrive(path)) drive.sync.push(`${name} ${String(path)}`);
  };
  for (const name of SYNC) {
    const real = fs[name] as (...args: unknown[]) => unknown;
    vi.spyOn(fs, name).mockImplementation(((path: unknown, ...rest: unknown[]) => {
      record(name, path);
      return real(path, ...rest);
    }) as never);
  }
  const native = fs.realpathSync.native as (...args: unknown[]) => unknown;
  vi.spyOn(fs.realpathSync, "native").mockImplementation(((path: unknown, ...rest: unknown[]) => {
    record("realpathSync.native", path);
    return native(path, ...rest);
  }) as never);
  for (const name of ASYNC) {
    const real = fs.promises[name] as (...args: unknown[]) => Promise<unknown>;
    vi.spyOn(fs.promises, name).mockImplementation(((path: unknown, ...rest: unknown[]) =>
      drive.asleep && onDrive(path)
        ? new Promise((done) => wake.push(() => done(real(path, ...rest))))
        : real(path, ...rest)) as never);
  }
  syncBuiltinESMExports();
  return drive;
}

/** Asks `path` while the drive sleeps, wakes it, and returns the answer once its body is read. */
async function askAsleep(path: string) {
  const drive = sleepyDrive(projectDir);
  const api = createStudioApi(adapter(projectDir));
  drive.watching = drive.asleep = true;
  let answered = false;
  const pending = api.request(`http://localhost/projects/demo/preview/${path}`).then((res) => {
    answered = true;
    return res;
  });
  for (let turn = 0; turn < 5; turn++) await new Promise((next) => setImmediate(next));
  const answeredAsleep = answered;
  drive.asleep = false;
  for (const one of wake.splice(0)) one();
  const res = await pending;
  const body = await res.text();
  drive.watching = false;
  return { status: res.status, body, sync: drive.sync, answeredAsleep };
}

const project = () => {
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "hf-preview-asleep-")));
  writeFileSync(join(projectDir, "notes.txt"), "hello");
};

// fails without the fix: the private-file check, the read tracker and the file's stat each made synchronous calls on
// the project folder.
it("a preview file request whose project's drive stops answering asks that drive nothing on the event loop", async () => {
  project();
  const asked = await askAsleep("notes.txt");
  expect(asked.sync).toEqual([]);
  expect(asked.answeredAsleep).toBe(false);
  expect(asked.status).toBe(200);
  expect(asked.body).toBe("hello");
});

it("a request for a file that is not there asks the silent drive nothing on the event loop either", async () => {
  project();
  const asked = await askAsleep("missing.txt");
  expect(asked.sync).toEqual([]);
  expect(asked.answeredAsleep).toBe(false);
  expect(asked.status).toBe(404);
});

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "a file under a folder that refuses reads is still not found",
  async () => {
    project();
    mkdirSync(join(projectDir, "locked"));
    writeFileSync(join(projectDir, "locked", "a.txt"), "x");
    chmodSync(join(projectDir, "locked"), 0o000);
    try {
      const res = await createStudioApi(adapter(projectDir)).request(
        "http://localhost/projects/demo/preview/locked/a.txt",
      );
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("not found");
    } finally {
      chmodSync(join(projectDir, "locked"), 0o755);
    }
  },
);
