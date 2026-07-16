// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createFigmaClient, FigmaClientError, type FigmaFetch } from "./client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchStub(handler: (url: string) => Response): { fetch: FigmaFetch; calls: string[] } {
  const calls: string[] = [];
  const fetch: FigmaFetch = (url, init) => {
    calls.push(`${url}|${JSON.stringify(init?.headers ?? {})}`);
    return Promise.resolve(handler(url));
  };
  return { fetch, calls };
}

describe("createFigmaClient", () => {
  it("throws NO_TOKEN when token is missing or blank", () => {
    expect(() => createFigmaClient({ token: "" })).toThrowError(
      expect.objectContaining({ code: "NO_TOKEN" }),
    );
    expect(() => createFigmaClient({ token: "   " })).toThrowError(
      expect.objectContaining({ code: "NO_TOKEN" }),
    );
  });

  it("sends the token as X-Figma-Token on every request", async () => {
    const { fetch, calls } = fetchStub(() =>
      jsonResponse(200, { images: { "1:2": "https://cdn.example/a.png" } }),
    );
    const client = createFigmaClient({ token: "tok-1", fetch });
    await client.renderNode({ fileKey: "F", nodeId: "1:2" }, { format: "png" });
    expect(calls[0]).toContain('"X-Figma-Token":"tok-1"');
  });
});

describe("renderNode", () => {
  it("calls /v1/images/:key with ids/format/scale and returns the render url", async () => {
    const { fetch, calls } = fetchStub(() =>
      jsonResponse(200, { images: { "1:2": "https://cdn.example/a.png" } }),
    );
    const client = createFigmaClient({ token: "t", fetch });
    const out = await client.renderNode(
      { fileKey: "FILE", nodeId: "1:2" },
      { format: "png", scale: 2 },
    );
    expect(out.url).toBe("https://cdn.example/a.png");
    expect(out.ext).toBe("png");
    expect(calls[0]).toContain("/v1/images/FILE?ids=1%3A2&format=png&scale=2");
  });

  it("throws when the ref has no nodeId", async () => {
    const client = createFigmaClient({
      token: "t",
      fetch: fetchStub(() => jsonResponse(200, {})).fetch,
    });
    await expect(client.renderNode({ fileKey: "F" }, { format: "png" })).rejects.toThrowError(
      /nodeId/,
    );
  });

  it("throws RENDER_FAILED when figma returns a null render", async () => {
    const { fetch } = fetchStub(() => jsonResponse(200, { images: { "1:2": null } }));
    const client = createFigmaClient({ token: "t", fetch });
    await expect(
      client.renderNode({ fileKey: "F", nodeId: "1:2" }, { format: "svg" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "RENDER_FAILED" }));
  });
});

describe("imageFills", () => {
  it("returns the imageRef->url map from /v1/files/:key/images", async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse(200, { meta: { images: { refA: "https://cdn/x" } } }),
    );
    const client = createFigmaClient({ token: "t", fetch });
    const fills = await client.imageFills("FILE");
    expect(fills.get("refA")).toBe("https://cdn/x");
  });
});

describe("variables", () => {
  it("maps HTTP 403 to REQUIRES_ENTERPRISE", async () => {
    const { fetch } = fetchStub(() => jsonResponse(403, { message: "nope" }));
    const client = createFigmaClient({ token: "t", fetch });
    await expect(client.variables("FILE")).rejects.toThrowError(
      expect.objectContaining({ code: "REQUIRES_ENTERPRISE" }),
    );
  });

  it("returns meta payload on success", async () => {
    const { fetch, calls } = fetchStub(() =>
      jsonResponse(200, {
        meta: { variables: { "VariableID:1:2": { name: "Blue/500" } }, variableCollections: {} },
      }),
    );
    const client = createFigmaClient({ token: "t", fetch });
    const out = await client.variables("FILE");
    expect(out.variables["VariableID:1:2"]?.name).toBe("Blue/500");
    expect(calls[0]).toContain("/v1/files/FILE/variables/local");
  });
});

