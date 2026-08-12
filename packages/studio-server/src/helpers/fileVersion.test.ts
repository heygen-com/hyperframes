import { afterEach, describe, expect, it } from "vitest";
import {
  consumeFileWriteReceipt,
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

  it("attaches each API write identity to exactly one watcher echo", () => {
    const receipt = {
      path: "index.html",
      version: fileContentVersion("after"),
      writeToken: "write-1",
    };
    recordFileWriteReceipt("/project/index.html", receipt);

    expect(consumeFileWriteReceipt("/project/index.html", receipt.version)).toEqual(receipt);
    expect(consumeFileWriteReceipt("/project/index.html", receipt.version)).toBeNull();
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

    expect(consumeFileWriteReceipt("/project/index.html", last.version)).toEqual(last);
    expect(consumeFileWriteReceipt("/project/index.html", first.version)).toEqual(first);
  });
});
