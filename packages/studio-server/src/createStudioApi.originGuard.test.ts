// @vitest-environment node
// Node environment on purpose: the package default (happy-dom) implements
// the browser fetch spec, which drops forbidden request headers such as
// Origin and Sec-Fetch-Site when a Request is constructed. A test that
// simulates cross-origin browser traffic has to set exactly those headers,
// so it needs Node's fetch classes, which keep them.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "./createStudioApi";
import { previewAllowedHostsFromEnv, wildcardBindHostAllowed } from "./helpers/requestIdentity";
import { stubAdapter } from "./routes/stubAdapter.test-helpers";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createApp(): { app: ReturnType<typeof createStudioApi>; projectDir: string } {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-origin-guard-"));
  tempDirs.push(projectDir);
  return { app: createStudioApi(stubAdapter(projectDir)), projectDir };
}

const EVIL_ORIGIN = "http://evil.example:9999";

function createFile(
  app: ReturnType<typeof createStudioApi>,
  headers: Record<string, string>,
  name = "planted.html",
): Promise<Response> {
  // A real browser request always carries a Host header; app.request does
  // not derive one in this environment, so send it explicitly. That keeps
  // every case exercising the Origin comparison itself.
  return app.request(`http://localhost/projects/demo/files/${name}`, {
    method: "POST",
    headers: { Host: "localhost", ...headers },
    body: "<html>planted</html>",
  });
}

