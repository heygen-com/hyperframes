import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPresentApp } from "./present.js";

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
