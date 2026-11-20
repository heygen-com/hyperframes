// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RenderJobState, StudioApiAdapter } from "../types";
import { registerRenderRoutes } from "./render";
import { RenderIdentityStore } from "../helpers/renderIdentityStore";

const inspection: {
  before?: (operation: string, path: unknown) => void;
  after?: (operation: string, path: unknown) => void;
} = vi.hoisted(() => ({}));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    lstatSync: (...args: Parameters<typeof fs.lstatSync>) => {
      inspection.before?.("stat", args[0]);
      const result = fs.lstatSync(...args);
      inspection.after?.("stat", args[0]);
      return result;
    },
    readdirSync: (...args: Parameters<typeof fs.readdirSync>) => {
      inspection.before?.("scan", args[0]);
      const result = fs.readdirSync(...args);
      inspection.after?.("scan", args[0]);
      return result;
    },
    readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
      const result = fs.readFileSync(...args);
      inspection.after?.("read", args[0]);
      return result;
    },
  };
});

const roots: string[] = [];
const publishers = new Set<ChildProcess>();
afterEach(async () => {
  inspection.before = inspection.after = undefined;
  for (const child of publishers) await stopPublisher(child);
  vi.clearAllTimers();
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function publisherEvent(child: ChildProcess, event: "published" | "released" | "exit") {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.off("message", message);
      child.off("exit", exit);
      child.off("error", finish);
      if (error) reject(error);
      else resolve();
    };
    const message = (value: unknown) => {
      if (value && typeof value === "object" && "type" in value && value.type === event) finish();
    };
    const exit = () =>
      finish(event === "exit" ? undefined : new Error(`Publisher exited before ${event}`));
    const timer = setTimeout(() => finish(new Error(`Publisher timeout: ${event}`)), 10_000);
    child.on("message", message).once("exit", exit).once("error", finish);
  });
}

async function stopPublisher(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = publisherEvent(child, "exit");
    child.kill("SIGKILL");
    await exited;
  }
  publishers.delete(child);
}

async function holdPublisher(root: string, format: string) {
  const child = fork(
    fileURLToPath(new URL("./fixtures/renderIdentityPublisher.mjs", import.meta.url)),
    [root, format],
    { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] },
  );
  publishers.add(child);
  await publisherEvent(child, "published");
  return {
    child,
    release: async () => {
      const released = publisherEvent(child, "released");
      child.send("release");
      await released;
    },
  };
}

function publicationPair(root: string) {
  const registry = join(root, ".hf-render-identities");
  const record = join(registry, readdirSync(registry).find((name) => name.endsWith(".json"))!);
  const temporary = join(registry, `.${randomUUID()}.tmp`);
  linkSync(record, temporary);
  return { registry, record, temporary };
}

function pairSnapshot(pair: { registry: string; record: string; temporary: string }) {
  return {
    names: readdirSync(pair.registry).sort(),
    files: [pair.record, pair.temporary].map((path) => ({
      bytes: readFileSync(path),
      stat: lstatSync(path, { bigint: true }),
    })),
  };
}

function damageReadPair(
  pair: { record: string; temporary: string },
  outside: string,
  fault: string,
) {
  if (fault === "replace-path") {
    unlinkSync(pair.record);
    writeFileSync(pair.record, readFileSync(pair.temporary));
  } else if (fault === "external-link") renameSync(pair.temporary, outside);
  else if (fault === "third-link") linkSync(pair.record, outside);
}

function sequence(path: string) {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "frame_000001.png"), "frame");
}

function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "hf-identities-")));
  roots.push(dir);
  const project = { id: "proj", dir };
  const root = join(dir, "renders");
  mkdirSync(root);
  const states: RenderJobState[] = [];
  const adapter: StudioApiAdapter = {
    listProjects: async () => [project],
    resolveProject: () => project,
    bundle: async () => null,
    lint: () => ({ findings: [] }),
    runtimeUrl: "/runtime.js",
    rendersDir: (p) => join(p.dir, "renders"),
    startRender: (opts) => {
      if (opts.format === "png-sequence") sequence(opts.outputPath);
      else writeFileSync(opts.outputPath, "video");
      const state: RenderJobState = {
        id: opts.jobId,
        status: "complete",
        progress: 100,
        outputPath: opts.outputPath,
      };
      states.push(state);
      return state;
    },
  };
  const restart = () => {
    const app = new Hono();
    registerRenderRoutes(app, adapter);
    return app;
  };
  return { project, root, states, adapter, restart, app: restart() };
}

function pauseEnumeration(adapter: StudioApiAdapter) {
  const listProjects = adapter.listProjects;
  let release!: () => void;
  let enumerating!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    enumerating = resolve;
  });
  adapter.listProjects = async () => {
    enumerating();
    await paused;
    return listProjects();
  };
  return { started, release };
}

async function start(app: Hono, format: string) {
  const response = await app.request("/projects/proj/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ format }),
  });
  expect(response.status).toBe(200);
  return String((await response.json()).jobId);
}

async function rows(app: Hono) {
  const response = await app.request("/projects/proj/renders");
  expect(response.status).toBe(200);
  return (await response.json()).renders as Array<{ id: string; filename: string; kind?: string }>;
}

const remove = (app: Hono, id: string) =>
  app.request(`/render/${encodeURIComponent(id)}`, { method: "DELETE" });

function records(root: string) {
  const registry = join(root, ".hf-render-identities");
  return readdirSync(registry).map((name) => ({
    name,
    contents: readFileSync(join(registry, name), "utf8"),
  }));
}

function relocate(source: ReturnType<typeof fixture>, mode: "move" | "copy") {
  const dir = mkdtempSync(join(tmpdir(), "hf-relocated-"));
  roots.push(dir);
  if (mode === "copy") cpSync(source.project.dir, dir, { recursive: true });
  else {
    rmSync(dir, { recursive: true });
    renameSync(source.project.dir, dir);
  }
  const project = { id: "proj", dir };
  source.adapter.resolveProject = () => project;
  source.adapter.listProjects = async () => [project];
  return { root: join(dir, "renders"), project, app: source.restart() };
}