describe("createStudioApi cross-origin write guard", () => {
  it("rejects a cross-origin POST file create and writes nothing", async () => {
    const { app, projectDir } = createApp();
    const res = await createFile(app, { Origin: EVIL_ORIGIN, "Content-Type": "text/plain" });
    expect(res.status).toBe(403);
    expect(existsSync(join(projectDir, "planted.html"))).toBe(false);
  });

  it("rejects a cross-origin multipart upload", async () => {
    const { app, projectDir } = createApp();
    const form = new FormData();
    form.append("files", new File(["planted"], "planted.html", { type: "text/html" }));
    const res = await app.request("http://localhost/projects/demo/upload", {
      method: "POST",
      headers: { Host: "localhost", Origin: EVIL_ORIGIN },
      body: form,
    });
    expect(res.status).toBe(403);
    expect(existsSync(join(projectDir, "planted.html"))).toBe(false);
  });

  it("rejects a write whose Origin is the opaque literal null", async () => {
    const { app } = createApp();
    const res = await createFile(app, { Origin: "null", "Content-Type": "text/plain" });
    expect(res.status).toBe(403);
  });

  it("rejects a write marked cross-site by Fetch Metadata even without Origin", async () => {
    const { app } = createApp();
    const res = await createFile(app, { "Sec-Fetch-Site": "cross-site" });
    expect(res.status).toBe(403);
  });

  it("rejects a cross-origin PUT overwrite", async () => {
    const { app } = createApp();
    const res = await app.request("http://localhost/projects/demo/files/planted.html", {
      method: "PUT",
      headers: { Host: "localhost", Origin: EVIL_ORIGIN, "If-None-Match": "*" },
      body: "overwritten",
    });
    expect(res.status).toBe(403);
  });

  it("rejects a write from a DNS name pointing at loopback, even when Origin and Host match", async () => {
    // The attacker's page is served from a name that resolves to 127.0.0.1,
    // so its Origin and Host agree with each other and a guard that only
    // compares the pair lets it through. The shared predicate also requires
    // the Host to be an identity this server answers to, and
    // "rebind.example" is not one, whatever it resolves to.
    const { app, projectDir } = createApp();
    const res = await createFile(app, {
      Host: "rebind.example:9999",
      Origin: "http://rebind.example:9999",
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "text/plain",
    });
    expect(res.status).toBe(403);
    expect(existsSync(join(projectDir, "planted.html"))).toBe(false);
  });

  it("rejects a write with no Origin when the Host is a DNS name, not a server identity", async () => {
    const { app, projectDir } = createApp();
    const res = await createFile(app, { Host: "rebind.example:9999" });
    expect(res.status).toBe(403);
    expect(existsSync(join(projectDir, "planted.html"))).toBe(false);
  });

  it("rejects a same-site write even when Origin and Host match", async () => {
    const { app } = createApp();
    const res = await createFile(app, {
      Origin: "http://localhost",
      "Sec-Fetch-Site": "same-site",
      "Content-Type": "text/plain",
    });
    expect(res.status).toBe(403);
  });

  it("allows a same-origin write (Origin host matches Host)", async () => {
    const { app, projectDir } = createApp();
    const res = await createFile(app, {
      Origin: "http://localhost",
      "Content-Type": "text/plain",
    });
    expect(res.status).toBe(201);
    expect(existsSync(join(projectDir, "planted.html"))).toBe(true);
  });

  it("allows a write with no Origin header (non-browser callers)", async () => {
    const { app, projectDir } = createApp();
    const res = await createFile(app, { "Content-Type": "text/plain" });
    expect(res.status).toBe(201);
    expect(existsSync(join(projectDir, "planted.html"))).toBe(true);
  });

  it("does not block reads from any origin", async () => {
    const { app } = createApp();
    await createFile(app, { "Content-Type": "text/plain" });
    const res = await app.request("http://localhost/projects/demo/files/planted.html", {
      headers: { Origin: EVIL_ORIGIN },
    });
    expect(res.status).toBe(200);
  });

  it("allows an HTTPS same-origin write", async () => {
    const { app, projectDir } = createApp();
    const res = await app.request("https://localhost:3002/projects/demo/files/planted.html", {
      method: "POST",
      headers: {
        Host: "localhost:3002",
        Origin: "https://localhost:3002",
        "Content-Type": "text/plain",
      },
      body: "<html>planted</html>",
    });
    expect(res.status).toBe(201);
    expect(existsSync(join(projectDir, "planted.html"))).toBe(true);
  });

  it("allows an HTTPS write behind a TLS proxy that forwards the proto", async () => {
    const { app, projectDir } = createApp();
    const res = await app.request("http://localhost:3002/projects/demo/files/planted.html", {
      method: "POST",
      headers: {
        Host: "localhost:3002",
        Origin: "https://localhost:3002",
        "X-Forwarded-Proto": "https",
        "Content-Type": "text/plain",
      },
      body: "<html>planted</html>",
    });
    expect(res.status).toBe(201);
    expect(existsSync(join(projectDir, "planted.html"))).toBe(true);
  });

  it("rejects an HTTPS Origin on a request that arrived over plain HTTP", async () => {
    const { app, projectDir } = createApp();
    const res = await app.request("http://localhost:3002/projects/demo/files/planted.html", {
      method: "POST",
      headers: {
        Host: "localhost:3002",
        Origin: "https://localhost:3002",
        "Content-Type": "text/plain",
      },
      body: "<html>planted</html>",
    });
    expect(res.status).toBe(403);
    expect(existsSync(join(projectDir, "planted.html"))).toBe(false);
  });

  it("allows a write on a host named in the allowedHosts option", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-origin-guard-"));
    tempDirs.push(projectDir);
    const app = createStudioApi(stubAdapter(projectDir), {
      allowedHosts: ["studio.example.com"],
    });
    const res = await app.request("http://studio.example.com/projects/demo/files/planted.html", {
      method: "POST",
      headers: {
        Host: "studio.example.com",
        Origin: "https://studio.example.com",
        "X-Forwarded-Proto": "https",
        "Content-Type": "text/plain",
      },
      body: "<html>planted</html>",
    });
    expect(res.status).toBe(201);
    expect(existsSync(join(projectDir, "planted.html"))).toBe(true);
  });

  it("rejects a write on that host without the allowedHosts option", async () => {
    const { app, projectDir } = createApp();
    const res = await app.request("http://studio.example.com/projects/demo/files/planted.html", {
      method: "POST",
      headers: {
        Host: "studio.example.com",
        Origin: "https://studio.example.com",
        "X-Forwarded-Proto": "https",
        "Content-Type": "text/plain",
      },
      body: "<html>planted</html>",
    });
    expect(res.status).toBe(403);
    expect(existsSync(join(projectDir, "planted.html"))).toBe(false);
  });

  it("names the refused host and the allowing env var in a refused write", async () => {
    const { app, projectDir } = createApp();
    const res = await createFile(app, {
      Host: "rebind.example:9999",
      Origin: "http://rebind.example:9999",
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "text/plain",
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("rebind.example:9999");
    expect(body.error).toContain("HYPERFRAMES_PREVIEW_ALLOWED_HOSTS");
    expect(existsSync(join(projectDir, "planted.html"))).toBe(false);
  });

  it("rejects a forged X-Forwarded-Host whose Origin does not match it", async () => {
    // The Host check alone would pass: the forwarded host names loopback.
    // The Origin comparison is what stops it, since the page's real origin
    // is the rebinding name, not the forwarded one.
    const { app, projectDir } = createApp();
    const res = await createFile(app, {
      Host: "rebind.example:9999",
      Origin: "http://rebind.example:9999",
      "X-Forwarded-Host": "localhost",
      "Content-Type": "text/plain",
    });
    expect(res.status).toBe(403);
    expect(existsSync(join(projectDir, "planted.html"))).toBe(false);
  });

  it("allows a write through a tunnel that rewrites Host and forwards its own", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-origin-guard-"));
    tempDirs.push(projectDir);
    const app = createStudioApi(stubAdapter(projectDir), {
      allowedHosts: ["demo.tunnels.example"],
    });
    const res = await app.request("http://localhost/projects/demo/files/planted.html", {
      method: "POST",
      headers: {
        Host: "localhost",
        Origin: "https://demo.tunnels.example",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "demo.tunnels.example",
        "Content-Type": "text/plain",
      },
      body: "<html>planted</html>",
    });
    expect(res.status).toBe(201);
    expect(existsSync(join(projectDir, "planted.html"))).toBe(true);
  });
});

