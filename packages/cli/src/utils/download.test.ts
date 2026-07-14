import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { get as httpsGet } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFile } from "./download.js";

vi.mock("node:https", () => ({ get: vi.fn() }));

const mockGet = vi.mocked(httpsGet);
const tempDirs: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("downloadFile", () => {
  it("rejects an idle response and removes the partial file", async () => {
    mockGet.mockImplementation(((_url: string, callback: (response: IncomingMessage) => void) => {
      const response = new PassThrough() as PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
      };
      response.statusCode = 200;
      response.headers = {};

      class FakeRequest extends EventEmitter {
        private timeout: ReturnType<typeof setTimeout> | undefined;
        private fallback = setTimeout(() => this.destroy(new Error("late shutdown")), 50);
        private destroyed = false;

        setTimeout(ms: number, onTimeout: () => void): this {
          this.timeout = setTimeout(onTimeout, ms);
          return this;
        }

        destroy(error: Error): void {
          if (this.destroyed) return;
          this.destroyed = true;
          clearTimeout(this.timeout);
          clearTimeout(this.fallback);
          response.destroy(error);
          this.emit("error", error);
        }
      }

      const request = new FakeRequest();
      callback(response as unknown as IncomingMessage);
      return request as unknown as ClientRequest;
    }) as typeof httpsGet);

    const dir = mkdtempSync(join(tmpdir(), "hyperframes-download-"));
    tempDirs.push(dir);
    const dest = join(dir, "model.onnx");

    await expect(
      downloadFile("https://example.test/model.onnx", dest, { timeoutMs: 10 }),
    ).rejects.toThrow("Download timed out after 10ms");
    expect(existsSync(`${dest}.tmp`)).toBe(false);
    expect(existsSync(dest)).toBe(false);
  });
});
