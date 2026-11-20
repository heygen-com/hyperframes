import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "citty";
import { consumeCommandResult } from "../utils/commandResult.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INERT_REFUSAL_HEADERS } from "../utils/strayRequestRefusal.js";

vi.mock("@hono/node-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hono/node-server")>()),
  createAdaptorServer: () => ({}),
}));
vi.mock("../utils/compositionServer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/compositionServer.js")>()),
  resolvePlayerPath: () => "/unused-player.js",
  resolveSlideshowPath: () => "/unused-slideshow.js",
  listenOnFreePort: async () => 3004,
}));

const { default: present, buildPresentApp } = await import("./present.js");

const MARK = '<meta name="hyperframes-preview-for-another-site">';
const SANDBOX = "sandbox allow-scripts";
const FRAME_ANCESTORS = "frame-ancestors 'self'";

let dir: string | undefined;

afterEach(() => {
  vi.unstubAllEnvs();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function presentApp() {
  dir = mkdtempSync(join(tmpdir(), "hf-present-test-"));
  writeFileSync(join(dir, "index.html"), "<html><head></head><body></body></html>");
  return buildPresentApp({ dir, name: "deck", indexPath: join(dir, "index.html") }, "{}", {
    playerPath: join(dir, "player.js"),
    slideshowPath: join(dir, "slideshow.js"),
  });
}

describe("a deck document another site loads", () => {
  it("is marked and sandboxed when another site frames it", async () => {
    const app = await presentApp();
    const res = await app.request("/composition/index.html", {
      headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Dest": "iframe" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(MARK);
    expect(res.headers.get("Content-Security-Policy")).toBe(`${SANDBOX}, ${FRAME_ANCESTORS}`);
  });

  it("stays unmarked for the presenter page's own player", async () => {
    const app = await presentApp();
    const res = await app.request("/composition/index.html", {
      headers: { "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Dest": "iframe" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(MARK);
    expect(res.headers.get("Content-Security-Policy")).toBe(FRAME_ANCESTORS);
  });

  it("is marked on a named host with no fetch metadata unless the presenter page sent it", async () => {
    vi.stubEnv("HYPERFRAMES_PREVIEW_ALLOWED_HOSTS", "deck.example");
    const app = await presentApp();
    const origin = "http://deck.example:3004";
    const foreign = await app.request(`${origin}/composition/index.html`);
    expect(await foreign.text()).toContain(MARK);
    const own = await app.request(`${origin}/composition/index.html`, {
      headers: { Referer: `${origin}/` },
    });
    expect(await own.text()).not.toContain(MARK);
  });
});

describe("pages the present server answers", () => {
  it.each(["/", "/composition/index.html"])(
    "may be framed only by its own pages: %s",
    async (path) => {
      const app = await presentApp();
      const res = await app.request(path, { headers: { "Sec-Fetch-Site": "same-origin" } });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Security-Policy")).toBe(FRAME_ANCESTORS);
      expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    },
  );
});

// Windows refuses control characters in folder names.
it.skipIf(process.platform === "win32")(
  "prints a folder name with control characters as visible escapes",
  async () => {
    // Built rather than written: a literal control character in the source is a lint error.
    const esc = String.fromCharCode(27);
    dir = mkdtempSync(join(tmpdir(), "hf-present-test-"));
    const project = join(dir, `deck${esc}]0;x${String.fromCharCode(7)}${esc}[2J`);
    mkdirSync(project);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      writeFileSync(
        join(project, "index.html"),
        '<script type="application/hyperframes-slideshow+json">{}</script>',
      );
      void runCommand(present, { rawArgs: [project, "--no-open"] });
      await vi.waitFor(() => expect(log.mock.calls.flat().join("\n")).toContain("Deck"));
      const human = log.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(human.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "")).not.toContain(esc);
      expect(human).toContain("deck\\x1b]0;x\\x07\\x1b[2J");
    } finally {
      log.mockRestore();
    }
  },
);

// Windows refuses control characters in folder names.
it.skipIf(process.platform === "win32")(
  "prints an invalid slideshow island error with control characters as visible escapes",
  async () => {
    const { log } = await import("@clack/prompts");
    // Built rather than written: a literal control character in the source is a lint error.
    const esc = String.fromCharCode(27);
    dir = mkdtempSync(join(tmpdir(), "hf-present-test-"));
    const project = join(dir, `deck${esc}[2J`);
    mkdirSync(project);
    writeFileSync(
      join(project, "index.html"),
      '<script type="application/hyperframes-slideshow+json">{"a":</script>',
    );
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    try {
      await runCommand(present, { rawArgs: [project, "--no-open"] });
      const printed = error.mock.calls.map((call) => call.join(" ")).join("\n");

      expect(printed).toContain("is not valid JSON");
      expect(printed).not.toContain(esc);
      expect(printed).toContain("deck\\x1b[2J");
    } finally {
      error.mockRestore();
      consumeCommandResult();
    }
  },
);
describe("a request the present server has no page for", () => {
  it.each([
    "/oauth/callback?code=c0de&state=st4te",
    "/callback?code=c0de&state=st4te",
    "/?code=c0de&state=st4te",
    "/?mode=audience&state=st4te",
    "/composition/index.html?code=c0de",
    "/no-such-page",
    "/composition/missing.html",
  ])("gets an inert plain-text refusal: %s", async (path) => {
    const app = await presentApp();
    const res = await app.request(path, { headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(res.status).toBe(404);
    expect(Object.fromEntries(res.headers)).toEqual(
      Object.fromEntries(
        Object.entries(INERT_REFUSAL_HEADERS).map(([name, value]) => [name.toLowerCase(), value]),
      ),
    );
    expect(await res.text()).toBe("Not found");
  });

  it("leaves the presenter and audience pages as they were", async () => {
    const app = await presentApp();
    for (const path of ["/", "/?mode=audience"]) {
      const res = await app.request(path, { headers: { "Sec-Fetch-Site": "same-origin" } });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toMatch(/^text\/html/);
    }
  });
});
