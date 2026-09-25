import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { ProjectDir } from "../utils/project.js";
import { registerCompositionRoute } from "./play.js";
import { registerPresentCompositionRoute } from "./present.js";

// Hono's c.req.path leaves %40 %25 %23 %26 %3F encoded; Windows file names cannot hold "?".
const NAMES = [
  "A @HyperFrames launch",
  "50% off",
  "#2 take",
  "Tom & Jerry",
  ...(process.platform === "win32" ? [] : ["why?"]),
  "two  spaces",
  "café crème",
  "🎬 film",
];

const ROUTES = [
  ["play", (app: Hono, project: ProjectDir) => registerCompositionRoute(app, project, false)],
  ["present", registerPresentCompositionRoute],
] as const;

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function requestAsset(
  register: (app: Hono, project: ProjectDir) => Promise<void>,
  name: string,
) {
  dir = mkdtempSync(join(tmpdir(), "hf-composition-route-"));
  mkdirSync(join(dir, "scenes"));
  writeFileSync(join(dir, "scenes", `${name}.txt`), `ASSET ${name}`);
  const app = new Hono();
  await register(app, { dir, name: "test-project", indexPath: join(dir, "index.html") });
  const response = await app.request(`/composition/scenes/${encodeURIComponent(`${name}.txt`)}`);
  return { status: response.status, text: await response.text() };
}

describe.each(ROUTES)("%s /composition/*", (_route, register) => {
  it.each(NAMES)("serves an asset named %j", async (name) => {
    const result = await requestAsset(register, name);
    expect(result.status).toBe(200);
    expect(result.text).toBe(`ASSET ${name}`);
  });
});
