import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { get as httpGet } from "node:http";
import { createFileServer } from "./fileServer.js";

describe("file server media responses", () => {
  it.each([
    ["avif", "image/avif"],
    ["flac", "audio/flac"],
    ["M4A", "audio/mp4"],
    ["mov", "video/quicktime"],
    ["ico", "image/vnd.microsoft.icon"],
  ])("serves .%s with its content type and unchanged bytes", async (ext, type) => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-engine-media-type-"));
    const bytes = new Uint8Array([0, 255, 128, 64, 32]);
    try {
      writeFileSync(join(projectDir, `asset.${ext}`), bytes);
      const server = await createFileServer({ projectDir });
      try {
        const response = await fetch(`${server.url}/asset.${ext}`);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe(type);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      } finally {
        server.close();
      }
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

function firstExternalIpv4(): string | undefined {
  return Object.values(networkInterfaces())
    .flat()
    .find((address) => address?.family === "IPv4" && !address.internal)?.address;
}

describe("file server listener", () => {
  it("answers on loopback and not on another interface", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-engine-bind-"));
    try {
      writeFileSync(join(projectDir, "index.html"), "<html></html>");
      const server = await createFileServer({ projectDir });
      try {
        expect((await fetch(`${server.url}/index.html`)).status).toBe(200);
        expect((await fetch(`http://127.0.0.1:${server.port}/index.html`)).status).toBe(200);
        const external = firstExternalIpv4();
        if (external) {
          const remote = fetch(`http://${external}:${server.port}/index.html`, {
            signal: AbortSignal.timeout(1_000),
          });
          await expect(remote).rejects.toThrow();
        }
      } finally {
        server.close();
      }
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

function getWithHost(url: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolveGet, rejectGet) => {
    httpGet(url, { headers: { host } }, (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolveGet({ status: res.statusCode ?? 0, body }));
    }).on("error", rejectGet);
  });
}

async function withProject(
  options: { hostname?: string },
  run: (server: Awaited<ReturnType<typeof createFileServer>>) => Promise<void>,
): Promise<void> {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-engine-host-"));
  try {
    writeFileSync(
      join(projectDir, "index.html"),
      "<html><head></head><body>composition</body></html>",
    );
    writeFileSync(join(projectDir, "scene.html"), "<html><head></head><body>scene</body></html>");
    writeFileSync(join(projectDir, "asset.txt"), "project-file");
    const server = await createFileServer({ projectDir, ...options });
    try {
      await run(server);
    } finally {
      server.close();
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

describe("file server request Host", () => {
  it.each(["/", "/index.html", "/asset.txt"])(
    "refuses %s to a page name that is not loopback",
    async (path) => {
      await withProject({}, async (server) => {
        const res = await getWithHost(`${server.url}${path}`, `rebound.example:${server.port}`);
        expect(res.status).toBe(403);
        expect(res.body).not.toContain("composition");
        expect(res.body).not.toContain("project-file");
      });
    },
  );

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "answers the capture browser on %s",
    async (name) => {
      await withProject({}, async (server) => {
        const res = await getWithHost(`${server.url}/asset.txt`, `${name}:${server.port}`);
        expect(res.status).toBe(200);
        expect(res.body).toBe("project-file");
      });
    },
  );

  it("answers the hostname it was bound to and still refuses other names", async () => {
    const external = firstExternalIpv4();
    if (!external) return;
    await withProject({ hostname: external }, async (server) => {
      const own = await fetch(`http://${external}:${server.port}/asset.txt`);
      expect(await own.text()).toBe("project-file");
      const rebound = await getWithHost(
        `http://${external}:${server.port}/asset.txt`,
        `rebound.example:${server.port}`,
      );
      expect(rebound.status).toBe(403);
    });
  });

  it("answers this machine's own address on a wildcard bind and refuses other names", async () => {
    const external = firstExternalIpv4();
    if (!external) return;
    await withProject({ hostname: "0.0.0.0" }, async (server) => {
      const own = await fetch(`http://${external}:${server.port}/asset.txt`);
      expect(await own.text()).toBe("project-file");
      const rebound = await getWithHost(
        `${server.url}/asset.txt`,
        `rebound.example:${server.port}`,
      );
      expect(rebound.status).toBe(403);
    });
  });
});

describe("file server page editing agent", () => {
  it.each(["index.html", "scene.html"])(
    "marks %s so its runtime offers a framing site no editing port",
    async (name) => {
      await withProject({}, async (server) => {
        const res = await fetch(`${server.url}/${name}`);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('<meta name="hyperframes-preview-for-another-site">');
      });
    },
  );
});

describe("file server IPv6 wildcard bind", () => {
  it("answers loopback and refuses other names when bound to ::", async () => {
    await withProject({ hostname: "::" }, async (server) => {
      expect((await getWithHost(`${server.url}/asset.txt`, `[::1]:${server.port}`)).status).toBe(
        200,
      );
      const rebound = await getWithHost(
        `${server.url}/asset.txt`,
        `rebound.example:${server.port}`,
      );
      expect(rebound.status).toBe(403);
    });
  });
});

it("loads the authored dot-font from the project even with a compiled overlay", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-render-font-"));
  const compiledDir = mkdtempSync(join(tmpdir(), "hf-compiled-font-"));
  try {
    writeFileSync(
      join(projectDir, "index.html"),
      '<link rel="preload" as="font" href=".My%20Font.woff2">',
    );
    writeFileSync(join(projectDir, ".My Font.woff2"), "authored font");
    writeFileSync(join(compiledDir, ".My Font.woff2"), "different file");
    const server = await createFileServer({ projectDir, compiledDir });
    try {
      const response = await fetch(server.url + "/.My%20Font.woff2");
      expect(response.headers.get("content-type")).toBe("font/woff2");
      expect(await response.text()).toBe("authored font");
      writeFileSync(join(projectDir, "index.html"), "<html></html>");
      expect((await fetch(server.url + "/.My%20Font.woff2")).status).toBe(404);
    } finally {
      server.close();
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(compiledDir, { recursive: true, force: true });
  }
});
