import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Inspector } from "../src/service";

const listeningServers = (): number =>
  (process as unknown as { _getActiveHandles(): unknown[] })
    ._getActiveHandles()
    .filter((handle) => handle instanceof Server && handle.listening).length;

const projects: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of projects.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("leaves no page server listening when the network proxy cannot start", async () => {
  const project = mkdtempSync(join(tmpdir(), "hf-inspect-startup-"));
  projects.push(project);
  writeFileSync(join(project, "index.html"), "<html><body></body></html>");
  vi.stubEnv("HYPERFRAMES_CAPTURE_PROXY", "https://proxy.invalid");
  const before = listeningServers();
  const inspector = new Inspector(project, { instrument: false });

  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(inspector.withPage(async () => undefined)).rejects.toThrow(/http:\/\/ proxy/);
  }
  await inspector.dispose();

  expect(listeningServers()).toBe(before);
});
