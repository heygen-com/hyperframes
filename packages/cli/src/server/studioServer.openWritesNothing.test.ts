import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
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

const snapshot = () =>
  Object.fromEntries(
    fs
      .readdirSync(dir, { recursive: true, encoding: "utf-8" })
      .filter((file) => !file.startsWith(".hyperframes"))
      .sort()
      .map((file) => {
        try {
          return [file, fs.readFileSync(path.join(dir, file), "utf-8")];
        } catch {
          return [file, null];
        }
      }),
  );

afterEach(() => {
  server?.watcher.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("opening a film of external scenes", () => {
  it("writes nothing to the project, so opening it neither edits a file nor reloads Studio", async () => {
    const before = snapshot();
    server = createStudioServer({ projectDir: dir, projectName: "film" });
    const changed: string[] = [];
    server.watcher.addListener((changedPath) => changed.push(changedPath));

    expect((await server.app.request("/api/projects/film/preview")).status).toBe(200);
    for (const id of SCENES) {
      const comp = await server.app.request(
        `/api/projects/film/preview/comp/compositions/${id}.html`,
      );
      expect(comp.status).toBe(200);
      expect(await comp.text()).toContain("data-hf-id=");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(snapshot()).toEqual(before);
    expect(changed).toEqual([]);
  });

  it("serves a scene added after open with the ids its source mints, so a save can find them", async () => {
    server = createStudioServer({ projectDir: dir, projectName: "film" });
    const added = `<template id="added-template"><div data-composition-id="added" data-width="320" data-height="180"><img class="logo" src="logo.png"></div></template>`;
    fs.writeFileSync(path.join(dir, "compositions", "added.html"), added);
    fs.writeFileSync(path.join(dir, "compositions", "logo.png"), "png");
    fs.writeFileSync(path.join(dir, "index.html"), root(["added"]));

    const html = await (await server.app.request("/api/projects/film/preview")).text();

    const img = /<img[^>]*class="logo"[^>]*>/.exec(html)?.[0] ?? "";
    expect(img).toContain("compositions/logo.png");
    expect(/data-hf-id="([^"]+)"/.exec(img)?.[1]).toBe(
      /<img[^>]*data-hf-id="([^"]+)"/.exec(ensureHfIds(added))?.[1],
    );
    expect(fs.readFileSync(path.join(dir, "compositions", "added.html"), "utf-8")).toBe(added);
    expect(fs.readFileSync(path.join(dir, "index.html"), "utf-8")).toBe(root(["added"]));
  });

  it("pins the ids into a file when an edit to it is saved", async () => {
    server = createStudioServer({ projectDir: dir, projectName: "film" });
    const served = await (
      await server.app.request("/api/projects/film/preview/comp/compositions/s00.html")
    ).text();
    const hfId = /<h1[^>]*data-hf-id="([^"]+)"/.exec(served)?.[1];
    expect(hfId).toBeTruthy();

    const res = await server.app.request(
      "/api/projects/film/file-mutations/patch-element/compositions/s00.html",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target: { hfId },
          operations: [{ type: "inline-style", property: "color", value: "red" }],
        }),
      },
    );

    expect(res.status).toBe(200);
    const saved = fs.readFileSync(path.join(dir, "compositions", "s00.html"), "utf-8");
    const heading = /<h1[^>]*>/.exec(saved)?.[0] ?? "";
    expect(heading).toContain(`data-hf-id="${hfId}"`);
    expect(heading).toContain("color: red");
  });
});
