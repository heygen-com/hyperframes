import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { compositionsAffectedBy } from "@hyperframes/studio-server";
import { createStudioServer, type StudioServer } from "./studioServer.js";
import { cleanupStudioServerRoot, makeStudioServerRoot } from "./studioServerTestFixture.js";

let root: string;
let server: StudioServer | undefined;
let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

afterEach(async () => {
  await reader?.cancel();
  if (server) cleanupStudioServerRoot(server, root);
});

it.runIf(process.platform === "linux")(
  "refreshes every composition and cached preview when its project directory is replaced",
  async () => {
    const fixture = makeStudioServerRoot("hf-preview-replace-");
    root = fixture.root;
    const { projectDir } = fixture;
    const rootHtml = (label: string) => `<html><head></head><body>
    <div data-composition-id="main" data-width="320" data-height="180">
      <p>${label}</p><div data-composition-id="intro" data-composition-src="scenes/intro.html" data-start="0" data-duration="1"></div>
    </div></body></html>`;
    const scene = (
      text: string,
    ) => `<template><div data-composition-id="intro" data-width="320" data-height="180">
    <h1>${text}</h1></div></template>`;
    mkdirSync(join(projectDir, "scenes"));
    writeFileSync(join(projectDir, "index.html"), rootHtml("Initial"));
    writeFileSync(join(projectDir, "scenes/intro.html"), scene("Original"));
    expect(compositionsAffectedBy(projectDir, "index.html")).toBeNull();
    writeFileSync(join(projectDir, "index.html"), rootHtml("Unchanged root"));
    server = createStudioServer({ projectDir, projectName: "film" });
    expect(compositionsAffectedBy(projectDir, "index.html")).toEqual(["index.html"]);
    const app = server.app;
    const endpoint = "/api/projects/film/preview/comp/scenes/intro.html";
    const before = await app.request(endpoint);
    expect(before.status).toBe(200);
    expect(await before.text()).toContain("Original");
    const beforeTag = before.headers.get("etag");
    expect(beforeTag).toBeTruthy();

    const response = await app.request("/api/events");
    reader = response.body!.getReader();
    const deliveries: string[] = [];
    const consume = async () => {
      while (true) {
        const next = await reader!.read();
        if (next.done) return;
        deliveries.push(new TextDecoder().decode(next.value));
      }
    };
    const consuming = consume();
    try {
      const replacement = join(root, "replacement");
      mkdirSync(join(replacement, "scenes"), { recursive: true });
      writeFileSync(join(replacement, "index.html"), readFileSync(join(projectDir, "index.html")));
      writeFileSync(join(replacement, "scenes/intro.html"), scene("Replacement"));
      renameSync(projectDir, join(root, "previous"));
      renameSync(replacement, projectDir);

      await vi.waitFor(() => {
        const event = deliveries
          .join("")
          .split("\n")
          .find((line) => line.startsWith("data:") && line.includes('"path":"."'));
        expect(event).toBeDefined();
        expect(JSON.parse(event!.slice(5))).toMatchObject({
          path: ".",
          projectId: "film",
          affectsPreview: true,
          affectedCompositions: null,
        });
      });
      const after = await app.request(endpoint, { headers: { "If-None-Match": beforeTag! } });
      expect(after.status).toBe(200);
      expect(after.headers.get("etag")).not.toBe(beforeTag);
      expect(await after.text()).toContain("Replacement");

      writeFileSync(join(projectDir, "scenes/intro.html"), scene("Later edit"));
      await vi.waitFor(async () => {
        const later = await app.request(endpoint);
        expect(later.status).toBe(200);
        expect(await later.text()).toContain("Later edit");
      });
    } finally {
      await reader.cancel();
      await consuming;
    }
  },
);

it.runIf(process.platform === "linux")(
  "refreshes the cached preview when a populated .hyperframes folder is replaced",
  async () => {
    const fixture = makeStudioServerRoot("hf-preview-replace-manifests-");
    root = fixture.root;
    const { projectDir } = fixture;
    writeFileSync(
      join(projectDir, "index.html"),
      `<html><body><div data-composition-id="main" data-width="320" data-height="180"></div></body></html>`,
    );
    mkdirSync(join(projectDir, ".hyperframes"));
    writeFileSync(join(projectDir, ".hyperframes/studio-motion.json"), "{}");
    server = createStudioServer({ projectDir, projectName: "film" });
    const endpoint = "/api/projects/film/preview/comp/index.html";
    const before = await server.app.request(endpoint);
    expect(before.status).toBe(200);
    const beforeTag = before.headers.get("etag");
    expect(beforeTag).toBeTruthy();

    const replacement = join(root, "next-manifests");
    mkdirSync(replacement);
    writeFileSync(join(replacement, "studio-motion.json"), '{"intro":{"opacity":0.5}}');
    renameSync(join(projectDir, ".hyperframes"), join(root, "previous-manifests"));
    renameSync(replacement, join(projectDir, ".hyperframes"));

    await vi.waitFor(async () => {
      const after = await server!.app.request(endpoint, {
        headers: { "If-None-Match": beforeTag! },
      });
      expect(after.status).toBe(200);
      expect(after.headers.get("etag")).not.toBe(beforeTag);
    });
  },
);
