import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { promisify } from "node:util";

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

// portUtils promisifies execFile at import time. The mock has no
// promisify.custom implementation, so teach it to resolve { stdout, stderr }
// like the real child_process.execFile does.
type ExecCallback = (error: unknown, stdout: string, stderr: string) => void;
(
  execFileMock as unknown as Record<
    symbol,
    (command: string, args: string[], options: unknown) => Promise<unknown>
  >
)[promisify.custom] = (command: string, args: string[], options: unknown) =>
  new Promise((resolve, reject) => {
    (execFileMock as unknown as (...call: unknown[]) => void)(command, args, options, ((
      error: unknown,
      stdout: string,
      stderr: string,
    ) => (error ? reject(error) : resolve({ stdout, stderr }))) as unknown);
  });

const { activeServerOnPort } = await import("./portUtils.js");

const openHttpServers: HttpServer[] = [];

async function startConfigProbeServer(port: number): Promise<void> {
  const server = createHttpServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        isHyperframes: true,
        projectName: "demo-project",
        projectDir: "/tmp/demo-project",
        serverBuildSignature: null,
        version: "0.6.42",
        pid: 4242,
      }),
    );
  });
  openHttpServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

describe("port listener lookup child-process options", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    execFileMock.mockImplementation(
      (_command: string, _args: string[], _options: unknown, callback: ExecCallback) => {
        callback(null, "", "");
      },
    );
  });

  afterEach(async () => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    vi.clearAllMocks();
    await Promise.all(
      openHttpServers
        .splice(0)
        .map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
    );
  });

  it("hides the netstat console window used for Windows listener lookup", async () => {
    // Occupy an ephemeral port with a HyperFrames config responder so the
    // default OS listener lookup runs instead of the injected stub.
    const ephemeral = createHttpServer();
    await new Promise<void>((resolve) => ephemeral.listen(0, "127.0.0.1", () => resolve()));
    const port = (ephemeral.address() as import("node:net").AddressInfo).port;
    await new Promise<void>((resolve) => ephemeral.close(() => resolve()));
    await startConfigProbeServer(port);

    execFileMock.mockImplementation(
      (_command: string, _args: string[], _options: unknown, callback: ExecCallback) => {
        callback(
          null,
          `  TCP    127.0.0.1:${port}         0.0.0.0:0              LISTENING       1234\r\n`,
          "",
        );
      },
    );

    const server = await activeServerOnPort(port);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock.mock.calls[0]?.[0]).toBe("netstat");
    expect(execFileMock.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ windowsHide: true }));
    expect(server?.pid).toBe("1234");
    expect(server?.pidSource).toBe("os");
  });
});
