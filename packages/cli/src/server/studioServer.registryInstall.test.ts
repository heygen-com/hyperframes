import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer, type StudioServer } from "./studioServer.js";

vi.mock("../telemetry/events.js", () => ({ trackRegistryItemAdded: vi.fn() }));

const BLOCK = {
  $schema: "https://hyperframes.heygen.com/schema/registry-item.json",
  name: "my-block",
  type: "hyperframes:block",
  title: "My Block",
  description: "Block for tests",
  dimensions: { width: 1080, height: 1350 },
  duration: 6,
  files: [
    {
      path: "my-block.html",
      target: "compositions/my-block.html",
      type: "hyperframes:composition",
    },
  ],
};

const dirs: string[] = [];
let server: StudioServer | undefined;

afterEach(() => {
  server?.watcher.close();
  server = undefined;
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A project behind a symlink whose hyperframes.json points at a stubbed registry; `fetched` logs every URL. */
function projectWithRegistry(): {
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
        const items = [{ name: "my-block", type: "hyperframes:block" }];
        const $schema = "https://hyperframes.heygen.com/schema/registry.json";
        return new Response(
          JSON.stringify({ $schema, name: "t", homepage: "https://example.com", items }),
        );
      }
      if (url.endsWith("/blocks/my-block/registry-item.json"))
        return new Response(JSON.stringify(BLOCK));
      if (url.endsWith("/blocks/my-block/my-block.html")) {
        return new Response('<div data-composition-id="my-block"></div>');
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

describe("Studio catalog install", () => {
  it("installs through add: honours the project's block folder and records the item", async () => {
    const { link, real } = projectWithRegistry();

    const result = await server!.adapter.installRegistryBlock!({
      project: { dir: link, id: "p", title: "p" },
      blockName: "my-block",
    } as never);

    expect(result.written).toEqual(["scenes/my-block.html"]);
    expect(result.block.name).toBe("my-block");
    expect(existsSync(join(real, "compositions/my-block.html"))).toBe(false);
    const config = JSON.parse(readFileSync(join(real, "hyperframes.json"), "utf-8"));
    expect(config.registryItems).toEqual([
      { name: "my-block", type: "hyperframes:block", target: "scenes/my-block.html" },
    ]);
  });

  it("lists the catalog from the registry install uses", async () => {
    const { registry, fetched } = projectWithRegistry();

    const items = await server!.adapter.listRegistryCatalog!();

    expect(items.map((item) => item.name)).toEqual(["my-block"]);
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.every((url) => url.startsWith(registry))).toBe(true);
  });
});
