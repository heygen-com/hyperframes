import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import {
  AmbiguousPreviewServerError,
  fetchStudioLint,
  fetchStudioSelection,
  studioApiUrl,
  findPreviewServerForProject,
  PreviewServerPortMismatchError,
  studioSelectionUrl,
} from "./studioSelectionClient";
import type { ActiveServer } from "../server/portUtils";

const servers: ActiveServer[] = [
  {
    port: 3002,
    projectName: "other",
    projectDir: "/tmp/other",
    version: "0.7.17",
    pid: null,
  },
  {
    port: 3003,
    projectName: "demo project",
    projectDir: "/tmp/demo",
    version: "0.7.17",
    pid: "123",
  },
];

function mockProjectsFetch(port = 5190): typeof fetch {
  return vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toBe(`http://127.0.0.1:${port}/api/projects`);
    return new Response(
      JSON.stringify({
        projects: [{ id: "demo project", dir: "/tmp/demo", title: "Demo" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

describe("studioSelectionClient", () => {
  it("finds the active preview server for a project directory", async () => {
    const scan = vi.fn(async () => servers);

    const server = await findPreviewServerForProject(resolve("/tmp/demo"), 3002, scan);

    expect(server?.port).toBe(3003);
    expect(scan).toHaveBeenCalledWith(3002);
  });

  it("matches by project directory when multiple projects are open", async () => {
    const scan = vi.fn(async () => [
      ...servers,
      {
        port: 3004,
        projectName: "third",
        projectDir: "/tmp/third",
        version: "0.7.17",
        pid: null,
      },
    ]);

    const server = await findPreviewServerForProject(resolve("/tmp/third"), 3002, scan);

    expect(server?.port).toBe(3004);
  });

  it("rejects ambiguous duplicate servers for the same project", async () => {
    const scan = vi.fn(async () => [servers[1]!, { ...servers[1]!, port: 3004, pid: "456" }]);

    await expect(
      findPreviewServerForProject(resolve("/tmp/demo"), 3002, scan),
    ).rejects.toMatchObject({
      name: "AmbiguousPreviewServerError",
      ports: [3003, 3004],
    } satisfies Partial<AmbiguousPreviewServerError>);
  });

  it("uses an explicit preferred port to disambiguate duplicate project servers", async () => {
    const scan = vi.fn(async () => [servers[1]!, { ...servers[1]!, port: 3004, pid: "456" }]);

    const server = await findPreviewServerForProject(resolve("/tmp/demo"), 3002, scan, undefined, {
      preferredPort: 3004,
    });

    expect(server?.port).toBe(3004);
  });

  it("rejects an explicit preferred port that does not match the only project server", async () => {
    const scan = vi.fn(async () => [servers[1]!]);
    const fetchImpl = vi.fn(async () => new Response("missing", { status: 404 }));

    await expect(
      findPreviewServerForProject(resolve("/tmp/demo"), 3002, scan, fetchImpl, {
        preferredPort: 3999,
      }),
    ).rejects.toMatchObject({
      name: "PreviewServerPortMismatchError",
      requestedPort: 3999,
      ports: [3003],
    } satisfies Partial<PreviewServerPortMismatchError>);
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:3999/api/projects");
  });

  it("falls back to Vite Studio project discovery on port 5190", async () => {
    const scan = vi.fn(async () => []);
    const fetchImpl = mockProjectsFetch();

    const server = await findPreviewServerForProject(resolve("/tmp/demo"), 3002, scan, fetchImpl);

    expect(server).toEqual({
      port: 5190,
      projectName: "demo project",
      projectDir: "/tmp/demo",
      version: "studio-dev",
      pid: null,
    });
  });

  it("checks an explicit preferred port for Vite Studio discovery", async () => {
    const scan = vi.fn(async () => []);
    const fetchImpl = mockProjectsFetch(5191);

    const server = await findPreviewServerForProject(resolve("/tmp/demo"), 3002, scan, fetchImpl, {
      preferredPort: 5191,
    });

    expect(server?.port).toBe(5191);
    expect(fetchImpl).not.toHaveBeenCalledWith("http://127.0.0.1:5190/api/projects");
  });

  it("builds a URL to the existing preview server's selection endpoint", () => {
    expect(studioSelectionUrl(servers[1]!)).toBe(
      "http://127.0.0.1:3003/api/projects/demo%20project/selection",
    );
  });

  it("builds URLs to other preview server API routes", () => {
    expect(studioApiUrl(servers[1]!, "lint")).toBe(
      "http://127.0.0.1:3003/api/projects/demo%20project/lint",
    );
  });

  it("fetches the current selection snapshot from a preview server", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          selection: {
            schemaVersion: 1,
            projectId: "demo project",
            compositionPath: "index.html",
            sourceFile: "index.html",
            currentTime: 2,
            target: { hfId: "cta" },
            label: "CTA",
            tagName: "button",
            boundingBox: { x: 0, y: 0, width: 10, height: 10 },
            textContent: "Go",
            dataAttributes: {},
            inlineStyles: {},
            computedStyles: {},
            textFields: [],
            capabilities: { canSelect: true },
            thumbnailUrl: "/api/projects/demo%20project/thumbnail/index.html?t=2&format=png",
          },
          updatedAt: "2026-06-28T16:00:00.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await fetchStudioSelection(servers[1]!, fetchImpl);

    expect(result.selection?.target.hfId).toBe("cta");
    expect(result.updatedAt).toBe("2026-06-28T16:00:00.000Z");
    expect(fetchImpl).toHaveBeenCalledWith(studioSelectionUrl(servers[1]!));
  });

  it("throws when the preview server returns a failed response", async () => {
    await expect(
      fetchStudioSelection(
        servers[1]!,
        vi.fn(async () => new Response("missing", { status: 404 })),
      ),
    ).rejects.toThrow("selection endpoint returned 404");
  });

  it("fetches lint findings from a preview server", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          findings: [{ severity: "error", message: "Missing timeline", file: "index.html" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await fetchStudioLint(servers[1]!, fetchImpl);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toBe("Missing timeline");
    expect(fetchImpl).toHaveBeenCalledWith(studioApiUrl(servers[1]!, "lint"));
  });
});
