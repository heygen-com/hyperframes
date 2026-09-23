import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { createStudioServer, type StudioServer } from "./studioServer.js";

const SCENES = Array.from({ length: 24 }, (_, i) => `s${String(i).padStart(2, "0")}`);

const scene = (id: string) => `<template id="${id}-template">
  <div data-composition-id="${id}" data-width="320" data-height="180">
    <div class="clip" data-start="0" data-duration="1"><h1>${id}</h1><p>caption</p></div>
  </div>
</template>`;

const root = (ids: string[]) => `<!doctype html>
<html><head></head><body><div data-composition-id="main" data-width="320" data-height="180">
${ids.map((id, i) => `<div data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${i}" data-duration="1"></div>`).join("\n")}
</div></body></html>`;

let dir: string;
let server: StudioServer | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "hf-stamp-on-open-"));
  fs.mkdirSync(path.join(dir, "compositions"));
  fs.writeFileSync(path.join(dir, "index.html"), root(SCENES));
  for (const id of SCENES)
    fs.writeFileSync(path.join(dir, "compositions", `${id}.html`), scene(id));
});

afterEach(() => {
  server?.watcher.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("opening a film of external scenes", () => {
  it("writes nothing to the project mid-session, so Studio sees no outside edit to reload for", async () => {
    server = createStudioServer({ projectDir: dir, projectName: "film" });
    const changed: string[] = [];
    server.watcher.addListener((changedPath) => changed.push(changedPath));

    expect((await server.app.request("/api/projects/film/preview")).status).toBe(200);
    for (const id of SCENES) {
      const comp = await server.app.request(
        `/api/projects/film/preview/comp/compositions/${id}.html`,
      );
      expect(comp.status).toBe(200);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(changed).toEqual([]);
    const stamped = fs.readFileSync(path.join(dir, "compositions", "s23.html"), "utf-8");
    expect(stamped).toContain("data-hf-id=");
  });
});
