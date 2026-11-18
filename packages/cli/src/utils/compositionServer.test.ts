import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import {
  buildRangeResponse,
  refuseUnknownHosts,
  sandboxForAnotherSite,
  scriptsAfterWorkersDropped,
} from "./compositionServer.js";

const TAGGED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAABGNJQ1ABAQABlXPCVgAAAAxJREFUeJxj0NfXBwABHgCOTp25kgAAAABJRU5ErkJggg==",
  "base64",
);

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("buildRangeResponse colour-tagged PNGs", () => {
  it("serves a BT.709-tagged PNG without the tag, so play and present show the file's values", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-composition-server-"));
    const file = join(dir, "tagged.png");
    writeFileSync(file, TAGGED_PNG);

    const res = buildRangeResponse(file, "image/png", undefined);
    const body = Buffer.from(await res.arrayBuffer());

    expect(body.includes("cICP")).toBe(false);
    expect(body.includes("IDAT")).toBe(true);
    expect(res.headers.get("content-length")).toBe(String(body.length));
  });
});

describe("refuseUnknownHosts", () => {
  const ENV = "HYPERFRAMES_PREVIEW_ALLOWED_HOSTS";

  afterEach(() => {
    delete process.env[ENV];
  });

  function guardedApp(): Hono {
    const app = new Hono();
    refuseUnknownHosts(app);
    app.get("/composition/*", (c) => c.text("project file"));
    return app;
  }

  function get(app: Hono, host: string): Promise<Response> {
    return Promise.resolve(app.request("/composition/package.json", { headers: { host } }));
  }

  function lanAddress(): string | undefined {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family === "IPv4" && !entry.internal) return entry.address;
      }
    }
    return undefined;
  }

  it("answers localhost and loopback addresses", async () => {
    const app = guardedApp();
    for (const host of ["localhost:3003", "127.0.0.1:3003", "[::1]:3003"]) {
      expect((await get(app, host)).status, host).toBe(200);
    }
  });

  it("answers this machine's LAN address and .local name, so another device can open it", async () => {
    const app = guardedApp();
    const lan = lanAddress();
    if (lan) expect((await get(app, `${lan}:3003`)).status).toBe(200);
    const short = hostname().toLowerCase().split(".")[0];
    if (short) expect((await get(app, `${short}.local:3003`)).status).toBe(200);
  });

  it("refuses any other host name and names the setting that allows it", async () => {
    const res = await get(guardedApp(), "rebound.example:3003");
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toContain("project file");
    expect(text).toContain(`${ENV}=rebound.example:3003`);
  });

  it("answers a host named in HYPERFRAMES_PREVIEW_ALLOWED_HOSTS", async () => {
    process.env[ENV] = "other.example, demo.tunnels.example";
    const res = await get(guardedApp(), "demo.tunnels.example");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("project file");
  });
});

describe("scriptsAfterWorkersDropped", () => {
  it("adds the page's scripts in order only after every worker on the origin is unregistered", async () => {
    const steps: string[] = [];
    const registrations = [{ unregister: async () => void steps.push("unregister") }];
    const navigator = { serviceWorker: { getRegistrations: async () => registrations } };
    const head = { append: (s: { src: string }) => void steps.push(`load ${s.src}`) };
    const document = { head, createElement: () => ({ src: "", async: true }) };
    const html = scriptsAfterWorkersDropped(["/player.js", "/slideshow.js"]);
    const script = html.slice("<script>".length, -"</script>".length);
    await new Function("navigator", "document", `return ${script.replace(/;$/, "")}`)(
      navigator,
      document,
    );
    expect(steps).toEqual(["unregister", "load /player.js", "load /slideshow.js"]);
  });

  it("keeps a source that holds a closing tag inside its one script", () => {
    const html = scriptsAfterWorkersDropped(["/a</script><b>.js"]);
    expect(html.indexOf("</script>")).toBe(html.length - "</script>".length);
  });
});

describe("sandboxForAnotherSite", () => {
  it("refuses a file under its path as a service worker's script, and serves it otherwise", async () => {
    const app = new Hono();
    sandboxForAnotherSite(app, "/composition/*");
    app.get("/composition/*", (c) => c.text("self.onfetch = () => {};"));
    const get = (headers: Record<string, string>) =>
      app.request("/composition/worker.js", {
        headers: { "sec-fetch-site": "same-origin", ...headers },
      });
    expect((await get({ "service-worker": "script" })).status).toBe(403);
    expect((await get({ "sec-fetch-dest": "serviceworker" })).status).toBe(403);
    expect((await get({ "sec-fetch-dest": "script" })).status).toBe(200);
  });
});
