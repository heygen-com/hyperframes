import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { previewProof } from "@hyperframes/core/preview-proof";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  activeServerOnPort,
  detectHyperframesServer,
  type ActiveServer,
} from "../server/portUtils.js";
import { findPreviewServerForProject } from "../utils/studioSelectionClient.js";
import { readBackgroundPreviewStatus, stopBackgroundPreview } from "./previewLifecycle.js";

const projectDir = resolve("/tmp/hyperframes-impostor-project");

// A listener that answers the config probe for this project. Without the user's token it cannot answer the challenge.
async function listener(answersChallenge: boolean): Promise<number> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    const proof = answersChallenge ? previewProof(url.searchParams.get("nonce")) : null;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        isHyperframes: true,
        pid: 1,
        projectName: "impostor",
        projectDir,
        version: "test",
        ...(proof && { proof }),
      }),
    );
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", () => listening()));
  onTestFinished(() => new Promise<void>((done) => server.close(() => done())));
  return (server.address() as AddressInfo).port;
}

const ownPid = async () => String(process.pid);
const claimed = (port: number): ActiveServer => ({
  port,
  projectName: "impostor",
  projectDir,
  version: "test",
  pid: String(process.pid),
  pidSource: "os",
  proven: false,
});

function stateHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-impostor-state-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("a listener that claims this user's project without proving it", () => {
  it("is marked unproven by the probe, while one that answers the challenge is proven", async () => {
    expect((await activeServerOnPort(await listener(false), ownPid))?.proven).toBe(false);
    expect((await activeServerOnPort(await listener(true), ownPid))?.proven).toBe(true);
  });

  it("is not reused by a foreground preview", async () => {
    const normalized = projectDir.replace(/\\/g, "/").toLowerCase();
    expect((await detectHyperframesServer(await listener(false), normalized)).type).toBe(
      "unproven",
    );
    expect((await detectHyperframesServer(await listener(true), normalized)).type).toBe("match");
  });

  it("is not consulted for agent context", async () => {
    const port = await listener(false);
    const notStudio = vi.fn(async () => new Response("", { status: 404 }));

    expect(
      await findPreviewServerForProject(projectDir, port, async () => [claimed(port)], notStudio),
    ).toBeNull();
  });

  it("is not reported as the running preview, so no browser opens on it", async () => {
    const port = await listener(false);

    expect(
      await readBackgroundPreviewStatus(projectDir, port, {
        scan: async () => [claimed(port)],
        stateHome: stateHome(),
      }),
    ).toBeNull();
  });

  it("is not stopped", async () => {
    const port = await listener(false);
    const kill = vi.fn();

    await expect(
      stopBackgroundPreview(projectDir, port, {
        scan: async () => [claimed(port)],
        probe: async () => claimed(port),
        kill,
        sleep: async () => {},
        stateHome: stateHome(),
      }),
    ).rejects.toThrow(/ownership could not be proven/);
    expect(kill).not.toHaveBeenCalled();
  });
});