function damageRegistry(fault: string, root: string, record: string) {
  const registry = join(root, ".hf-render-identities");
  const original = readFileSync(record, "utf8");
  if (fault === "corrupt") writeFileSync(record, "{");
  if (fault === "incomplete") writeFileSync(record, '{"version":1}');
  if (fault === "escaping")
    writeFileSync(record, JSON.stringify({ ...JSON.parse(original), output: "../clip.mp4" }));
  if (fault === "symlink") {
    rmSync(record);
    const outside = join(root, "record-copy");
    writeFileSync(outside, original);
    symlinkSync(outside, record);
  }
  if (fault === "registry-symlink") {
    const target = join(root, "records-copy");
    mkdirSync(target);
    rmSync(registry, { recursive: true });
    symlinkSync(target, registry);
  }
  if (fault === "unwritable") {
    chmodSync(registry, 0o555);
    writeFileSync(join(root, "fresh.mp4"), "fresh");
  }
}

describe("durable render ownership", () => {
  describe("interrupted identity publication", () => {
    it.each(["mp4", "png-sequence"])(
      "recovers a completed %s pair across restarts without reader writes",
      async (format) => {
        const source = fixture();
        const id = await start(source.app, format);
        const pair = publicationPair(source.root);
        const saved = pairSnapshot(pair);
        chmodSync(pair.registry, 0o500);
        chmodSync(pair.record, 0o400);
        try {
          const store = () => new RenderIdentityStore(async () => [source.root]);
          const owner = {
            root: realpathSync(source.root),
            output: format === "mp4" ? `${id}.mp4` : id,
            kind: format === "mp4" ? "file" : "directory",
          };
          expect(await store().resolve(id)).toEqual(owner);
          expect((await rows(source.restart()))[0]!.id).toBe(id);
          for (const action of format === "mp4" ? ["view", "download"] : ["download"]) {
            const response = await source.restart().request(`/render/${id}/${action}`);
            expect(response.status).toBe(200);
            await response.arrayBuffer();
          }
          const after = pairSnapshot(pair);
          expect(after.names).toEqual(saved.names);
          for (let n = 0; n < 2; n++) {
            expect(after.files[n]!.bytes).toEqual(saved.files[n]!.bytes);
            expect(after.files[n]!.stat.ino).toBe(saved.files[n]!.stat.ino);
            expect(after.files[n]!.stat.nlink).toBe(2n);
            expect(after.files[n]!.stat.mtimeNs).toBe(saved.files[n]!.stat.mtimeNs);
          }
        } finally {
          chmodSync(pair.registry, 0o700);
          chmodSync(pair.record, 0o600);
        }
        expect(await start(source.restart(), format)).not.toBe(id);
        expect(lstatSync(pair.record).nlink).toBe(2);
      },
    );

    it.each(["mp4", "png-sequence"])(
      "keeps %s foreign pairs as reservations without following the old root",
      async (format) => {
        const source = fixture();
        const id = await start(source.app, format);
        const local = relocate(source, "move");
        const pair = publicationPair(local.root);
        const before = readFileSync(pair.record);
        expect(existsSync(source.root)).toBe(false);
        expect(await new RenderIdentityStore(async () => [local.root]).resolve(id)).toBeNull();
        const listed = await rows(local.app);
        const localId = listed[0]!.id;
        expect(localId).not.toBe(id);
        expect((await source.restart().request(`/render/${id}/download`)).status).toBe(404);
        const response = await source.restart().request(`/render/${localId}/download`);
        expect(response.status).toBe(200);
        await response.arrayBuffer();
        expect(await start(source.restart(), format)).not.toBe(id);
        expect(readFileSync(pair.record)).toEqual(before);
        expect(readFileSync(pair.temporary)).toEqual(before);
        expect(lstatSync(pair.record).nlink).toBe(2);
        expect(existsSync(source.root)).toBe(false);
      },
    );

    it.each(["mp4", "png-sequence"])(
      "reads %s while the real publisher is IPC-held, after cleanup and after termination",
      async (format) => {
        for (const ending of ["release", "terminate"]) {
          const source = fixture();
          const held = await holdPublisher(source.root, format);
          try {
            const registry = join(source.root, ".hf-render-identities");
            const record = join(registry, readdirSync(registry).find((n) => n.endsWith(".json"))!);
            const bytes = readFileSync(record, "utf8");
            const owner = JSON.parse(bytes);
            if (format === "mp4") writeFileSync(join(source.root, owner.output), "video");
            else sequence(join(source.root, owner.output));
            const read = async () => {
              expect(
                await new RenderIdentityStore(async () => [source.root]).resolve(owner.id),
              ).toEqual({
                root: owner.root,
                output: owner.output,
                kind: owner.kind,
              });
              expect(
                (await rows(source.restart())).find((row) => row.id === owner.id),
              ).toBeDefined();
              const response = await source.restart().request(`/render/${owner.id}/download`);
              expect(response.status).toBe(200);
              await response.arrayBuffer();
            };
            expect(lstatSync(record).nlink).toBe(2);
            await read();
            const competitor = await new RenderIdentityStore(async () => [source.root]).claim(
              source.root,
              "held",
              ".mp4",
              "file",
            );
            expect(competitor.id).not.toBe(owner.id);
            expect(readFileSync(record, "utf8")).toBe(bytes);
            if (ending === "release") await held.release();
            else await stopPublisher(held.child);
            expect(lstatSync(record).nlink).toBe(ending === "release" ? 1 : 2);
            await read();
          } finally {
            await stopPublisher(held.child);
          }
        }
      },
      30_000,
    );

    it.each(["before-scan", "after-scan", "before-stat", "after-stat"])(
      "accepts legitimate cleanup %s with bounded metadata inspection",
      async (timing) => {
        const source = fixture();
        const id = await start(source.app, "mp4");
        const pair = publicationPair(source.root);
        let scans = 0;
        let removed = false;
        const hook = (phase: string, operation: string, path: unknown) => {
          if (operation === "scan" && phase === "before" && path === pair.registry) scans++;
          const target = timing.endsWith("scan")
            ? path === pair.registry && scans === 2
            : path === pair.temporary;
          if (!removed && target && timing === `${phase}-${operation}`) {
            removed = true;
            unlinkSync(pair.temporary);
          }
        };
        inspection.before = (op, path) => hook("before", op, path);
        inspection.after = (op, path) => hook("after", op, path);
        expect(await new RenderIdentityStore(async () => [source.root]).resolve(id)).toMatchObject({
          output: `${id}.mp4`,
        });
        expect(removed).toBe(true);
        expect(scans).toBeLessThanOrEqual(3);
        expect(lstatSync(pair.record).nlink).toBe(1);
      },
    );

    it.each([2, 3])(
      "accepts cleanup between the descriptor and final-path inspection %i",
      async (inspectionNumber) => {
        const source = fixture();
        const id = await start(source.app, "mp4");
        const pair = publicationPair(source.root);
        let inspections = 0;
        let removed = false;
        inspection.before = (operation, path) => {
          if (operation !== "stat" || path !== pair.record) return;
          inspections++;
          if (inspections === inspectionNumber) {
            removed = true;
            unlinkSync(pair.temporary);
          }
        };
        expect(await new RenderIdentityStore(async () => [source.root]).resolve(id)).toMatchObject({
          output: `${id}.mp4`,
        });
        expect(removed).toBe(true);
        expect(lstatSync(pair.record).nlink).toBe(1);
      },
    );

    it.each([
      "external",
      "three-links",
      "wrong-name",
      "wrong-uuid",
      "wrong-version",
      "wrong-variant",
      "equal-content",
      "symlink",
      "fifo",
    ])("rejects an unexplained two-link record: %s", async (fault) => {
      const source = fixture();
      await start(source.app, "mp4");
      const pair = publicationPair(source.root);
      const wrongName = new Map([
        ["wrong-name", ".interrupted.tmp"],
        ["wrong-uuid", `.${"a".repeat(36)}.tmp`],
        ["wrong-version", ".12345678-1234-1234-8123-123456789abc.tmp"],
        ["wrong-variant", ".12345678-1234-4234-0123-123456789abc.tmp"],
      ]).get(fault);
      if (wrongName) renameSync(pair.temporary, join(pair.registry, wrongName));
      else if (fault === "three-links") linkSync(pair.record, join(source.project.dir, "external"));
      else {
        unlinkSync(pair.temporary);
        const external = join(source.project.dir, "external");
        linkSync(pair.record, external);
        if (fault === "equal-content") writeFileSync(pair.temporary, readFileSync(pair.record));
        if (fault === "symlink") symlinkSync(external, pair.temporary);
        if (fault === "fifo") execFileSync("mkfifo", [pair.temporary]);
      }
      const before = readFileSync(pair.record);
      await expect(
        new RenderIdentityStore(async () => [source.root]).history(),
      ).rejects.toMatchObject({
        status: 403,
      });
      expect(readFileSync(pair.record)).toEqual(before);
      expect(lstatSync(pair.record).nlink).toBe(fault === "three-links" ? 3 : 2);
    });

    it.each(["corrupt", "wrong-hash", "invalid-owner", "invalid-root"])(
      "rejects %s even with a matching staging inode",
      async (fault) => {
        const source = fixture();
        await start(source.app, "mp4");
        const pair = publicationPair(source.root);
        const value = JSON.parse(readFileSync(pair.record, "utf8"));
        if (fault === "corrupt") writeFileSync(pair.record, "{");
        if (fault === "invalid-owner")
          writeFileSync(pair.record, JSON.stringify({ ...value, kind: "other" }));
        if (fault === "invalid-root")
          writeFileSync(pair.record, JSON.stringify({ ...value, root: "/old/../root" }));
        if (fault === "wrong-hash")
          renameSync(pair.record, join(pair.registry, `${"0".repeat(64)}.json`));
        await expect(
          new RenderIdentityStore(async () => [source.root]).history(),
        ).rejects.toBeDefined();
        expect(lstatSync(pair.temporary).nlink).toBe(2);
      },
    );

    it("ignores unpublished and unrelated temporary records without granting authority or cleaning them", async () => {
      const source = fixture();
      const id = await start(source.app, "mp4");
      const pair = publicationPair(source.root);
      unlinkSync(pair.record);
      unlinkSync(join(source.root, `${id}.mp4`));
      const bytes = readFileSync(pair.temporary);
      writeFileSync(join(pair.registry, ".unrelated.tmp"), "{");
      const store = new RenderIdentityStore(async () => [source.root]);
      expect(await store.resolve(id)).toBeNull();
      expect(readFileSync(pair.temporary)).toEqual(bytes);
      expect(readFileSync(join(pair.registry, ".unrelated.tmp"), "utf8")).toBe("{");
    });

    it("does not scan the registry again for ordinary one-link records", async () => {
      const source = fixture();
      const id = await start(source.app, "mp4");
      const registry = join(source.root, ".hf-render-identities");
      let scans = 0;
      inspection.before = (operation, path) => {
        if (operation === "scan" && path === registry) scans++;
      };
      expect(await new RenderIdentityStore(async () => [source.root]).resolve(id)).not.toBeNull();
      expect(scans).toBe(1);
    });

    it.each([
      "replace-path",
      "external-link",
      "third-link",
      "unexplained-cleanup",
      "metadata-error",
    ])("fails closed when the record changes during validation: %s", async (fault) => {
      const source = fixture();
      const id = await start(source.app, "mp4");
      const pair = publicationPair(source.root);
      let changed = false;
      inspection.after = (operation, path) => {
        if (
          fault === "unexplained-cleanup" &&
          operation === "scan" &&
          path === pair.registry &&
          !changed
        ) {
          changed = true;
          linkSync(pair.record, join(source.project.dir, "external"));
          unlinkSync(pair.temporary);
        } else if (operation === "read" && typeof path === "number" && !changed) {
          changed = true;
          damageReadPair(pair, join(source.project.dir, "external"), fault);
        }
      };
      if (fault === "metadata-error")
        inspection.before = (operation, path) => {
          if (operation === "stat" && path === pair.temporary) {
            changed = true;
            throw Object.assign(new Error("denied"), { code: "EACCES" });
          }
        };
      await expect(
        new RenderIdentityStore(async () => [source.root]).resolve(id),
      ).rejects.toBeDefined();
      expect(changed).toBe(true);
    });

    it.each(["replace-path", "add-link", "rewrite-bytes"])(
      "rechecks a one-link record after decoding: %s",
      async (fault) => {
        const source = fixture();
        const id = await start(source.app, "mp4");
        const registry = join(source.root, ".hf-render-identities");
        const record = join(registry, readdirSync(registry)[0]!);
        let changed = false;
        inspection.after = (operation, path) => {
          if (operation !== "read" || typeof path !== "number" || changed) return;
          changed = true;
          if (fault === "replace-path") {
            renameSync(record, join(source.project.dir, "original"));
            writeFileSync(
              record,
              JSON.stringify({ version: 1, id, root: source.root, blocked: true }),
            );
          } else if (fault === "add-link") linkSync(record, join(source.project.dir, "external"));
          else writeFileSync(record, "{");
        };
        await expect(
          new RenderIdentityStore(async () => [source.root]).resolve(id),
        ).rejects.toBeDefined();
        expect(changed).toBe(true);
      },
    );
  });

  describe.each([
    String.raw`C:\Users\old\demo\renders`,
    String.raw`\\server\share\demo\renders`,
    "/home/old/demo/renders",
  ])("records copied from %s", (recordedRoot) => {
    it.each(["mp4", "png-sequence"])(
      "reserves foreign %s IDs without following or rewriting their root",
      async (format) => {
        const source = fixture();
        const oldId = await start(source.app, format);
        const registry = join(source.root, ".hf-render-identities");
        for (const name of readdirSync(registry)) {
          const path = join(registry, name);
          const value = JSON.parse(readFileSync(path, "utf8"));
          writeFileSync(path, JSON.stringify({ ...value, root: recordedRoot }));
        }
        const saved = records(source.root);
        const fresh = await start(source.restart(), format);
        expect(fresh).not.toBe(oldId);
        const listed = await rows(source.restart());
        const filename = format === "mp4" ? `${oldId}.mp4` : oldId;
        const localId = listed.find((row) => row.filename === filename)!.id;
        expect(localId).not.toBe(oldId);
        for (const action of ["download", "view"]) {
          expect((await source.restart().request(`/render/${oldId}/${action}`)).status).toBe(404);
        }
        const download = await source.restart().request(`/render/${localId}/download`);
        expect(download.status).toBe(200);
        await download.arrayBuffer();
        expect((await rows(source.restart())).find((row) => row.filename === filename)!.id).toBe(
          localId,
        );
        expect((await remove(source.restart(), localId)).status).toBe(200);
        for (const { name, contents } of saved)
          expect(readFileSync(join(registry, name), "utf8")).toBe(contents);
      },
    );
  });

  it.each([
    String.raw`C:demo\renders`,
    String.raw`\demo\renders`,
    String.raw`C:\demo\..\renders`,
    "/home/old/../renders",
  ])("rejects noncanonical or drive-relative historical root %s", async (root) => {
    const source = fixture();
    await start(source.app, "mp4");
    const registry = join(source.root, ".hf-render-identities");
    const record = join(registry, readdirSync(registry)[0]!);
    const value = JSON.parse(readFileSync(record, "utf8"));
    writeFileSync(record, JSON.stringify({ ...value, root }));
    expect((await source.restart().request("/projects/proj/renders")).status).toBe(503);
  });

  describe.each(["move", "copy"] as const)("%s relocation", (mode) => {
    it.each(["mp4", "png-sequence"])(
      "re-identifies %s history persistently without transferring old links",
      async (format) => {
        const source = fixture();
        const oldId = await start(source.app, format);
        const original = records(source.root);
        const local = relocate(source, mode);
        writeFileSync(join(local.root, "unrecorded.mp4"), "unrecorded");
        const listed = await rows(local.app);
        const filename = format === "mp4" ? `${oldId}.mp4` : oldId;
        const id = listed.find((row) => row.filename === filename)!.id;
        expect(id).not.toBe(oldId);
        expect(listed.find((row) => row.filename === "unrecorded.mp4")!.id).not.toBe("unrecorded");
        for (let n = 0; n < 3; n++) {
          const app = source.restart();
          expect((await rows(app)).find((row) => row.filename === filename)!.id).toBe(id);
          expect((await app.request(`/render/${oldId}/download`)).status).toBe(404);
          await remove(app, oldId);
          expect(existsSync(join(local.root, filename))).toBe(true);
          const download = await app.request(`/render/${id}/download`);
          expect(download.status).toBe(200);
          if (format === "mp4") expect(await download.text()).toBe("video");
          else expect(Buffer.from(await download.arrayBuffer()).readUInt32LE(0)).toBe(0x04034b50);
        }
        expect((await remove(source.restart(), id)).status).toBe(200);
        expect(existsSync(join(local.root, filename))).toBe(false);
        for (const { name, contents } of original)
          expect(readFileSync(join(local.root, ".hf-render-identities", name), "utf8")).toBe(
            contents,
          );
        if (mode === "copy") expect(existsSync(join(source.root, filename))).toBe(true);
      },
    );

    it("keeps the UI's identity-based video URLs from transferring to the relocated project", async () => {
      const source = fixture();
      const oldId = await start(source.app, "mp4");
      for (const action of ["view", "download"])
        expect(await (await source.app.request(`/render/${oldId}/${action}`)).text()).toBe("video");
      const local = relocate(source, mode);
      for (const action of ["view", "download"])
        expect((await local.app.request(`/render/${oldId}/${action}`)).status).toBe(404);
      const newId = (await rows(local.app))[0]!.id;
      for (const action of ["view", "download"])
        expect(await (await source.restart().request(`/render/${newId}/${action}`)).text()).toBe(
          "video",
        );
    });

    it.each(["mp4", "png-sequence"])(
      "accepts fresh %s exports before refreshing relocated history",
      async (format) => {
        const source = fixture();
        const oldId = await start(source.app, format);
        const local = relocate(source, mode);
        const freshId = await start(local.app, format);
        expect(freshId).not.toBe(oldId);
        const download = await source.restart().request(`/render/${freshId}/download`);
        expect(download.status).toBe(200);
        await download.arrayBuffer();
        expect((await remove(source.restart(), freshId)).status).toBe(200);
        const next = await start(source.restart(), format);
        expect([oldId, freshId]).not.toContain(next);
      },
    );
  });

  it.each(["source-first", "copies-first"])(
    "merges a source and two copies in %s order without transferring authority",
    async (order) => {
      const source = fixture();
      const first = fixture();
      const second = fixture();
      writeFileSync(join(source.root, "intro.mp4"), "source-video");
      sequence(join(source.root, "frames"));
      const original = await new RenderIdentityStore(async () => [source.root]).history();
      const saved = records(source.root);
      for (const copy of [first, second]) cpSync(source.root, copy.root, { recursive: true });
      const allRoots =
        order === "source-first"
          ? [source.root, first.root, second.root]
          : [second.root, first.root, source.root];
      const fresh = () => new RenderIdentityStore(async () => allRoots);
      const history = await fresh().history();
      expect(history).toHaveLength(6);
      expect(new Set(history.map((row) => row.id)).size).toBe(6);
      for (const row of original) {
        expect(history.find((r) => r.root === row.root && r.filename === row.filename)!.id).toBe(
          row.id,
        );
        expect(await fresh().resolve(row.id)).toEqual({
          root: row.root,
          output: row.filename,
          kind: row.kind ?? "file",
        });
      }
      const copyRows = history.filter((row) => row.root !== realpathSync(source.root));
      for (const row of copyRows) expect(original.map((r) => r.id)).not.toContain(row.id);
      expect(await fresh().history()).toEqual(history);
      for (const copy of [first, second]) {
        for (const { name, contents } of saved)
          expect(readFileSync(join(copy.root, ".hf-render-identities", name), "utf8")).toBe(
            contents,
          );
      }
      source.adapter.listProjects = async () => [source.project, first.project, second.project];
      const sourceId = original.find((r) => r.filename === "intro.mp4")!.id;
      expect(await (await source.restart().request(`/render/${sourceId}/download`)).text()).toBe(
        "source-video",
      );
      const copyId = history.find(
        (r) => r.root === realpathSync(first.root) && r.filename === "intro.mp4",
      )!.id;
      expect((await remove(source.restart(), copyId)).status).toBe(200);
      expect(existsSync(join(first.root, "intro.mp4"))).toBe(false);
      for (const kept of [source.root, second.root])
        expect(readFileSync(join(kept, "intro.mp4"), "utf8")).toBe("source-video");
      expect(await (await source.restart().request(`/render/${sourceId}/download`)).text()).toBe(
        "source-video",
      );
    },
  );

  it("keeps concurrent relocated claims/history stable and reserves foreign IDs after deletion", async () => {
    const source = fixture();
    const oldId = await start(source.app, "mp4");
    const local = relocate(source, "copy");
    const root = realpathSync(local.root);
    const candidate = `reserved-${createHash("sha256").update(root).digest("hex").slice(0, 32)}`;
    const registry = join(root, ".hf-render-identities");
    writeFileSync(
      join(registry, `${createHash("sha256").update(candidate).digest("hex")}.json`),
      JSON.stringify({
        version: 1,
        id: candidate,
        root: realpathSync(source.root),
        output: "gone.mp4",
        kind: "file",
      }),
    );
    const store = () => new RenderIdentityStore(async () => [root]);
    const [a, listed, b] = await Promise.all([
      store().claim(root, "reserved", ".mp4", "file"),
      store().history(),
      store().claim(root, "reserved", "", "directory"),
    ]);
    expect(new Set([a.id, b.id, candidate, oldId]).size).toBe(4);
    const id = listed[0]!.id;
    expect(await store().history()).toEqual(listed);
    expect(await store().resolve(oldId)).toBeNull();
    expect(await store().resolve(candidate)).toBeNull();
    expect((await remove(source.restart(), id)).status).toBe(200);
    const c = await store().claim(root, "reserved", ".mp4", "file");
    expect([a.id, b.id, candidate, oldId, id]).not.toContain(c.id);
    expect(await store().history()).toEqual([]);
  });

  it("keeps copied ambiguity blocks historical and never reuses a reserved alias", async () => {
    const source = fixture();
    writeFileSync(join(source.root, "intro.mp4"), "video");
    sequence(join(source.root, "intro"));
    const original = await new RenderIdentityStore(async () => [source.root]).history();
    const local = relocate(source, "copy");
    const root = realpathSync(local.root);
    const alias = `.hf-render~${createHash("sha256")
      .update(JSON.stringify([root, "file", "intro.mp4"]))
      .digest("hex")}`;
    writeFileSync(
      join(
        root,
        ".hf-render-identities",
        `${createHash("sha256").update(alias).digest("hex")}.json`,
      ),
      JSON.stringify({ version: 1, id: alias, root: realpathSync(source.root), blocked: true }),
    );
    const roots = async () => [root, source.root];
    const history = await new RenderIdentityStore(roots).history();
    expect(new Set(history.map((row) => row.id)).size).toBe(4);
    const localFile = history.find((row) => row.root === root && row.filename === "intro.mp4")!;
    expect([alias, ...original.map((row) => row.id)]).not.toContain(localFile.id);
    expect(await new RenderIdentityStore(async () => [root]).resolve("intro")).toBeNull();
    expect(await new RenderIdentityStore(async () => [root]).resolve(alias)).toBeNull();
    for (const row of original)
      expect(await new RenderIdentityStore(roots).resolve(row.id)).toEqual({
        root: row.root,
        output: row.filename,
        kind: row.kind ?? "file",
      });
    expect(await new RenderIdentityStore(roots).history()).toEqual(history);
  });

  it.each([
    "corrupt",
    "incomplete",
    "escaping",
    "symlink",
    "unwritable",
    "relative-root",
    "unknown-field",
    "wrong-hash",
  ] as const)("still fails closed on %s foreign reservations", async (fault) => {
    const source = fixture();
    await start(source.app, "mp4");
    const local = relocate(source, "copy");
    const registry = join(local.root, ".hf-render-identities");
    const file = join(registry, readdirSync(registry)[0]!);
    if (fault === "relative-root" || fault === "unknown-field") {
      const record = JSON.parse(readFileSync(file, "utf8"));
      if (fault === "relative-root") record.root = "../old";
      else record.extra = "invalid";
      writeFileSync(file, JSON.stringify(record));
    } else if (fault === "wrong-hash") renameSync(file, join(registry, `${"0".repeat(64)}.json`));
    else damageRegistry(fault, local.root, file);
    try {
      expect([403, 409, 503]).toContain(
        (await source.restart().request("/projects/proj/renders")).status,
      );
    } finally {
      if (fault === "unwritable") chmodSync(registry, 0o755);
    }
  });

  it.each(["mp4", "png-sequence"] as const)(
    "does not recreate an in-project %s root deleted during identity enumeration",
    async (format) => {
      const { app, project, root, adapter, states } = fixture();
      const startRender = vi.spyOn(adapter, "startRender");
      const { started, release } = pauseEnumeration(adapter);
      const request = app.request("/projects/proj/render", {
        method: "POST",
        body: JSON.stringify({ format }),
      });
      await started;
      try {
        rmSync(project.dir, { recursive: true });
        expect(existsSync(project.dir)).toBe(false);
      } finally {
        release();
      }
      const response = await request;
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not found", why: "project_dir_missing" });
      expect(states).toHaveLength(0);
      expect(startRender).not.toHaveBeenCalled();
      expect(existsSync(project.dir)).toBe(false);
      expect(existsSync(root)).toBe(false);
      expect(existsSync(join(root, ".hf-render-identities"))).toBe(false);
    },
  );

  describe.each(["mp4", "png-sequence"] as const)(
    "%s identity publication boundaries",
    (format) => {
      it.each([
        { target: "root", replacement: "missing", status: 503 },
        { target: "root", replacement: "file", status: 503 },
        { target: "root", replacement: "symlink", status: 403 },
        { target: "registry", replacement: "file", status: 503 },
        { target: "registry", replacement: "symlink", status: 403 },
      ] as const)(
        "refuses $target replaced by $replacement during identity enumeration without outside writes",
        async ({ target, replacement, status }) => {
          const { app, project, root, adapter, states } = fixture();
          const startRender = vi.spyOn(adapter, "startRender");
          const outside = mkdtempSync(join(tmpdir(), "hf-identity-outside-"));
          roots.push(outside);
          const path = target === "root" ? root : join(root, ".hf-render-identities");
          const { started, release } = pauseEnumeration(adapter);
          const request = app.request("/projects/proj/render", {
            method: "POST",
            body: JSON.stringify({ format }),
          });
          await started;
          try {
            rmSync(path, { recursive: true, force: true });
            if (replacement === "file") writeFileSync(path, "keep");
            if (replacement === "symlink") symlinkSync(outside, path);
          } finally {
            release();
          }
          const response = await request;
          expect(response.status).toBe(status);
          expect(states).toHaveLength(0);
          expect(startRender).not.toHaveBeenCalled();
          expect(existsSync(project.dir)).toBe(true);
          expect(readdirSync(outside)).toEqual([]);
          if (replacement === "missing") expect(existsSync(path)).toBe(false);
          if (replacement === "file") expect(readFileSync(path, "utf8")).toBe("keep");
          if (replacement === "symlink") expect(readlinkSync(path)).toBe(outside);
        },
      );

      it("refuses parent-symlink redirection to a different canonical render root", async () => {
        const { app, project, adapter, states } = fixture();
        const startRender = vi.spyOn(adapter, "startRender");
        const original = join(project.dir, "original");
        const redirected = join(project.dir, "redirected");
        const parent = join(project.dir, "current");
        for (const dir of [original, redirected])
          mkdirSync(join(dir, "project", "renders"), { recursive: true });
        symlinkSync(original, parent);
        const linkedProject = { id: "proj", dir: join(parent, "project") };
        adapter.resolveProject = () => linkedProject;
        adapter.listProjects = async () => [linkedProject];
        const { started, release } = pauseEnumeration(adapter);
        const request = app.request("/projects/proj/render", {
          method: "POST",
          body: JSON.stringify({ format }),
        });
        await started;
        try {
          rmSync(parent);
          symlinkSync(redirected, parent);
        } finally {
          release();
        }
        const response = await request;
        expect(response.status).toBe(409);
        expect(states).toHaveLength(0);
        expect(startRender).not.toHaveBeenCalled();
        expect(readlinkSync(parent)).toBe(redirected);
        for (const dir of [original, redirected]) {
          expect(readdirSync(join(dir, "project", "renders"))).toEqual([]);
        }
      });
    },
  );

  it("creates a private registry for first, repeated, and simultaneous same-root claims", async () => {
    const { root } = fixture();
    const listRoots = async () => [root];
    const first = await new RenderIdentityStore(listRoots).claim(root, "same", ".mp4", "file");
    const registry = join(root, ".hf-render-identities");
    const originalRecords = readdirSync(registry).map((name) => ({
      name,
      contents: readFileSync(join(registry, name), "utf8"),
    }));
    const claims = await Promise.all([
      new RenderIdentityStore(listRoots).claim(root, "same", ".mp4", "file"),
      new RenderIdentityStore(listRoots).claim(root, "same", "", "directory"),
    ]);
    expect(new Set([first, ...claims].map((claim) => claim.id)).size).toBe(3);
    expect(lstatSync(registry).mode & 0o777).toBe(0o700);
    expect(readdirSync(registry)).toHaveLength(3);
    for (const { name, contents } of originalRecords) {
      expect(readFileSync(join(registry, name), "utf8")).toBe(contents);
    }
    for (const { id, ...owner } of [first, ...claims]) {
      expect(await new RenderIdentityStore(listRoots).resolve(id)).toEqual(owner);
    }
  });

  it("refuses an external-root render when its project disappears while reading the request body", async () => {
    const { app, root, adapter, states } = fixture();
    const project = { id: "proj", dir: join(root, "..", "project") };
    mkdirSync(project.dir);
    adapter.resolveProject = () => project;
    adapter.listProjects = async () => [project];
    adapter.rendersDir = () => root;
    rmSync(root, { recursive: true });
    let release!: () => void;
    let reading!: () => void;
    const started = new Promise<void>((resolve) => {
      reading = resolve;
    });
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          return new Promise<void>((resolve) => {
            release = () => {
              controller.enqueue(new TextEncoder().encode("{}"));
              controller.close();
              resolve();
            };
            reading();
          });
        },
      },
      { highWaterMark: 0 },
    );
    const request = app.request(
      new Request("http://localhost/projects/proj/render", {
        method: "POST",
        body,
        ...{ duplex: "half" },
      }),
    );
    await started;
    rmSync(project.dir, { recursive: true });
    release();
    const response = await request;
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ why: "project_dir_missing" });
    expect(states).toHaveLength(0);
    expect(existsSync(root)).toBe(false);
  });

  it("refuses an external-root render when its project disappears during identity enumeration", async () => {
    const { app, root, adapter, states } = fixture();
    const project = { id: "proj", dir: join(root, "..", "project") };
    mkdirSync(project.dir);
    adapter.resolveProject = () => project;
    adapter.rendersDir = () => root;
    let release!: () => void;
    let enumerating!: () => void;
    const started = new Promise<void>((resolve) => {
      enumerating = resolve;
    });
    adapter.listProjects = () =>
      new Promise((resolve) => {
        release = () => resolve([project]);
        enumerating();
      });
    const request = app.request("/projects/proj/render", { method: "POST", body: "{}" });
    await started;
    rmSync(project.dir, { recursive: true });
    release();
    const response = await request;
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ why: "project_dir_missing" });
    expect(states).toHaveLength(0);
    expect(readdirSync(root).filter((name) => !name.startsWith("."))).toEqual([]);
  });

  it("reserves distinct global IDs during simultaneous claims in different roots before artifacts exist", async () => {
    const first = fixture();
    const second = fixture();
    const roots = async () => [first.root, second.root];
    const a = new RenderIdentityStore(roots);
    const b = new RenderIdentityStore(roots);
    const claims = await Promise.all([
      a.claim(first.root, "same", ".mp4", "file"),
      b.claim(second.root, "same", ".mp4", "file"),
    ]);
    expect(new Set(claims.map((claim) => claim.id)).size).toBe(2);
    for (const claim of claims)
      expect(await new RenderIdentityStore(roots).resolve(claim.id)).toEqual({
        root: claim.root,
        output: claim.output,
        kind: "file",
      });
  });

  it("refuses deleting an already mapped output when its required registry becomes unwritable", async () => {
    const { app, root, restart } = fixture();
    const id = await start(app, "mp4");
    const registry = join(root, ".hf-render-identities");
    chmodSync(registry, 0o555);
    try {
      expect([403, 409, 503]).toContain((await remove(restart(), id)).status);
      expect(readFileSync(join(root, `${id}.mp4`), "utf8")).toBe("video");
    } finally {
      chmodSync(registry, 0o755);
    }
  });

  it("keeps a posted PNG owner across restarts, before listing, and preserves its MP4 counterpart", async () => {
    const { app, root, restart } = fixture();
    const id = await start(app, "png-sequence");
    writeFileSync(join(root, `${id}.mp4`), "keep-video");
    const restarted = restart();
    const download = await restarted.request(`/render/${id}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/zip");
    await download.arrayBuffer();
    expect((await remove(restarted, id)).status).toBe(200);
    expect(existsSync(join(root, id))).toBe(false);
    expect(readFileSync(join(root, `${id}.mp4`), "utf8")).toBe("keep-video");
  });

  it("resolves a listed directory alias before and after history on repeated restarts", async () => {
    const { app, root, restart } = fixture();
    sequence(join(root, "intro"));
    writeFileSync(join(root, "intro.mp4"), "keep-video");
    const id = (await rows(app)).find((r) => r.kind === "directory")!.id;
    for (let n = 0; n < 2; n++) {
      const restarted = restart();
      const download = await restarted.request(`/render/${id}/download`);
      expect(download.status).toBe(200);
      await download.arrayBuffer();
      expect((await rows(restarted)).find((r) => r.kind === "directory")?.id).toBe(id);
    }
    expect((await remove(restart(), id)).status).toBe(200);
    expect(existsSync(join(root, "intro"))).toBe(false);
    expect(readFileSync(join(root, "intro.mp4"), "utf8")).toBe("keep-video");
  });

  it("blocks uncertain legacy bare IDs permanently, including after the counterpart disappears", async () => {
    const { app, root, restart } = fixture();
    sequence(join(root, "intro"));
    writeFileSync(join(root, "intro.mp4"), "keep-video");
    expect((await remove(app, "intro")).status).toBe(409);
    expect(existsSync(join(root, "intro", "frame_000001.png"))).toBe(true);
    expect(existsSync(join(root, "intro.mp4"))).toBe(true);
    const history = await rows(app);
    expect(history.every((r) => r.id !== "intro")).toBe(true);
    const directoryId = history.find((r) => r.kind === "directory")!.id;
    expect((await remove(app, directoryId)).status).toBe(200);
    const response = await remove(restart(), "intro");
    expect(response.status).toBe(409);
    expect(await response.text()).toMatch(/refresh/i);
    expect(readFileSync(join(root, "intro.mp4"), "utf8")).toBe("keep-video");
  });

  it("never qualifies or recursively deletes a notes folder through generic video metadata", async () => {
    const { app, root } = fixture();
    writeFileSync(join(root, "intro.mp4"), "video");
    writeFileSync(
      join(root, "intro.meta.json"),
      '{"status":"complete","frameCount":42,"size":100}',
    );
    mkdirSync(join(root, "intro"));
    writeFileSync(join(root, "intro", "notes.txt"), "keep-notes");
    const history = await rows(app);
    expect(history.map((r) => r.filename)).toEqual(["intro.mp4"]);
    expect((await remove(app, "intro")).status).toBe(200);
    expect(readFileSync(join(root, "intro", "notes.txt"), "utf8")).toBe("keep-notes");
  });

  it("protects the resolved file family when deletion uses a MOV alias", async () => {
    const { app, root, states } = fixture();
    const id = await start(app, "mp4");
    states[0]!.status = "rendering";
    writeFileSync(join(root, `${id}.mov`), "keep-mov");
    const movId = (await rows(app)).find((r) => r.filename.endsWith(".mov"))!.id;
    expect((await remove(app, movId)).status).toBe(409);
    expect(readFileSync(join(root, `${id}.mp4`), "utf8")).toBe("video");
    expect(readFileSync(join(root, `${id}.mov`), "utf8")).toBe("keep-mov");
    states[0]!.status = "complete";
    expect((await remove(app, movId)).status).toBe(200);
    expect(existsSync(join(root, `${id}.mp4`))).toBe(false);
    expect(existsSync(join(root, `${id}.mov`))).toBe(false);
    expect((await app.request(`/render/${id}/progress`)).status).toBe(404);
  });

  it("revalidates a registered directory after its frames were replaced with unrelated files", async () => {
    const { app, root } = fixture();
    sequence(join(root, "seq"));
    const id = (await rows(app))[0]!.id;
    rmSync(join(root, "seq", "frame_000001.png"));
    writeFileSync(join(root, "seq", "notes.txt"), "keep");
    expect((await remove(app, id)).status).toBe(409);
    expect(readFileSync(join(root, "seq", "notes.txt"), "utf8")).toBe("keep");
  });

  it("validates every file-family removal candidate before removing the first one", async () => {
    const { app, root } = fixture();
    writeFileSync(join(root, "clip.mp4"), "keep");
    mkdirSync(join(root, "clip.webm"));
    expect([403, 409]).toContain((await remove(app, "clip")).status);
    expect(readFileSync(join(root, "clip.mp4"), "utf8")).toBe("keep");
    expect(existsSync(join(root, "clip.webm"))).toBe(true);
  });

  it("reserves posted IDs after deletion and simultaneous claims from separate servers", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const { app, root, restart } = fixture();
    const ids = await Promise.all([start(app, "mp4"), start(restart(), "mp4")]);
    expect(new Set(ids).size).toBe(2);
    expect((await remove(app, ids[0]!)).status).toBe(200);
    const next = await start(restart(), "mp4");
    expect(ids).not.toContain(next);
    expect(readFileSync(join(root, `${ids[1]}.mp4`), "utf8")).toBe("video");
  });

  it.each([
    "corrupt",
    "incomplete",
    "escaping",
    "symlink",
    "registry-symlink",
    "unwritable",
  ] as const)("fails closed on a %s required identity registry", async (fault) => {
    const { app, root, restart } = fixture();
    writeFileSync(join(root, "clip.mp4"), "keep");
    const id = (await rows(app))[0]!.id;
    const registry = join(root, ".hf-render-identities");
    const files = existsSync(registry)
      ? readdirSync(registry).filter((f) => f.endsWith(".json"))
      : [];
    expect(files.length).toBeGreaterThan(0);
    const record = join(registry, files[0]!);
    damageRegistry(fault, root, record);
    try {
      const response =
        fault === "unwritable"
          ? await restart().request("/projects/proj/renders")
          : await remove(restart(), id);
      expect([403, 409, 503]).toContain(response.status);
      expect(readFileSync(join(root, "clip.mp4"), "utf8")).toBe("keep");
    } finally {
      if (fault === "unwritable") chmodSync(registry, 0o755);
    }
  });

  it("does not follow unknown aliases or interrupted temporary claims into artifacts", async () => {
    const { app, root, restart } = fixture();
    const alias = ".hf-render~unknown";
    sequence(join(root, alias));
    expect((await remove(app, alias)).status).toBe(404);
    expect(existsSync(join(root, alias, "frame_000001.png"))).toBe(true);
    const id = await start(app, "mp4");
    writeFileSync(join(root, ".hf-render-identities", ".interrupted.tmp"), '{"version":1');
    expect(await (await restart().request(`/render/${id}/download`)).text()).toBe("video");
  });

  it("keeps identity records private through the direct-file endpoint", async () => {
    const { app, root } = fixture();
    await start(app, "mp4");
    const registry = join(root, ".hf-render-identities");
    const record = readdirSync(registry).find((name) => name.endsWith(".json"))!;
    const response = await app.request(
      `/projects/proj/renders/file/.hf-render-identities/${record}`,
    );
    expect([403, 404]).toContain(response.status);
  });

  it("keeps duplicate project IDs scoped to their exact render root", async () => {
    const first = fixture();
    const second = fixture();
    writeFileSync(join(first.root, "intro.mp4"), "first");
    writeFileSync(join(second.root, "intro.mp4"), "second");
    const projects = [
      { id: "proj", dir: join(first.root, "..") },
      { id: "proj", dir: join(second.root, "..") },
    ];
    first.adapter.listProjects = async () => projects;
    const history = await rows(first.app);
    expect(history).toHaveLength(1);
    const id = history[0]!.id;
    expect(id).not.toBe("intro");
    expect((await remove(first.restart(), id)).status).toBe(200);
    expect(existsSync(join(first.root, "intro.mp4"))).toBe(false);
    expect(readFileSync(join(second.root, "intro.mp4"), "utf8")).toBe("second");
    expect((await remove(first.restart(), "intro")).status).toBe(409);
  });

  it("refuses a file-family alias while cancellation is still settling", async () => {
    const { app, root, states } = fixture();
    const id = await start(app, "mp4");
    const state = states[0]!;
    state.status = "rendering";
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => {
      finish = resolve;
    });
    state.cancel = () => settled;
    writeFileSync(join(root, `${id}.mov`), "keep");
    const alias = (await rows(app)).find((r) => r.filename.endsWith(".mov"))!.id;
    const cancelling = app.request(`/render/${id}/cancel`, { method: "POST" });
    await vi.waitFor(() => expect(state.status).toBe("cancelled"));
    expect((await remove(app, alias)).status).toBe(409);
    expect(readFileSync(join(root, `${id}.mp4`), "utf8")).toBe("video");
    finish();
    expect((await cancelling).status).toBe(200);
    expect((await remove(app, alias)).status).toBe(200);
    expect(existsSync(join(root, `${id}.mov`))).toBe(false);
  });

  it.each(["mp4", "png-sequence"] as const)(
    "keeps a posted %s owner after its counterpart is removed and through repeated restarts",
    async (format) => {
      const { app, root, restart } = fixture();
      const id = await start(app, format);
      const output = format === "mp4" ? `${id}.mp4` : id;
      const counterpart = format === "mp4" ? id : `${id}.mp4`;
      if (format === "mp4") sequence(join(root, counterpart));
      else writeFileSync(join(root, counterpart), "counterpart");
      const history = await rows(restart());
      expect(history.find((r) => r.filename === output)?.id).toBe(id);
      const otherId = history.find((r) => r.filename === counterpart)!.id;
      expect((await remove(restart(), otherId)).status).toBe(200);
      expect(existsSync(join(root, output))).toBe(true);
      expect(existsSync(join(root, counterpart))).toBe(false);
      expect((await rows(restart()))[0]?.id).toBe(id);
      const download = await restart().request(`/render/${id}/download`);
      expect(download.status).toBe(200);
      await download.arrayBuffer();
      expect((await remove(restart(), id)).status).toBe(200);
      expect(existsSync(join(root, output))).toBe(false);
    },
  );

  it("refuses conflicting ownership across roots before mutating either output", async () => {
    const first = fixture();
    const second = fixture();
    writeFileSync(join(first.root, "intro.mp4"), "first");
    writeFileSync(join(second.root, "intro.mp4"), "second");
    expect((await rows(first.app))[0]!.id).toBe("intro");
    expect((await rows(second.app))[0]!.id).toBe("intro");
    first.adapter.listProjects = async () => [
      { id: "proj", dir: join(first.root, "..") },
      { id: "proj", dir: join(second.root, "..") },
    ];
    expect((await remove(first.restart(), "intro")).status).toBe(409);
    expect(readFileSync(join(first.root, "intro.mp4"), "utf8")).toBe("first");
    expect(readFileSync(join(second.root, "intro.mp4"), "utf8")).toBe("second");
  });

  it("requires directory-specific metadata to name its own output and ignores linked frames", async () => {
    const { app, root } = fixture();
    for (const name of ["explicit", "wrong", "video", "linked"]) mkdirSync(join(root, name));
    writeFileSync(
      join(root, "explicit.meta.json"),
      '{"kind":"directory","outputName":"explicit","frameCount":0,"size":0}',
    );
    writeFileSync(
      join(root, "wrong.meta.json"),
      '{"kind":"directory","outputName":"elsewhere","frameCount":9,"size":10}',
    );
    writeFileSync(join(root, "video.meta.json"), '{"kind":"file","frameCount":9,"size":10}');
    writeFileSync(join(root, "outside.png"), "not-a-frame");
    symlinkSync(join(root, "outside.png"), join(root, "linked", "frame_000001.png"));
    expect((await rows(app)).map((r) => r.filename)).toEqual(["explicit"]);
    expect((await remove(app, "explicit")).status).toBe(200);
    expect(existsSync(join(root, "explicit"))).toBe(false);
    expect(existsSync(join(root, "wrong"))).toBe(true);
    expect(existsSync(join(root, "video"))).toBe(true);
    expect(existsSync(join(root, "linked"))).toBe(true);
  });
});
