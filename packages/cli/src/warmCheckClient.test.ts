import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { Frame, encodeFrame, frameReader, keyed } from "./warmCheckProtocol.js";
import { runWarmCheck, warmCheckEligible, warmCheckOutcome } from "./warmCheckClient.js";

describe("warmCheckEligible", () => {
  const argv = ["node", "hyperframes", "check", "."];

  it("hands an agent's check to a warm process", () => {
    expect(warmCheckEligible(argv, {}, false, false)).toBe(true);
  });

  it("keeps terminals, CI, help and other commands cold", () => {
    expect(warmCheckEligible(argv, {}, true, false)).toBe(false);
    expect(warmCheckEligible(argv, {}, false, true)).toBe(false);
    expect(warmCheckEligible(argv, { CI: "true" }, false, false)).toBe(false);
    expect(warmCheckEligible([...argv, "--help"], {}, false, false)).toBe(false);
    expect(warmCheckEligible(["node", "hyperframes", "lint", "."], {}, false, false)).toBe(false);
  });
});

describe("warmCheckOutcome", () => {
  it("takes the warm process's exit code", () => {
    expect(warmCheckOutcome(3, true, undefined)).toEqual({ served: true, exitCode: 3 });
  });

  it("lets the check run cold when the warm process declined before any output", () => {
    expect(warmCheckOutcome(undefined, false, undefined)).toEqual({ served: false });
  });

  it("reports a warm process that stopped mid-output instead of running the check twice", () => {
    expect(warmCheckOutcome(undefined, true, undefined)).toEqual({
      served: true,
      exitCode: 1,
      message: "The warm check process stopped before finishing.\n",
    });
  });

  it("exits like a signalled process when the user interrupted the check", () => {
    expect(warmCheckOutcome(undefined, false, "SIGINT")).toEqual({ served: true, exitCode: 130 });
  });
});

describe("runWarmCheck", () => {
  it("runs cold without connecting anywhere when there is no private endpoint", async () => {
    await expect(runWarmCheck(undefined)).resolves.toBe(false);
  });

  it("delivers every frame the server sends, stdout after stderr included", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hfw-client-"));
    const address =
      process.platform === "win32" ? `\\\\.\\pipe\\${dir.replace(/\W/g, "")}` : join(dir, "s.sock");
    const endpoint = { address, token: "a".repeat(64) };
    const server = createServer((socket) => {
      socket.on(
        "data",
        frameReader((type, body) => {
          if (type !== Frame.Hello) return;
          const proof = keyed(endpoint.token, "server", body.toString());
          socket.write(encodeFrame(Frame.Proof, JSON.stringify({ proof, nonce: "n" })));
          socket.write(encodeFrame(Frame.Stderr, "notice\n"));
          socket.end(
            Buffer.concat([encodeFrame(Frame.Stdout, "{}\n"), encodeFrame(Frame.Exit, "0")]),
          );
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(endpoint.address, resolve));
    onTestFinished(() => {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    onTestFinished(() => {
      stdout.mockRestore();
      stderr.mockRestore();
    });
    await expect(runWarmCheck(endpoint)).resolves.toBe(true);
    expect(String(stderr.mock.calls[0]?.[0])).toBe("notice\n");
    expect(String(stdout.mock.calls[0]?.[0])).toBe("{}\n");
  });
});
