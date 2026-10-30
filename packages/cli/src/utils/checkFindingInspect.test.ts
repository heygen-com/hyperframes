import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import { prepareFindingInspector } from "./checkFindingInspect.js";
import type { StaticProjectServer } from "./staticProjectServer.js";

const live = vi.hoisted(() => ({
  finalizeDocument: vi.fn(),
  inspect: vi.fn(),
  prepareLiveInspection: vi.fn(),
}));

vi.mock("@hyperframes/inspector/live", () => ({
  fingerprint: () => "version",
  prepareLiveInspection: live.prepareLiveInspection,
}));

const page = {} as Page;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "finding-inspect-"));
  live.finalizeDocument.mockReset();
  live.inspect.mockReset();
  live.prepareLiveInspection.mockReset().mockImplementation((_dir, html: string) => ({
    html: `${html}<!-- hooked -->`,
    finalizeDocument: live.finalizeDocument,
    inspect: live.inspect,
  }));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const inProcessServer = (html: string): StaticProjectServer => ({
  url: "http://127.0.0.1:0",
  port: 0,
  close: async () => {},
  answer: async () => ({ status: 200, headers: {}, body: Buffer.from(html) }),
});

describe("prepareFindingInspector", () => {
  it("bundles with provenance, serves the hooked page and finalizes with what the server answers", async () => {
    const bundle = vi.fn(async () => "<html><head></head></html>");
    const inspector = await prepareFindingInspector(dir, bundle);
    expect(bundle).toHaveBeenCalledWith({
      scriptProvenance: expect.any(Function),
      onRead: expect.any(Function),
    });
    expect(inspector.html).toBe("<html><head></head></html><!-- hooked -->");
    await inspector.ready(inProcessServer("<served>"));
    expect(live.finalizeDocument).toHaveBeenCalledWith("<served>");
  });

  it("asks for the target alone, and turns one failed inspection into that target's error", async () => {
    const report = { results: [{ target: 0, status: "found" }], snippets: [] };
    live.inspect.mockImplementation(async (_runner, request: { targets: unknown[] }) => {
      if (JSON.stringify(request.targets) === '[{"selector":"#gone"}]') throw new Error("boom");
      return report;
    });
    const inspector = await prepareFindingInspector(dir, async () => "<html><head></head></html>");
    await inspector.ready(inProcessServer("<served>"));
    expect(await inspector.inspect(page, { selector: "#gone" })).toEqual({ error: "boom" });
    expect(await inspector.inspect(page, { hfId: "hf-1" })).toBe(report);
    expect(live.inspect).toHaveBeenLastCalledWith(expect.anything(), {
      targets: [{ hfId: "hf-1" }],
      descendants: false,
    });
  });

  it("counts candidates omitted by the byte budget when refusing an ambiguous selector", async () => {
    live.inspect.mockResolvedValue({ results: [{ candidates: [], candidatesOmitted: 2 }] });
    const inspector = await prepareFindingInspector(dir, async () => "<html><head></head></html>");
    await inspector.ready(inProcessServer("<served>"));
    expect(await inspector.inspect(page, { selector: "p" })).toEqual({
      error: "ambiguous_selector: p matches multiple elements",
    });
  });

  it("serves the plain page and reports the failure for every target when preparing fails", async () => {
    const inspector = await prepareFindingInspector(dir, async () => {
      throw new Error("bundle failed");
    });
    expect(inspector.html).toBeUndefined();
    await inspector.ready(inProcessServer("<served>"));
    expect(await inspector.inspect(page, { selector: "#a" })).toEqual({ error: "bundle failed" });
    expect(live.inspect).not.toHaveBeenCalled();
  });

  it("reports a page it could not read back for every target", async () => {
    const inspector = await prepareFindingInspector(dir, async () => "<html><head></head></html>");
    await inspector.ready({
      ...inProcessServer(""),
      answer: async () => {
        throw new Error("no answer");
      },
    });
    expect(await inspector.inspect(page, { selector: "#a" })).toEqual({ error: "no answer" });
    expect(live.inspect).not.toHaveBeenCalled();
  });
});
