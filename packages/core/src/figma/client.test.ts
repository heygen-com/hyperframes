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
  it("maps 429 to RATE_LIMITED and 401 to BAD_TOKEN", async () => {
    const c429 = createFigmaClient({
      token: "t",
      fetch: fetchStub(() => jsonResponse(429, {})).fetch,
    });
    await expect(c429.styles("F")).rejects.toThrowError(
      expect.objectContaining({ code: "RATE_LIMITED" }),
    );
    const c401 = createFigmaClient({
      token: "t",
      fetch: fetchStub(() => jsonResponse(401, {})).fetch,
    });
    await expect(c401.styles("F")).rejects.toThrowError(
      expect.objectContaining({ code: "BAD_TOKEN" }),
    );
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
