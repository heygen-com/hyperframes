import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { HYPERFRAMES_BROWSER_MARKER_ARG } from "../../core/src/browserMarker";
import { Inspector } from "../src/service";

const launches = vi.hoisted(() => [] as { args?: string[] }[]);

vi.mock("puppeteer-core", () => ({
  default: {
    launch: async (options: { args?: string[] }) => {
      launches.push(options);
      return {
        close: async () => {},
        newPage: async () => {
          let html = "";
          return {
            setViewport: async () => {},
            goto: async (url: string) => {
              html = await (await fetch(url)).text();
            },
            waitForFunction: async () => {},
            evaluate: async () => {},
            content: async () => html,
            close: async () => {},
          };
        },
      };
    },
  },
}));

it("reloads the standalone page when an HF ID is stamped onto disk", async () => {
  const project = mkdtempSync(join(tmpdir(), "inspect-stamp-"));
  const path = join(project, "index.html");
  const source =
    '<!doctype html><html><head></head><body><main data-composition-id="root" data-duration="10" data-width="1920" data-height="1080"><div id="target">Title</div></main></body></html>';
  writeFileSync(path, source);
  const inspector = new Inspector(project, {
    executablePath: "browser-stand-in",
    instrument: false,
  });
  try {
    const first = await inspector.withPage((page) => page.content());
    expect(first).toContain('id="target"');
    expect(first).not.toContain('data-hf-id="hf-t1"');
    expect(await inspector.withPage((page) => page.content())).toBe(first);
    expect(inspector.stats.pageLoads).toBe(1);
    writeFileSync(path, source.replace('id="target"', 'id="target" data-hf-id="hf-t1"'));
    const stamped = await inspector.withPage((page) => page.content());
    expect(stamped).toContain('data-hf-id="hf-t1"');
    expect(inspector.stats.pageLoads).toBe(2);
  } finally {
    await inspector.dispose();
    rmSync(project, { recursive: true, force: true });
  }
});

it("launches its browser with the HyperFrames marker", async () => {
  const project = mkdtempSync(join(tmpdir(), "inspect-marker-"));
  writeFileSync(
    join(project, "index.html"),
    '<!doctype html><html><body><main data-composition-id="root" data-duration="1" data-width="64" data-height="64"></main></body></html>',
  );
  const inspector = new Inspector(project, {
    executablePath: "browser-stand-in",
    instrument: false,
  });
  try {
    launches.length = 0;
    await inspector.withPage((page) => page.content());
    expect(launches).toHaveLength(1);
    expect(launches[0]!.args).toContain(HYPERFRAMES_BROWSER_MARKER_ARG);
  } finally {
    await inspector.dispose();
    rmSync(project, { recursive: true, force: true });
  }
});
