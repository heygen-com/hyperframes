// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStudioApi } from "../createStudioApi";
import { fileContentVersion } from "../helpers/fileVersion";
import { openProjectHistory } from "../history/projectHistory";
import type { StudioApiAdapter } from "../types";

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const PACKAGE = JSON.stringify({ scripts: { build: "node ./build.mjs" } });
const AGENT = { kind: "agent", name: "Agent" };
interface Reply {
  windowId?: string;
  claimed?: { id: string } | null;
  back?: unknown;
}
type Call = (path: string, body?: object) => Promise<Reply>;

async function project(files: Record<string, string>) {
  const projectDir = tempDir("hf-history-protected-");
  const write = (path: string, text: string) => writeFileSync(join(projectDir, path), text);
  for (const [path, text] of Object.entries(files)) write(path, text);
  const history = await openProjectHistory({
    projectDir,
    historyRoot: tempDir("hf-history-root-"),
  });
  cleanup.push(() => history.close());
  const api = createStudioApi({
    listProjects: () => [],
    resolveProject: (id: string) => (id === "demo" ? { id, dir: projectDir } : null),
    history: () => history,
  } as unknown as StudioApiAdapter);
  const call: Call = async (path, body) => {
    const init = body ? { method: "POST", body: JSON.stringify(body) } : undefined;
    const response = await api.request(`/projects/demo/history${path}`, init);
    expect(response.status, path).toBe(200);
    return (await response.json()) as Reply;
  };
  const read = (path: string) => readFileSync(join(projectDir, path), "utf-8");
  const has = (path: string) => existsSync(join(projectDir, path));
  return { write, read, has, call };
}

async function agentTurn(call: Call, edit: () => void): Promise<string> {
  const { windowId } = await call("/window", { label: "Agent turn", who: AGENT });
  edit();
  await call(`/window/${windowId}/close`, {});
  return windowId ?? "";
}

describe("history writes and the files Studio does not write", () => {
  it("undo and restore bring back compositions and leave tool-trusted files as they stand", async () => {
    const { write, read, has, call } = await project({
      "index.html": "A",
      "package.json": PACKAGE,
      "AGENTS.md": "rules",
      "build.mjs": "build",
    });
    const turn = await agentTurn(call, () => {
      write("index.html", "B");
      write("AGENTS.md", "planted rules");
      write("build.mjs", "planted build");
      write("opencode.json", "{}");
    });
    const untouched = () => [read("AGENTS.md"), read("build.mjs"), has("opencode.json")];

    await call("/undo", { entryId: turn });
    expect(read("index.html")).toBe("A");
    expect(untouched()).toEqual(["planted rules", "planted build", true]);

    await agentTurn(call, () => write("index.html", "C"));
    await call("/restore", { point: "start" });
    expect(read("index.html")).toBe("A");
    expect(untouched()).toEqual(["planted rules", "planted build", true]);
  });

  it("Cmd+Z passes over an outside edit that only changed a tool-trusted file", async () => {
    const { write, read, call } = await project({ "index.html": "A", "package.json": PACKAGE });
    const edited = JSON.stringify({ scripts: {} });
    write("package.json", edited);

    expect((await call("")).back).toBeNull();
    expect(await call("/step", { direction: "back" })).toEqual({ ok: true, entry: null });
    expect(read("package.json")).toBe(edited);
  });

  it("a claim cannot make bytes stored for another file a file's earlier state", async () => {
    const { write, read, call } = await project({ "index.html": "A", "other.html": "EVIL" });
    write("index.html", "B");

    const { claimed } = await call("/claim", {
      paths: ["index.html"],
      overwrote: { "index.html": fileContentVersion("EVIL") },
    });
    expect(claimed?.id).toBeTruthy();
    await call("/undo", { entryId: claimed?.id });

    expect(read("index.html")).toBe("A");
  });

  it("a claim cannot take an outside change to package.json", async () => {
    const { write, read, call } = await project({
      "index.html": "A",
      "package.json": PACKAGE,
      "evil.html": "EVIL",
    });
    const edited = JSON.stringify({ name: "edited by the developer" });
    write("package.json", edited);

    const { claimed } = await call("/claim", {
      paths: ["package.json"],
      overwrote: { "package.json": fileContentVersion("EVIL") },
    });

    expect(claimed).toBeNull();
    expect(read("package.json")).toBe(edited);
  });
});