describe("error mapping", () => {
  it("maps 429 to RATE_LIMITED (after retries) and 401 to BAD_TOKEN", async () => {
    const stub = fetchStub(() => jsonResponse(429, {}));
    const c429 = createFigmaClient({
      token: "t",
      fetch: stub.fetch,
      sleep: () => Promise.resolve(),
    });
    await expect(c429.styles("F")).rejects.toThrowError(
      expect.objectContaining({ code: "RATE_LIMITED" }),
    );
    // 1 initial + 3 retries = 4 attempts
    expect(stub.calls).toHaveLength(4);
    const c401 = createFigmaClient({
      token: "t",
      fetch: fetchStub(() => jsonResponse(401, {})).fetch,
    });
    await expect(c401.styles("F")).rejects.toThrowError(
      expect.objectContaining({ code: "BAD_TOKEN" }),
    );
  });

  it("retries 429 and succeeds when the limit clears", async () => {
    let n = 0;
    const waits: number[] = [];
    const client = createFigmaClient({
      token: "t",
      fetch: (() => {
        n += 1;
        return Promise.resolve(
          n < 3
            ? jsonResponse(429, {})
            : jsonResponse(200, {
                meta: { styles: [{ key: "k", name: "P", style_type: "FILL" }] },
              }),
        );
      }) as FigmaFetch,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    const styles = await client.styles("F");
    expect(styles[0]?.key).toBe("k");
    expect(n).toBe(3); // two 429s then success
    expect(waits).toEqual([1000, 2000]); // exponential backoff
  });

  it("caps an oversized Retry-After at 60s so the CLI can't block for an hour", async () => {
    let n = 0;
    const waits: number[] = [];
    const client = createFigmaClient({
      token: "t",
      fetch: (() => {
        n += 1;
        return Promise.resolve(
          n === 1
            ? new Response("{}", { status: 429, headers: { "retry-after": "3600" } })
            : jsonResponse(200, { meta: { styles: [] } }),
        );
      }) as FigmaFetch,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    await client.styles("F");
    expect(waits).toEqual([60_000]); // 3600s clamped, not 3_600_000
  });

  it("retries 429 on non-styles endpoints too (retry lives in the shared get)", async () => {
    let n = 0;
    const client = createFigmaClient({
      token: "t",
      fetch: (() => {
        n += 1;
        return Promise.resolve(
          n < 2
            ? jsonResponse(429, {})
            : jsonResponse(200, { images: { "1:2": "https://cdn/a.png" } }),
        );
      }) as FigmaFetch,
      sleep: () => Promise.resolve(),
    });
    const out = await client.renderNodes("F", ["1:2"], { format: "png" });
    expect(out[0]?.url).toBe("https://cdn/a.png");
    expect(n).toBe(2); // one 429 then success
  });

  it("honors Retry-After (seconds) over the backoff default", async () => {
    let n = 0;
    const waits: number[] = [];
    const client = createFigmaClient({
      token: "t",
      fetch: (() => {
        n += 1;
        return Promise.resolve(
          n === 1
            ? new Response("{}", { status: 429, headers: { "retry-after": "5" } })
            : jsonResponse(200, { meta: { styles: [] } }),
        );
      }) as FigmaFetch,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    await client.styles("F");
    expect(waits).toEqual([5000]);
  });

  it("names the endpoint scope in the styles 403 when the body is silent", async () => {
    const client = createFigmaClient({
      token: "t",
      fetch: fetchStub(() => jsonResponse(403, { message: "no" })).fetch,
    });
    await expect(client.styles("F")).rejects.toThrowError(
      expect.objectContaining({
        code: "FORBIDDEN",
        message: expect.stringContaining("library_content:read"),
      }),
    );
  });

  it("surfaces figma's own scope diagnosis verbatim from the 403 body (err field)", async () => {
    const client = createFigmaClient({
      token: "t",
      fetch: fetchStub(() =>
        jsonResponse(403, {
          err: "Invalid scope(s): file_content:read, file_metadata:read. This endpoint requires the library_content:read scope",
        }),
      ).fetch,
    });
    await expect(client.styles("F")).rejects.toThrowError(
      expect.objectContaining({
        code: "FORBIDDEN",
        message: expect.stringContaining("requires the library_content:read scope"),
      }),
    );
  });

  it("reclassifies a 403 'Invalid token' body as BAD_TOKEN, not a scope problem", async () => {
    // figma returns 403 (not 401) for bad PATs on file endpoints — verified live
    const client = createFigmaClient({
      token: "t",
      fetch: fetchStub(() => jsonResponse(403, { err: "Invalid token" })).fetch,
    });
    const err = await client.styles("F").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FigmaClientError);
    if (err instanceof FigmaClientError) {
      expect(err.code).toBe("BAD_TOKEN");
      expect(err.message).toContain("Re-mint");
    }
  });

  it("keeps REQUIRES_ENTERPRISE for a scopeless variables 403", async () => {
    const client = createFigmaClient({
      token: "t",
      fetch: fetchStub(() => jsonResponse(403, { message: "no" })).fetch,
    });
    await expect(client.variables("F")).rejects.toThrowError(
      expect.objectContaining({ code: "REQUIRES_ENTERPRISE" }),
    );
  });
});

describe("endpoint attribution", () => {
  it("labels each call's error with a low-cardinality endpoint, never the raw fileKey/nodeId", async () => {
    const client = createFigmaClient({
      token: "t",
      fetch: fetchStub(() => jsonResponse(500, {})).fetch,
    });
    const cases: Array<[string, () => Promise<unknown>]> = [
      ["images", () => client.renderNode({ fileKey: "SECRET", nodeId: "1:2" }, { format: "png" })],
      ["images", () => client.renderNodes("SECRET", ["1:2"], { format: "png" })],
      ["files_images", () => client.imageFills("SECRET")],
      ["variables_local", () => client.variables("SECRET")],
      ["styles", () => client.styles("SECRET")],
      ["files_nodes", () => client.nodeTree({ fileKey: "SECRET", nodeId: "1:2" })],
      ["file_meta", () => client.fileVersion("SECRET")],
    ];
    for (const [expected, call] of cases) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FigmaClientError);
      if (err instanceof FigmaClientError) {
        expect(err.endpoint).toBe(expected);
        expect(err.endpoint).not.toContain("SECRET");
      }
    }
  });

  it("still labels RENDER_FAILED and NODE_NOT_FOUND (thrown outside the shared get())", async () => {
    const nullRender = createFigmaClient({
      token: "t",
      fetch: fetchStub(() => jsonResponse(200, { images: { "1:2": null } })).fetch,
    });
    const renderErr = await nullRender
      .renderNode({ fileKey: "F", nodeId: "1:2" }, { format: "svg" })
      .catch((e: unknown) => e);
    expect(renderErr).toBeInstanceOf(FigmaClientError);
    if (renderErr instanceof FigmaClientError) expect(renderErr.endpoint).toBe("images");

    const missingNode = createFigmaClient({
      token: "t",
      fetch: fetchStub(() => jsonResponse(200, { nodes: {} })).fetch,
    });
    const notFoundErr = await missingNode
      .nodeTree({ fileKey: "F", nodeId: "9:9" })
      .catch((e: unknown) => e);
    expect(notFoundErr).toBeInstanceOf(FigmaClientError);
    if (notFoundErr instanceof FigmaClientError) expect(notFoundErr.endpoint).toBe("files_nodes");
  });
});

describe("renderNodes (batch)", () => {
  it("fetches many nodes in ONE /v1/images call and maps each url", async () => {
    const stub = fetchStub(() =>
      jsonResponse(200, {
        images: { "1:2": "https://cdn/a.png", "3:4": "https://cdn/b.png" },
      }),
    );
    const client = createFigmaClient({ token: "t", fetch: stub.fetch });
    const out = await client.renderNodes("F", ["1:2", "3:4"], { format: "png" });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]).toContain("ids=1%3A2%2C3%3A4"); // "1:2,3:4" url-encoded
    expect(out).toEqual([
      { nodeId: "1:2", url: "https://cdn/a.png", ext: "png" },
      { nodeId: "3:4", url: "https://cdn/b.png", ext: "png" },
    ]);
  });

  it("returns url:null for a node figma couldn't render, without failing the batch", async () => {
    const client = createFigmaClient({
      token: "t",
      fetch: fetchStub(() =>
        jsonResponse(200, { images: { "1:2": "https://cdn/a.png", "3:4": null } }),
      ).fetch,
    });
    const out = await client.renderNodes("F", ["1:2", "3:4"], { format: "svg" });
    expect(out[0]?.url).toBe("https://cdn/a.png");
    expect(out[1]?.url).toBeNull();
  });

  it("wraps other failures as HTTP_ERROR with status", async () => {
    const client = createFigmaClient({
      token: "t",
      fetch: fetchStub(() => jsonResponse(500, {})).fetch,
    });
    const err = await client.nodeTree({ fileKey: "F", nodeId: "1:2" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FigmaClientError);
    if (err instanceof FigmaClientError) {
      expect(err.code).toBe("HTTP_ERROR");
      expect(err.status).toBe(500);
    }
  });
});

describe("nodeTree", () => {
  it("requests geometry=paths and returns the node document", async () => {
    const { fetch, calls } = fetchStub(() =>
      jsonResponse(200, {
        nodes: { "1:2": { document: { id: "1:2", name: "Hero", type: "FRAME" } } },
      }),
    );
    const client = createFigmaClient({ token: "t", fetch });
    const node = await client.nodeTree({ fileKey: "F", nodeId: "1:2" });
    expect(node.name).toBe("Hero");
    expect(calls[0]).toContain("/v1/files/F/nodes?ids=1%3A2&geometry=paths");
  });

  it("throws NODE_NOT_FOUND when the id is absent", async () => {
    const { fetch } = fetchStub(() => jsonResponse(200, { nodes: {} }));
    const client = createFigmaClient({ token: "t", fetch });
    await expect(client.nodeTree({ fileKey: "F", nodeId: "9:9" })).rejects.toThrowError(
      expect.objectContaining({ code: "NODE_NOT_FOUND" }),
    );
  });
});

describe("styles", () => {
  it("returns published styles list", async () => {
    const { fetch } = fetchStub(() =>
      jsonResponse(200, {
        meta: { styles: [{ key: "k1", name: "Primary", style_type: "FILL" }] },
      }),
    );
    const client = createFigmaClient({ token: "t", fetch });
    const styles = await client.styles("F");
    expect(styles[0]?.key).toBe("k1");
  });
});

describe("fileVersion", () => {
  it("returns version + lastModified from file metadata", async () => {
    const { fetch, calls } = fetchStub(() =>
      jsonResponse(200, { version: "42", lastModified: "2026-07-01T00:00:00Z" }),
    );
    const client = createFigmaClient({ token: "t", fetch });
    const meta = await client.fileVersion("F");
    expect(meta.version).toBe("42");
    expect(calls[0]).toContain("/v1/files/F?depth=1");
  });
});
