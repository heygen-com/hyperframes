import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Inspector } from "../src/service";

const pages = vi.hoisted(() => [] as string[]);

vi.mock("puppeteer-core", () => ({
  default: {
    launch: async () => ({
      close: async () => {},
      createBrowserContext: async () => ({
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
    }),
  },
}));

type Answer = { status: number; headers: IncomingHttpHeaders; body: string };

function answerFor(url: string, host: string, more: Record<string, string> = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    request(url, { headers: { host, ...more } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    })
      .on("error", reject)
      .end();
  });
}

const statusFor = async (url: string, host: string, more: Record<string, string> = {}) =>
  (await answerFor(url, host, more)).status;

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
    // fails without the fix: the inspected page could make a project file its origin's service worker.
    const own = `127.0.0.1:${port}`;
    expect(await statusFor(`${origin}/notes.txt`, own, { "service-worker": "script" })).toBe(403);
    expect(await statusFor(`${origin}/notes.txt`, own, { "sec-fetch-dest": "serviceworker" })).toBe(
      403,
    );
    for (const path of ["/", "/__hf-runtime.js", "/notes.txt"]) {
      expect(await statusFor(`${origin}${path}`, `attacker.example:${port}`)).toBe(403);
      expect(await statusFor(`${origin}${path}`, `127.0.0.1:${Number(port) + 1}`)).toBe(403);
      for (const site of ["cross-site", "same-site"])
        expect(await statusFor(`${origin}${path}`, own, { "sec-fetch-site": site }), site).toBe(
          403,
        );
      for (const site of ["same-origin", "none"])
        expect(await statusFor(`${origin}${path}`, own, { "sec-fetch-site": site }), site).toBe(
          200,
        );
    }
  } finally {
    await inspector.dispose();
    rmSync(project, { recursive: true, force: true });
  }
});

it("serves a page another site cannot frame, marked so its runtime talks only playback", async () => {
  const project = mkdtempSync(join(tmpdir(), "inspect-preview-frame-"));
  writeFileSync(
    join(project, "index.html"),
    '<!doctype html><html><head><script>window.first = 1;</script></head><body><main data-composition-id="root" data-duration="1" data-width="320" data-height="180"></main></body></html>',
  );
  writeFileSync(join(project, "notes.txt"), "project file");
  const inspector = new Inspector(project, {
    executablePath: "browser-stand-in",
    instrument: false,
  });
  try {
    await inspector.withPage(async () => {});
    const origin = new URL(pages.at(-1)!).origin;
    const own = `127.0.0.1:${new URL(origin).port}`;
    const root = await answerFor(`${origin}/`, own);
    expect(root.body).toMatch(/<head[^>]*>\s*<meta name="hyperframes-preview-for-another-site">/);
    for (const path of ["/", "/__hf-runtime.js", "/notes.txt"]) {
      const { headers } = await answerFor(`${origin}${path}`, own);
      expect(headers["content-security-policy"], path).toBe("frame-ancestors 'self'");
      expect(headers["x-frame-options"], path).toBe("SAMEORIGIN");
      expect(headers["cross-origin-resource-policy"], path).toBe("same-origin");
    }
  } finally {
    await inspector.dispose();
    rmSync(project, { recursive: true, force: true });
  }
});
