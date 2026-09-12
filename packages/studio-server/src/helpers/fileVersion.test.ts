import { afterEach, describe, expect, it, vi } from "vitest";
import {
  identifyFileWrite,
  fileContentVersion,
  recordFileWriteReceipt,
  resetFileWriteReceipts,
} from "./fileVersion";

afterEach(resetFileWriteReceipts);

describe("file versions and write receipts", () => {
  it("produces a strong quoted SHA-256 ETag", () => {
    expect(fileContentVersion("abc")).toBe(
      '"sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"',
    );
  });

  it("attaches one API write identity to every reader of the same watcher echo", () => {
    const receipt = {
      path: "index.html",
      version: fileContentVersion("after"),
      writeToken: "write-1",
    };
    recordFileWriteReceipt("/project/index.html", receipt);

    // One watcher event fans out to every open SSE subscriber; a reader that
    // removed the receipt would leave the rest reloading on Studio's own edit.
    expect(identifyFileWrite("/project/index.html", receipt.version)).toEqual(receipt);
    expect(identifyFileWrite("/project/index.html", receipt.version)).toEqual(receipt);
    expect(identifyFileWrite("/project/index.html", fileContentVersion("other"))).toBeNull();
  });

  it("stops recognising a write once the receipt TTL has passed", () => {
    vi.useFakeTimers();
    try {
      const receipt = {
        path: "index.html",
        version: fileContentVersion("after"),
        writeToken: "write-1",
      };
      recordFileWriteReceipt("/project/index.html", receipt);

      // The TTL is the ONLY thing that evicts a receipt now that reads leave it
      // in place, so a watcher echo arriving after it must read as external.
      vi.advanceTimersByTime(9_999);
      expect(identifyFileWrite("/project/index.html", receipt.version)).toEqual(receipt);
      vi.advanceTimersByTime(2);
      expect(identifyFileWrite("/project/index.html", receipt.version)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("matches the final debounced watcher version instead of receipt insertion order", () => {
    const first = {
      path: "index.html",
      version: fileContentVersion("first"),
      writeToken: "write-1",
    };
    const last = {
      path: "index.html",
      version: fileContentVersion("last"),
      writeToken: "write-2",
    };
    recordFileWriteReceipt("/project/index.html", first);
    recordFileWriteReceipt("/project/index.html", last);

    expect(identifyFileWrite("/project/index.html", last.version)).toEqual(last);
    expect(identifyFileWrite("/project/index.html", first.version)).toEqual(first);
  });

  it("labels a repeat of earlier bytes with the newest token, not the spent one", () => {
    const version = fileContentVersion("same bytes");
    const older = { path: "index.html", version, writeToken: "write-older" };
    const newer = { path: "index.html", version, writeToken: "write-newer" };
    recordFileWriteReceipt("/project/index.html", older);
    recordFileWriteReceipt("/project/index.html", newer);

    expect(identifyFileWrite("/project/index.html", version)).toEqual(newer);
  });
});
