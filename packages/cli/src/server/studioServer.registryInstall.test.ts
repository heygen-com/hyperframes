import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackRegistryItemAdded } from "../telemetry/events.js";
import { createStudioServer, type StudioServer } from "./studioServer.js";

vi.mock("../telemetry/events.js", () => ({ trackRegistryItemAdded: vi.fn() }));

const SCHEMA = "https://hyperframes.heygen.com/schema/registry-item.json";
// Names no other test uses: the registry cache is shared by every test in a run.
const block = (name: string, dependencies?: string[]) => ({
  $schema: SCHEMA,
  name,
  type: "hyperframes:block",
  title: name,
  description: "Block for tests",
  dimensions: { width: 1080, height: 1350 },
  duration: 6,
  ...(dependencies ? { registryDependencies: dependencies } : {}),
  files: [
    { path: `${name}.html`, target: `compositions/${name}.html`, type: "hyperframes:composition" },
  ],
});
const ITEMS = [
  block("studio-drop-block"),
  block("studio-drop-other"),
  block("studio-drop-parent", ["studio-drop-part"]),
  {
    $schema: SCHEMA,
    name: "studio-drop-part",
    type: "hyperframes:component",
    title: "part",
    description: "Component for tests",
    files: [
      {
        path: "studio-drop-part.html",
        target: "compositions/components/studio-drop-part.html",
        type: "hyperframes:snippet",
      },
    ],
  },
];

const dirs: string[] = [];
let server: StudioServer | undefined;

afterEach(() => {
  server?.watcher.close();
  server = undefined;
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A project behind a symlink whose hyperframes.json points at a stubbed registry; `fetched` logs every URL. */
function projectWithRegistry(onItemFetch?: () => void): {
  link: string;
  real: string;
  registry: string;
  fetched: string[];
} {
  const fetched: string[] = [];
  const registry = `https://test.invalid/${crypto.randomUUID()}`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      fetched.push(url);
      // Only the project's own registry answers, so nothing is cached for the public registry.
      if (!url.startsWith(registry)) return new Response("not found", { status: 404 });
      if (url.endsWith("/registry.json")) {
        const items = ITEMS.map(({ name, type }) => ({ name, type }));
        const $schema = "https://hyperframes.heygen.com/schema/registry.json";
        return new Response(
          JSON.stringify({ $schema, name: "t", homepage: "https://example.com", items }),
        );
      }
      const item = ITEMS.find((candidate) => url.includes(`/${candidate.name}/`));
      if (item && url.endsWith("/registry-item.json")) {
        onItemFetch?.();
        return new Response(JSON.stringify(item));
      }
      if (item && url.endsWith(".html")) {
        return new Response(
          `<meta name="viewport" content="width=1080, height=1350"><div data-composition-id="${item.name}"></div>`,
        );
      }
      return new Response("not found", { status: 404 });
    }),
  );
  const root = mkdtempSync(join(tmpdir(), "hf-studio-install-"));
  dirs.push(root);
  const real = join(root, "real");
  mkdirSync(real);
  const link = join(root, "link");
  symlinkSync(real, link, "junction");
  writeFileSync(join(real, "index.html"), '<div data-width="1920" data-height="1080"></div>');
  writeFileSync(
    join(real, "hyperframes.json"),
    JSON.stringify({ registry, paths: { blocks: "scenes" } }),
  );
  server = createStudioServer({ projectDir: link });
  return { link, real, registry, fetched };
}

function installer(link: string) {
  return (blockName: string) =>
    server!.adapter.installRegistryBlock!({
      project: { dir: link, id: "p", title: "p" },
      blockName,
    } as never);
}

describe("Studio catalog install", () => {
  it("answers that the project folder is gone when it is renamed while the item downloads", async () => {
    let real = "";
    ({ real } = projectWithRegistry(() => renameSync(real, `${real}-renamed`)));

    const response = await server!.app.request("/api/projects/link/registry/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockName: "studio-drop-block" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ why: "project_dir_missing" });
    expect(existsSync(real)).toBe(false);
  });

  it("answers that the project folder is gone, and does not recreate it, after a rename", async () => {
    const { real } = projectWithRegistry();
    renameSync(real, `${real}-renamed`);

    const response = await server!.app.request("/api/projects/link/registry/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockName: "studio-drop-block" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ why: "project_dir_missing" });
    expect(existsSync(real)).toBe(false);
  });

  it("installs through add: honours the project's block folder and records the item", async () => {
    const { link, real } = projectWithRegistry();

    const result = await installer(link)("studio-drop-block");

    expect(result.written).toEqual(["scenes/studio-drop-block.html"]);
    expect(result.block.name).toBe("studio-drop-block");
    expect(trackRegistryItemAdded).toHaveBeenCalledWith(
      expect.objectContaining({ item: "studio-drop-block", source: "studio" }),
    );
    expect(existsSync(join(real, "compositions/studio-drop-block.html"))).toBe(false);
    const config = JSON.parse(readFileSync(join(real, "hyperframes.json"), "utf-8"));
    expect(config.registryItems).toEqual([
      {
        name: "studio-drop-block",
        type: "hyperframes:block",
        target: "scenes/studio-drop-block.html",
      },
    ]);
  });

  it("lists the catalog from the registry install uses", async () => {
    const { registry, fetched } = projectWithRegistry();

    const items = await server!.adapter.listRegistryCatalog!();

    expect(items.map((item) => item.name).sort()).toEqual(ITEMS.map((item) => item.name).sort());
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.every((url) => url.startsWith(registry))).toBe(true);
  });

  it("installs a block sized unlike the project twice, and leaves a real edit alone", async () => {
    const { link, real } = projectWithRegistry();
    const install = installer(link);
    const file = join(real, "scenes/studio-drop-block.html");

    await install("studio-drop-block");
    expect(readFileSync(file, "utf-8")).toContain('content="width=1920, height=1080"');
    expect((await install("studio-drop-block")).written).toEqual(["scenes/studio-drop-block.html"]);

    writeFileSync(file, "my own edit");
    expect((await install("studio-drop-block")).written).toEqual([]);
    expect(readFileSync(file, "utf-8")).toBe("my own edit");
  });

  it("keeps an edit to one block when another block is installed", async () => {
    const { link, real } = projectWithRegistry();
    const install = installer(link);
    const file = join(real, "scenes/studio-drop-block.html");

    await install("studio-drop-block");
    writeFileSync(file, "my own edit");
    await install("studio-drop-other");
    await install("studio-drop-block");

    expect(readFileSync(file, "utf-8")).toBe("my own edit");
  });

  it("names the block's own file, as recorded, when its folder is a symlink inside the project", async () => {
    const { link, real } = projectWithRegistry();
    mkdirSync(join(real, "shared-scenes"));
    symlinkSync(join(real, "shared-scenes"), join(real, "scenes"), "junction");
    const install = installer(link);

    await install("studio-drop-block");
    expect(readFileSync(join(real, "scenes/studio-drop-block.html"), "utf-8")).toContain(
      "width=1920",
    );
    expect((await install("studio-drop-block")).written).toEqual(["scenes/studio-drop-block.html"]);
  });

  it("names the requested block's file first, before its dependencies'", async () => {
    const { link } = projectWithRegistry();

    const { written } = await installer(link)("studio-drop-parent");

    expect(written).toEqual([
      "scenes/studio-drop-parent.html",
      "compositions/components/studio-drop-part.html",
    ]);
  });
});
