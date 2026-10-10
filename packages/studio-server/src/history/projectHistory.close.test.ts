// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { HistoryBusyError } from "./ownerLock";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { openProjectHistory } from "./projectHistory";
import { START } from "./historyLog";

const archive = vi.hoisted(() => ({
  hold: false,
  entered: "",
  hash: false,
  failCleanup: false,
  partialPath: "",
  aborted: false,
  release: null as (() => void) | null,
}));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const { Readable, addAbortSignal } = await import("node:stream");
  return {
    ...fs,
    createReadStream: (path: string, options?: Parameters<typeof fs.createReadStream>[1]) => {
      const heldPath = archive.hash
        ? String(path).includes("incoming-")
        : String(path).endsWith(".mp4");
      if (!archive.hold || !heldPath) return fs.createReadStream(path, options);
      archive.entered = archive.hash ? "hash" : "copy";
      let sent = false;
      const stream = new Readable({
        read() {
          if (sent) return;
          sent = true;
          this.push(Buffer.alloc(65536, 7));
        },
      });
      archive.release = () => {
        stream.push(Buffer.alloc(2 * 1024 ** 2 - 65536, 7));
        stream.push(null);
      };
      if (typeof options === "object" && options?.signal) addAbortSignal(options.signal, stream);
      stream.on("close", () => {
        archive.aborted = true;
      });
      return stream;
    },
  };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    rm: async (...args: Parameters<typeof fs.rm>) => {
      if (archive.failCleanup && String(args[0]) === archive.partialPath) {
        throw Object.assign(new Error("Cannot remove partial archive"), { code: "EPERM" });
      }
      return fs.rm(...args);
    },
    copyFile: async (...args: Parameters<typeof fs.copyFile>) => {
      if (archive.hold && !archive.hash && String(args[0]).endsWith(".mp4")) {
        await fs.writeFile(args[1], Buffer.alloc(65536, 7));
        await new Promise<void>((resolve) => {
          archive.release = resolve;
        });
      }
      return fs.copyFile(...args);
    },
  };
});
const roots: string[] = [];
afterEach(() => {
  archive.hold = false;
  archive.hash = false;
  archive.entered = "";
  archive.failCleanup = false;
  archive.release = null;
  archive.aborted = false;
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function heldProject(names = ["clip.mp4"], onError?: (error: Error) => void) {
  const root = mkdtempSync(join(tmpdir(), "hf-held-adoption-"));
  roots.push(root);
  const projectDir = join(root, "project");
  mkdirSync(projectDir);
  writeFileSync(join(projectDir, "index.html"), "before");
  for (const name of names) writeFileSync(join(projectDir, name), Buffer.alloc(2 * 1024 ** 2, 7));
  archive.hold = true;
  const historyRoot = join(root, "history");
  const history = await openProjectHistory({ projectDir, historyRoot, onError, quietMs: 30 });
  const home = join(historyRoot, history.projectId);
  return { root, projectDir, historyRoot, history, home, blobs: join(home, "blobs") };
}

it("close cancels a held adoption, flushes text edits and resumes pending media on reopen", async () => {
  const onError = vi.fn();
  const { history, historyRoot, home, blobs, projectDir } = await heldProject(undefined, onError);
  try {
    await vi.waitFor(() => {
      const partial = readdirSync(blobs).find((name) => name.startsWith("incoming-"));
      expect(partial).toBeDefined();
      expect(statSync(join(blobs, partial!)).size).toBeGreaterThan(0);
    });
    writeFileSync(join(projectDir, "index.html"), "after");
    let closed = false;
    const closing = history.close().then(() => {
      closed = true;
    });
    try {
      await vi.waitFor(() => expect(closed).toBe(true));
    } finally {
      archive.release?.();
      await closing;
    }
    expect(archive.aborted).toBe(true);
    expect(JSON.parse(readFileSync(join(home, "adopting.json"), "utf8"))).toEqual(["clip.mp4"]);
    expect(onError).not.toHaveBeenCalled();
    const log = readFileSync(join(home, "log.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const textEdit = log
      .filter((record) => record.type === "entry")
      .flatMap((record) => record.entry.files)
      .find((file) => file.path === "index.html");
    expect(textEdit).toMatchObject({
      before: createHash("sha256").update("before").digest("hex"),
      after: createHash("sha256").update("after").digest("hex"),
    });
    expect(readdirSync(blobs).some((name) => name.startsWith("incoming-"))).toBe(false);
    archive.hold = false;
    const reopened = await openProjectHistory({ projectDir, historyRoot, quietMs: 30 });
    try {
      await vi.waitFor(() => expect(reopened.peek(START)).toHaveProperty(["clip.mp4"]));
      expect(reopened.list().flatMap((entry) => entry.files.map((file) => file.path))).toContain(
        "index.html",
      );
      expect(reopened.peek(START)?.["clip.mp4"]).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await reopened.close();
    }
  } finally {
    archive.hold = false;
    await history.close();
  }
}, 5000);

it.each(["copy", "hash"])(
  "cancelled %s leaves no partial blob before ownership release",
  async (phase) => {
    const { openBlobStore } = await import("./blobStore");
    const root = mkdtempSync(join(tmpdir(), "hf-cancel-blob-"));
    roots.push(root);
    const source = join(root, "clip.mp4");
    writeFileSync(source, Buffer.alloc(2 * 1024 ** 2, 7));
    const dir = join(root, "blobs");
    const store = await openBlobStore(dir);
    archive.hold = true;
    archive.hash = phase === "hash";
    const controller = new AbortController();
    const pending = store.put(source, controller.signal);
    let error: unknown;
    const settled = pending.catch((caught) => {
      error = caught;
    });
    await vi.waitFor(() =>
      expect(readdirSync(dir).some((name) => name.startsWith("incoming-"))).toBe(true),
    );
    await vi.waitFor(() => expect(archive.entered).toBe(phase));
    controller.abort();
    try {
      await vi.waitFor(() => expect(error).toMatchObject({ name: "AbortError" }));
    } finally {
      archive.release?.();
      await settled;
    }
    expect(readdirSync(dir)).toEqual([]);
    expect(store.bytes()).toBe(0);
  },
);

it("failed cancellation cleanup flushes edits but refuses to release ownership", async () => {
  const { history, historyRoot, home, blobs, projectDir } = await heldProject();
  await vi.waitFor(() =>
    expect(readdirSync(blobs).some((name) => name.startsWith("incoming-"))).toBe(true),
  );
  writeFileSync(join(projectDir, "index.html"), "after");
  archive.partialPath = join(
    blobs,
    readdirSync(blobs).find((name) => name.startsWith("incoming-"))!,
  );
  archive.failCleanup = true;
  await expect(history.close()).rejects.toMatchObject({ code: "EPERM" });
  expect(readdirSync(blobs).some((name) => name.startsWith("incoming-"))).toBe(true);
  expect(readFileSync(join(home, "log.jsonl"), "utf8")).toContain(
    createHash("sha256").update("after").digest("hex"),
  );
  await expect(
    openProjectHistory({ projectDir, historyRoot, ownerWaitMs: 0 }),
  ).rejects.toBeInstanceOf(HistoryBusyError);
});

it.each(["replace", "delete", "missing-cache", "malformed-cache"])(
  "refuses unknown original media after %s while closed",
  async (change) => {
    const { root, history, historyRoot, home, projectDir } = await heldProject();
    const clip = join(projectDir, "clip.mp4");
    await vi.waitFor(() =>
      expect(readdirSync(join(home, "blobs")).some((name) => name.startsWith("incoming-"))).toBe(
        true,
      ),
    );
    await history.close();
    if (change === "delete") rmSync(clip);
    else writeFileSync(clip, Buffer.alloc(2 * 1024 ** 2, 9));
    if (change === "missing-cache") rmSync(join(home, "stat.json"));
    if (change === "malformed-cache")
      writeFileSync(
        join(home, "stat.json"),
        JSON.stringify({ "clip.mp4": { hash: "invalid", stat: null } }),
      );
    archive.hold = false;
    const reopened = await openProjectHistory({ projectDir, historyRoot, quietMs: 30 });
    const who = { kind: "person" as const, name: "You" };
    try {
      await vi.waitFor(() =>
        expect(reopened.list().some((entry) => entry.unavailableBefore?.includes("clip.mp4"))).toBe(
          true,
        ),
      );
      const entry = reopened.list().find((entry) => entry.unavailableBefore?.includes("clip.mp4"))!;
      await expect(reopened.step("back", who)).rejects.toThrow(
        "original media version is unavailable",
      );
      await expect(reopened.undo(entry.id, { who })).rejects.toThrow(
        "original media version is unavailable",
      );
      await expect(reopened.restore(START, who)).rejects.toThrow(
        "original media version is unavailable",
      );
      expect(() => reopened.peek(START)).toThrow("original media version is unavailable");
      const checkout = join(root, "checkout");
      mkdirSync(checkout);
      await expect(reopened.checkout(entry.id, "before", checkout)).rejects.toThrow(
        "original media version is unavailable",
      );
      expect(readdirSync(checkout)).toEqual([]);
      if (change === "delete") expect(readdirSync(projectDir)).not.toContain("clip.mp4");
      else expect(readFileSync(clip).equals(Buffer.alloc(2 * 1024 ** 2, 9))).toBe(true);
    } finally {
      await reopened.close();
    }
    const again = await openProjectHistory({ projectDir, historyRoot, quietMs: 30 });
    try {
      await expect(again.step("back", who)).rejects.toThrow(
        "original media version is unavailable",
      );
    } finally {
      await again.close();
    }
  },
);

it("a later media replacement while serial adoption waits is never filed as the original baseline", async () => {
  const { history, projectDir } = await heldProject(["a.mp4", "b.mp4"]);
  try {
    await vi.waitFor(() => expect(archive.entered).toBe("copy"));
    writeFileSync(join(projectDir, "b.mp4"), Buffer.alloc(2 * 1024 ** 2, 9));
    archive.hold = false;
    archive.release!();
    await vi.waitFor(() =>
      expect(history.list().some((entry) => entry.unavailableBefore?.includes("b.mp4"))).toBe(true),
    );
    const entry = history.list().find((entry) => entry.unavailableBefore?.includes("b.mp4"))!;
    expect(entry.files.find((file) => file.path === "b.mp4")?.after).toBe(
      createHash("sha256")
        .update(Buffer.alloc(2 * 1024 ** 2, 9))
        .digest("hex"),
    );
    await expect(history.step("back", { kind: "person", name: "You" })).rejects.toThrow(
      "original media version is unavailable",
    );
  } finally {
    archive.hold = false;
    archive.release?.();
    await history.close();
  }
});
