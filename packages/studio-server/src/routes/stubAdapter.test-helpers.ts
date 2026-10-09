import type { StudioApiAdapter } from "../types";

/** An adapter that resolves every project id to `dir` and stubs the rest. */
export function stubAdapter(dir: string): StudioApiAdapter {
  return {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => "/tmp/renders",
    startRender: () => ({ id: "j", status: "rendering", progress: 0, outputPath: "/tmp/o.mp4" }),
  };
}
