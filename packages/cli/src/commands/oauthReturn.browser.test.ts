import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdaptorServer } from "@hono/node-server";
import type { Hono } from "hono";
import puppeteer, { type Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureBrowser } from "../browser/manager.js";
import { buildPlayApp } from "./play.js";
import { buildPresentApp } from "./present.js";

// SECOPS-2642 part 3. HeyGen's sign-in returns a CLI code to any loopback port, and the play and
// present pages share their origin with the composition frame (`sandbox-origin="same-origin"`), so
// anything those pages can read, project script can read through `parent`. Each probe runs on the
// server's own page and tries to read a return address that landed on that server.

let browser: Browser;
let dir: string;
const servers: Server[] = [];

async function listen(server: Server, host: string): Promise<number> {
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, host, done));
  return (server.address() as AddressInfo).port;
}

/** Stands in for the authorize endpoint: another origin that always redirects to `returnTo`. */
async function redirector(returnTo: string): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(302, { Location: returnTo });
    res.end();
  });
  return `http://localhost:${await listen(server, "127.0.0.1")}/authorize`;
}

async function serve(app: Hono): Promise<string> {
  const server = createAdaptorServer({ fetch: app.fetch }) as Server;
  return `http://127.0.0.1:${await listen(server, "127.0.0.1")}`;
}

async function readReturnAddress(origin: string): Promise<Record<string, string>> {
  const back = `${origin}/oauth/callback?code=SECRET&state=s`;
  const viaAuthorize = await redirector(back);
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}/`);
    expect(await page.evaluate(() => location.origin)).toBe(origin);
    return await page.evaluate(
      async (back, viaAuthorize) => {
        const settle = () => new Promise((done) => setTimeout(done, 1000));
        const read = (w: Window | null) => {
          if (!w) return "no window";
          if (w.closed) return "severed";
          try {
            return w.location.href;
          } catch {
            return "unreadable";
          }
        };
        const framed = (src: string) => {
          const frame = document.createElement("iframe");
          frame.src = src;
          document.body.append(frame);
          return frame;
        };
        const frame = framed(back);
        const frameViaAuthorize = framed(viaAuthorize);
        const popup = open(back);
        const popupViaAuthorize = open(viaAuthorize);
        await settle();
        const seen = {
          frame: read(frame.contentWindow),
          frameViaAuthorize: read(frameViaAuthorize.contentWindow),
          popup: read(popup),
          popupViaAuthorize: read(popupViaAuthorize),
        };
        popup?.close();
        popupViaAuthorize?.close();
        return seen;
      },
      back,
      viaAuthorize,
    );
  } finally {
    // A popup the probe closed itself can still be listed for a moment.
    for (const other of await browser.pages()) await other.close().catch(() => undefined);
  }
}

beforeAll(async () => {
  const { executablePath } = await ensureBrowser();
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  dir = mkdtempSync(join(tmpdir(), "hf-oauth-return-"));
  writeFileSync(join(dir, "index.html"), "<html><head></head><body></body></html>");
  for (const bundle of ["player.js", "runtime.js", "slideshow.js"]) {
    writeFileSync(join(dir, bundle), "");
  }
}, 60_000);

afterAll(async () => {
  await browser?.close();
  for (const server of servers) server.close();
  rmSync(dir, { recursive: true, force: true });
});

// Fails without the fix: on main every probe reads `…/oauth/callback?code=SECRET&state=s`.
describe("an OAuth return that lands on the server's port", () => {
  // A blocked popup ("no window") would pass a looser check without proving anything.
  const unreadable = expect.stringMatching(/^(severed|unreadable)$/);
  const expected = {
    frame: unreadable,
    frameViaAuthorize: unreadable,
    popup: unreadable,
    popupViaAuthorize: unreadable,
  };
  const project = () => ({ dir, name: "deck", indexPath: join(dir, "index.html") });

  it("cannot be read from the play page", async () => {
    const origin = await serve(
      await buildPlayApp(project(), false, {
        playerPath: join(dir, "player.js"),
        runtimePath: join(dir, "runtime.js"),
      }),
    );
    expect(await readReturnAddress(origin)).toEqual(expected);
  }, 30_000);

  it("cannot be read from the present page", async () => {
    const origin = await serve(
      await buildPresentApp(project(), "{}", {
        playerPath: join(dir, "player.js"),
        slideshowPath: join(dir, "slideshow.js"),
      }),
    );
    expect(await readReturnAddress(origin)).toEqual(expected);
  }, 30_000);
});
