import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { parseHTML } from "linkedom";
import { expect, it, onTestFinished } from "vitest";
import { createPublishArchive, readStaged, stagePublishFiles } from "./publishProject.js";

it.each([Infinity, 1])(
  "preserves existing archive paths when localizing assets (threshold %s)",
  (threshold) => {
    const root = mkdtempSync(join(tmpdir(), "hf-publish-collision-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const project = join(root, "project");
    mkdirSync(join(project, "_ext", "shared"), { recursive: true });
    mkdirSync(join(root, "shared"));
    writeFileSync(join(project, "_ext", "shared", "logo.png"), "existing logo");
    writeFileSync(join(project, "_ext", "shared", "logo_2.png"), "another existing logo");
    writeFileSync(join(root, "shared", "logo.png"), "new external logo");
    const html =
      '<html><body><img src="_ext/shared/logo.png"><img src="_ext/shared/logo_2.png"><img src="../shared/logo.png"><img src="../shared/logo.png"></body></html>';
    writeFileSync(join(project, "index.html"), html);

    const files = stagePublishFiles(project, threshold);
    const contents = new Map([...files].map(([path, file]) => [path, readStaged(file).toString()]));
    expect(contents.size).toBe(4);
    expect(contents.get("_ext/shared/logo.png")).toBe("existing logo");
    expect(contents.get("_ext/shared/logo_2.png")).toBe("another existing logo");
    expect(contents.get("_ext/shared/logo_3.png")).toBe("new external logo");
    const { document } = parseHTML(contents.get("index.html") ?? "");
    expect([...document.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([
      "_ext/shared/logo.png",
      "_ext/shared/logo_2.png",
      "_ext/shared/logo_3.png",
      "_ext/shared/logo_3.png",
    ]);

    const archive = createPublishArchive(project);
    const zip = new AdmZip(archive.buffer);
    expect(archive.fileCount).toBe(4);
    expect(zip.readAsText("_ext/shared/logo.png")).toBe("existing logo");
    expect(zip.readAsText("_ext/shared/logo_3.png")).toBe("new external logo");
    expect(readFileSync(join(project, "index.html"), "utf-8")).toBe(html);
    expect(readFileSync(join(project, "_ext", "shared", "logo.png"), "utf-8")).toBe(
      "existing logo",
    );
  },
);
