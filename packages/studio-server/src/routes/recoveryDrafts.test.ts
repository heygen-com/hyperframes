import { Hono } from "hono";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
