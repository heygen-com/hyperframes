import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Inspector } from "../src/service";

const pages = vi.hoisted(() => [] as string[]);

vi.mock("puppeteer-core", () => ({
  default: {
    launch: async () => ({
      close: async () => {},
      newPage: async () => ({
        setViewport: async () => {},
        goto: async (url: string) => {
          pages.push(url);
          await fetch(url);
        },
        waitForFunction: async () => {},
        evaluate: async () => {},
        content: async () => "",
        close: async () => {},
      }),
    }),
  },
}));

function statusFor(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    request(url, { headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    })
      .on("error", reject)
      .end();
  });
}

it("serves the preview page to its own browser and refuses a foreign Host", async () => {
  const project = mkdtempSync(join(tmpdir(), "inspect-preview-host-"));
  writeFileSync(
    join(project, "index.html"),
    '<!doctype html><html><head></head><body><main data-composition-id="root" data-duration="1" data-width="320" data-height="180"></main></body></html>',
  );
  writeFileSync(join(project, "notes.txt"), "project file");
  const inspector = new Inspector(project, {
    executablePath: "browser-stand-in",
    instrument: false,
  });
  try {
    await inspector.withPage(async () => {});
    const origin = new URL(pages.at(-1)!).origin;
    const port = new URL(origin).port;

    expect(await statusFor(`${origin}/`, `127.0.0.1:${port}`)).toBe(200);
    expect(await statusFor(`${origin}/notes.txt`, `localhost:${port}`)).toBe(200);
    for (const path of ["/", "/__hf-runtime.js", "/notes.txt"]) {
      expect(await statusFor(`${origin}${path}`, `attacker.example:${port}`)).toBe(403);
    }
  } finally {
    await inspector.dispose();
    rmSync(project, { recursive: true, force: true });
  }
});
