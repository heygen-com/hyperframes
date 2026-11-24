import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { devServesUrl } from "./vite.private-files";

const fsUrl = (path: string) => `/@fs/${path.replace(/\\/g, "/").replace(/^\/+/, "")}`;

const base = realpathSync(mkdtempSync(join(tmpdir(), "hf-dev-files-")));
const checkout = join(base, "checkout");
const studio = join(checkout, "packages", "studio");
const elsewhere = join(base, "my-project");
const roots = { studio, checkout };

function file(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "x");
}

for (const project of [join(studio, "data", "projects", "real"), elsewhere])
  for (const name of [".npmrc", "id_rsa", "sub/.hyperframes/chat.json", ".claude/settings.json"])
    file(join(project, name));
symlinkSync(elsewhere, join(studio, "data", "projects", "linked"));
file(join(studio, "src", "main.tsx"));
file(join(checkout, ".npmrc"));
file(join(checkout, "node_modules", ".bun", "react@19", "node_modules", "react", "index.js"));

afterAll(() => rmSync(base, { recursive: true, force: true }));

// fails without the fix: the dev server answered every URL outside /api from its own file serving.
describe("the dev server serves no project or private file", () => {
  const PRIVATE = [".npmrc", "id_rsa", "sub/.hyperframes/chat.json", ".claude/settings.json"];
  const QUERIES = ["", "?raw", "?url", "?inline", "?import", "?import&raw"];

  it.each(["real", "linked"])("refuses every %s project file, private or not", (project) => {
    for (const name of [...PRIVATE, "index.html"])
      for (const query of QUERIES)
        expect(devServesUrl(`/data/projects/${project}/${name}${query}`, roots)).toBe(false);
  });

  it("refuses a linked project's files by their real path", () => {
    for (const name of PRIVATE)
      expect(devServesUrl(fsUrl(`${elsewhere}/${name}`), roots)).toBe(false);
  });

  it.each([
    "/data/sessions/s.json",
    "/data/renders/r.mp4",
    "/DATA/projects/real/.npmrc",
    "/data/projects/real/%2Enpmrc",
    "/src/../data/projects/real/.npmrc",
    "/src/%2e%2e/data/projects/real/.npmrc",
    fsUrl(`${checkout}/.npmrc`),
    `/@id/${checkout}/.npmrc?raw`,
    `${checkout}/.npmrc?raw`,
    "/%E0%A4%A",
  ])("refuses %s", (url) => {
    expect(devServesUrl(url, roots)).toBe(false);
  });

  it.each([
    "/",
    "/index.html",
    "/src/main.tsx",
    "/src/main.tsx?t=1",
    "/@vite/client",
    "/@react-refresh",
    "/node_modules/.vite/deps/react.js?v=1",
    fsUrl(`${checkout}/node_modules/.bun/react@19/node_modules/react/index.js`),
    fsUrl(`${checkout}/packages/core/src/index.ts`),
  ])("still serves Studio's own %s", (url) => {
    expect(devServesUrl(url, roots)).toBe(true);
  });

  it("still serves a checkout's modules when the checkout sits in a hidden folder", () => {
    const hidden = {
      studio: join(base, ".cache", "co", "packages", "studio"),
      checkout: join(base, ".cache", "co"),
    };
    expect(devServesUrl(fsUrl(`${hidden.checkout}/packages/core/src/index.ts`), hidden)).toBe(true);
    expect(devServesUrl(fsUrl(`${hidden.checkout}/.npmrc`), hidden)).toBe(false);
  });
});
