import { Hono } from "hono";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { StudioApiAdapter } from "../types";
import { registerRecoveryDraftRoutes } from "./recoveryDrafts";

const made: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function draftsApi(dir: string): Hono {
  const api = new Hono();
  registerRecoveryDraftRoutes(api, {
    resolveProject: async (id: string) => (id === "demo" ? { id, dir, title: "Demo" } : null),
  } as unknown as StudioApiAdapter);
  return api;
}

const put = (api: Hono, path: string, body: unknown) =>
  api.request(`/projects/demo/recovery-drafts/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const DRAFT = {
  kind: "failed",
  studioContent: "draft",
  externalVersion: null,
  externalContent: null,
  failureMessage: "disk full",
};

describe("recovery drafts", () => {
  it("answers with the project and path asked for, whatever the stored body named", async () => {
    const api = draftsApi(temp("hf-drafts-"));
    await put(api, "a/index.html", { ...DRAFT, projectId: "other", filePath: "x.html" });

    const res = await api.request(
      `/projects/demo/recovery-drafts/${encodeURIComponent("a/index.html")}`,
    );
    expect((await res.json()).draft).toMatchObject({
      ...DRAFT,
      projectId: "demo",
      filePath: "a/index.html",
    });
  });

  it.skipIf(process.platform === "win32")(
    "never writes a draft through a link at the project's recovery folder",
    async () => {
      const project = temp("hf-drafts-");
      const outside = temp("hf-drafts-outside-");
      mkdirSync(join(project, ".hyperframes"));
      symlinkSync(outside, join(project, ".hyperframes", "recovery"));

      expect((await put(draftsApi(project), "index.html", DRAFT)).status).toBe(409);
      expect(readdirSync(outside)).toEqual([]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "reads a draft without waiting on a pipe and without loading an oversized record",
    () => {
      const project = temp("hf-drafts-");
      const drafts = join(project, ".hyperframes", "recovery");
      mkdirSync(drafts, { recursive: true });
      const record = (file: string) =>
        join(drafts, `${createHash("sha256").update(file).digest("hex")}.json`);
      writeFileSync(record("kept.html"), JSON.stringify({ ...DRAFT, createdAt: 1 }));
      execFileSync("mkfifo", [record("pipe.html")]);
      writeFileSync(record("huge.html"), "");
      truncateSync(record("huge.html"), 200 * 1024 * 1024);

      // In a child: a read that blocks stalls only that process, which the deadline then kills.
      const fixture = join(dirname(fileURLToPath(import.meta.url)), "recoveryDrafts.fixture.ts");
      const child = spawnSync(
        process.execPath,
        ["--import", "tsx", fixture, project, "kept.html", "pipe.html", "huge.html"],
        { encoding: "utf8", timeout: 20_000, killSignal: "SIGKILL" },
      );

      expect(child.signal, child.stderr).toBeNull();
      const answers = child.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(answers).toMatchObject([
        { file: "kept.html", status: 200, draft: { ...DRAFT, filePath: "kept.html" } },
        { file: "pipe.html", status: 200, draft: null },
        { file: "huge.html", status: 200, draft: null },
      ]);
    },
  );
});
