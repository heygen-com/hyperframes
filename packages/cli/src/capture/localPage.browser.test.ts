import { createServer, type IncomingMessage, type RequestOptions } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ port: 0, hits: [] as string[], dialed: [] as string[] }));
vi.mock("node:dns", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns")>();
  return {
    ...real,
    promises: {
      ...real.promises,
      Resolver: class {
        async resolve4(host: string) {
          if (host === "capture-fixture.example.com") return ["93.184.216.34"];
          throw new Error("Fixture has no such DNS name");
        }
        cancel() {}
      },
    },
  };
});
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    execFile: (...args: Parameters<typeof real.execFile>) => {
      if (!(args[1] as string[] | undefined)?.includes("-e")) return real.execFile(...args);
      const callback = args.at(-1) as (error: Error, stdout: string, stderr: string) => void;
      callback(new Error("Fixture has no system DNS"), "", "ENOTFOUND");
      return { once() {}, kill() {} } as unknown as ReturnType<typeof real.execFile>;
    },
  };
});
vi.mock("node:http", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:http")>();
  return {
    ...original,
    request(options: RequestOptions, listener?: (response: IncomingMessage) => void) {
      if (options.hostname === "93.184.216.34") {
        fixture.dialed.push(String(options.path));
        options = { ...options, hostname: "127.0.0.1" };
      }
      return original.request(options, listener);
    },
  };
});
import { launchCaptureBrowser } from "./launchCaptureBrowser.js";
import { resolveLocalCaptureTarget, startLocalPageServer } from "./localPage.js";

const chrome = process.env.HYPERFRAMES_TEST_BROWSER_PATH;
describe.skipIf(!chrome || !existsSync(chrome))("real browser local page capture", () => {
  const remote = createServer((req, res) => {
    fixture.hits.push(req.url ?? "");
    res.end("remote");
  });
  let base: string;
  let local: Awaited<ReturnType<typeof startLocalPageServer>>;
  let capture: Awaited<ReturnType<typeof launchCaptureBrowser>>;

  beforeAll(async () => {
    await new Promise<void>((resolve) => remote.listen(0, "127.0.0.1", resolve));
    fixture.port = (remote.address() as { port: number }).port;
    base = realpathSync.native(mkdtempSync(join(tmpdir(), "hf-local-browser-")));
    const site = join(base, "site");
    mkdirSync(site);
    writeFileSync(join(base, "secret.png"), "outside");
    symlinkSync(join(base, "secret.png"), join(site, "link.png"));
    writeFileSync(join(site, "logo.png"), "logo");
    writeFileSync(join(site, "font.woff2"), "font");
    writeFileSync(
      join(site, "style.css"),
      `@font-face { font-family: LocalFixture; src: url(font.woff2); } body { font-family: LocalFixture; }`,
    );
    const remoteOrigin = `http://capture-fixture.example.com:${fixture.port}`;
    writeFileSync(
      join(site, "index.html"),
      `<html><head><link rel="stylesheet" href="style.css"></head><body>local fixture
<img src="logo.png"><img src="../secret.png"><img src="link.png">
<img src="${pathToFileURL(join(base, "secret.png")).href}">
<img src="${remoteOrigin}/remote.png">
<img src="http://127.0.0.1:${fixture.port}/private.png"></body></html>`,
    );
    local = await startLocalPageServer(resolveLocalCaptureTarget(site));
    capture = await launchCaptureBrowser({
      executablePath: chrome!,
      protocolTimeout: 15_000,
      disableWebgl: true,
      width: 800,
      height: 600,
      localOrigin: local.origin,
    });
  }, 20_000);

  afterAll(async () => {
    await capture?.close();
    await local?.close();
    remote.closeAllConnections();
    await new Promise<void>((resolve) => remote.close(() => resolve()));
    rmSync(base, { recursive: true, force: true });
  });

  it("loads local files inside the root, refuses the rest and proxies remote ones", async () => {
    const page = await capture.browser.newPage();
    const statuses = new Map<string, number>();
    page.on("response", (response) => statuses.set(response.url(), response.status()));
    try {
      await page.goto(local.url, { waitUntil: "networkidle0", timeout: 10_000 });
      expect(await page.$eval("body", (body) => body.textContent)).toContain("local fixture");
      await page.evaluate(() => document.fonts.ready);

      expect(statuses.get(`${local.origin}/logo.png`)).toBe(200);
      expect(statuses.get(`${local.origin}/style.css`)).toBe(200);
      expect(statuses.get(`${local.origin}/font.woff2`)).toBe(200);
      expect(statuses.get(`${local.origin}/secret.png`)).toBe(404);
      expect(statuses.get(`${local.origin}/link.png`)).toBe(404);
      expect([...statuses.keys()].some((url) => url.startsWith("file:"))).toBe(false);

      expect(fixture.dialed).toContain("/remote.png");
      expect(fixture.hits).toEqual(["/remote.png"]);
    } finally {
      await page.close();
    }
  }, 20_000);
});