describe("createStudioApi media analysis from another site", () => {
  it.each([
    ["waveform", "cross-site"],
    ["waveform", "same-site"],
    ["peaks", "cross-site"],
    ["peaks", "same-site"],
    ["pcm", "cross-site"],
    ["pcm", "same-site"],
  ])("refuses a %s request marked %s", async (route, site) => {
    const { app } = createApp();
    const res = await app.request(`http://localhost/projects/demo/${route}/talk.mp4`, {
      headers: { Host: "localhost", "Sec-Fetch-Site": site },
    });
    expect(res.status).toBe(403);
  });

  it.each([
    ["waveform", "same-origin"],
    ["peaks", "none"],
  ])("answers a %s request marked %s", async (route, site) => {
    const { app } = createApp();
    const res = await app.request(`http://localhost/projects/demo/${route}/talk.mp4`, {
      headers: { Host: "localhost", "Sec-Fetch-Site": site },
    });
    expect(res.status).toBe(404);
  });
});

describe("createStudioApi work-starting reads from another site", () => {
  function appCountingWork() {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-origin-work-"));
    tempDirs.push(projectDir);
    const calls = { lint: 0 };
    const app = createStudioApi({
      ...stubAdapter(projectDir),
      lintProject: () => {
        calls.lint++;
        return { results: [] };
      },
    });
    return { app, calls };
  }

  it.each([
    ["lint", "cross-site"],
    ["lint", "same-site"],
    ["media/metadata?path=talk.mp4", "cross-site"],
    ["image-thumbnail/photo.jpg", "cross-site"],
  ])("refuses %s marked %s without starting any work", async (route, site) => {
    const { app, calls } = appCountingWork();
    const res = await app.request(`http://localhost/projects/demo/${route}`, {
      headers: { Host: "localhost", "Sec-Fetch-Site": site },
    });
    expect(res.status).toBe(403);
    expect(calls.lint).toBe(0);
  });

  it("answers Studio's own lint request", async () => {
    const { app, calls } = appCountingWork();
    const res = await app.request("http://localhost/projects/demo/lint", {
      headers: { Host: "localhost", "Sec-Fetch-Site": "same-origin" },
    });
    expect(res.status).toBe(200);
    expect(calls.lint).toBe(1);
  });
});

describe("previewAllowedHostsFromEnv", () => {
  it("parses a comma separated list, trimming blanks", () => {
    expect(
      previewAllowedHostsFromEnv({
        HYPERFRAMES_PREVIEW_ALLOWED_HOSTS: " demo.tunnels.example ,, studio.example.com ",
      }),
    ).toEqual(["demo.tunnels.example", "studio.example.com"]);
  });

  it("is empty when the variable is unset or blank", () => {
    expect(previewAllowedHostsFromEnv({})).toEqual([]);
    expect(previewAllowedHostsFromEnv({ HYPERFRAMES_PREVIEW_ALLOWED_HOSTS: "  " })).toEqual([]);
  });
});

describe("wildcardBindHostAllowed", () => {
  it("allows loopback names and this machine's interface addresses", () => {
    expect(wildcardBindHostAllowed("localhost:3003")).toBe(true);
    expect(wildcardBindHostAllowed("127.0.0.1")).toBe(true);
    const address = Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .find((entry) => entry.family === "IPv4")?.address;
    if (address) expect(wildcardBindHostAllowed(`${address}:3003`)).toBe(true);
  });

  it("refuses other names unless they are listed", () => {
    expect(wildcardBindHostAllowed("rebound.example:3003")).toBe(false);
    expect(wildcardBindHostAllowed("")).toBe(false);
    expect(wildcardBindHostAllowed(undefined)).toBe(false);
    expect(wildcardBindHostAllowed("demo.tunnels.example", ["demo.tunnels.example"])).toBe(true);
  });

  it("ignores the preview bind setting", () => {
    const saved = process.env["HYPERFRAMES_PREVIEW_HOST"];
    process.env["HYPERFRAMES_PREVIEW_HOST"] = "rebound.example";
    try {
      expect(wildcardBindHostAllowed("rebound.example")).toBe(false);
    } finally {
      if (saved === undefined) delete process.env["HYPERFRAMES_PREVIEW_HOST"];
      else process.env["HYPERFRAMES_PREVIEW_HOST"] = saved;
    }
  });
});
