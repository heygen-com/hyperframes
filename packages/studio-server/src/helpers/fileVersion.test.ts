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

    expect(consumeFileWriteReceipt("/project/index.html")).toEqual(receipt);
    expect(consumeFileWriteReceipt("/project/index.html")).toBeNull();
  });
});
