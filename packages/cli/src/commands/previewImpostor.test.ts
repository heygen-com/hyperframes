import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PREVIEW_NONCE_HEADER, previewProof } from "@hyperframes/core/preview-proof";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  activeServerOnPort,
  detectHyperframesServer,
  type ActiveServer,
} from "../server/portUtils.js";
import { findPreviewServerForProject } from "../utils/studioSelectionClient.js";
import { readBackgroundPreviewStatus, stopBackgroundPreview } from "./previewLifecycle.js";

const projectDir = resolve("/tmp/hyperframes-impostor-project");

const config = {
  isHyperframes: true,
  pid: 1,
  projectName: "impostor",
  projectDir,
  version: "test",
};

async function serve(answer: (request: IncomingMessage) => Promise<object>): Promise<number> {
  const server = createServer((request, response) => {
    void answer(request).then((body) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", () => listening()));
  onTestFinished(() => new Promise<void>((done) => server.close(() => done())));
  return (server.address() as AddressInfo).port;
}

// A listener that answers the config probe for this project. Without the user's token it cannot answer the challenge.
const listener = (answersChallenge: boolean) =>
  serve(async ({ headers, socket }) => {
    const endpoint = { address: socket.localAddress!, port: socket.localPort! };
    const proof = answersChallenge
      ? previewProof(headers[PREVIEW_NONCE_HEADER], endpoint, config)
      : null;
    return { ...config, ...(proof && { proof }) };
  });

// Forwards the CLI's challenge to a genuine preview and passes its answer back, with the project changed or not.
const relay = (genuinePort: number, projectDir?: string) =>
  serve(async ({ headers }) => {
    const nonce = String(headers[PREVIEW_NONCE_HEADER]);
    const answer = await fetch(`http://127.0.0.1:${genuinePort}/__hyperframes_config`, {
      headers: { [PREVIEW_NONCE_HEADER]: nonce },
    });
    return { ...((await answer.json()) as object), ...(projectDir && { projectDir }) };
  });

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

  it("is not proven by relaying the challenge to a genuine preview", async () => {
    const genuine = await listener(true);

    expect((await activeServerOnPort(await relay(genuine, "/forged"), ownPid))?.proven).toBe(false);
    expect((await activeServerOnPort(await relay(genuine), ownPid))?.proven).toBe(false);
    expect((await activeServerOnPort(genuine, ownPid))?.proven).toBe(true);
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
