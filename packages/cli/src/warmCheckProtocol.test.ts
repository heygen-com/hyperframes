import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  Frame,
  encodeFrame,
  envDigest,
  frameForwarder,
  frameReader,
  warmCheckDirectory,
  warmCheckEndpoint,
} from "./warmCheckProtocol.js";

const TOKEN = "a".repeat(64);

function base(): string {
  const dir = mkdtempSync("/tmp/hfw-proto-");
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe.skipIf(process.platform === "win32")("the warm check endpoint", () => {
  it("lives in a private directory it creates, with a private token", () => {
    const runtime = base();
    const endpoint = warmCheckEndpoint({ XDG_RUNTIME_DIR: runtime });
    expect(endpoint?.address.startsWith(join(runtime, "hyperframes-warm"))).toBe(true);
    expect(endpoint?.token).toMatch(/^[0-9a-f]{64}$/);
    expect(warmCheckEndpoint({ XDG_RUNTIME_DIR: runtime })).toEqual(endpoint);
  });

  it("refuses a directory others can write to, or one that is a symlink", () => {
    const open = base();
    mkdirSync(join(open, "hyperframes-warm"));
    chmodSync(join(open, "hyperframes-warm"), 0o777);
    expect(warmCheckDirectory({ XDG_RUNTIME_DIR: open })).toBeUndefined();
    expect(warmCheckEndpoint({ XDG_RUNTIME_DIR: open })).toBeUndefined();

    const linked = base();
    symlinkSync(base(), join(linked, "hyperframes-warm"));
    expect(warmCheckEndpoint({ XDG_RUNTIME_DIR: linked })).toBeUndefined();
  });

  it("refuses a token file others can read, or one that is a symlink", () => {
    const readable = base();
    mkdirSync(join(readable, "hyperframes-warm"), { mode: 0o700 });
    writeFileSync(join(readable, "hyperframes-warm", "token"), TOKEN, { mode: 0o644 });
    expect(warmCheckEndpoint({ XDG_RUNTIME_DIR: readable })).toBeUndefined();

    const linked = base();
    mkdirSync(join(linked, "hyperframes-warm"), { mode: 0o700 });
    const elsewhere = join(base(), "token");
    writeFileSync(elsewhere, TOKEN, { mode: 0o600 });
    symlinkSync(elsewhere, join(linked, "hyperframes-warm", "token"));
    expect(warmCheckEndpoint({ XDG_RUNTIME_DIR: linked })).toBeUndefined();
  });
});

describe("envDigest", () => {
  it("ignores the shell's per-command variables and unset values", () => {
    expect(envDigest(TOKEN, { A: "1", _: "/x", PWD: "/a", B: undefined })).toBe(
      envDigest(TOKEN, { A: "1", _: "/y", OLDPWD: "/b" }),
    );
  });

  it("tells apart any added, removed or changed variable, and other tokens", () => {
    const digest = envDigest(TOKEN, { A: "1" });
    expect(envDigest(TOKEN, { A: "2" })).not.toBe(digest);
    expect(envDigest(TOKEN, { A: "1", B: "1" })).not.toBe(digest);
    expect(envDigest(TOKEN, {})).not.toBe(digest);
    expect(envDigest("b".repeat(64), { A: "1" })).not.toBe(digest);
  });
});

describe("frames", () => {
  it("decodes frames however the bytes are split", () => {
    const bytes = Buffer.concat([
      encodeFrame(Frame.Stdout, "héllo"),
      encodeFrame(Frame.Exit, "0"),
      encodeFrame(Frame.Stderr, Buffer.alloc(0)),
    ]);
    const seen: [number, string][] = [];
    const read = frameReader((type, body) => seen.push([type, body.toString()]));
    for (const byte of bytes) expect(read(Buffer.from([byte]))).toBe(true);
    expect(seen).toEqual([
      [Frame.Stdout, "héllo"],
      [Frame.Exit, "0"],
      [Frame.Stderr, ""],
    ]);
  });

  it("stops reading at a frame that claims more than the cap", () => {
    const head = Buffer.alloc(5);
    head.writeUInt8(Frame.Stdout, 0);
    head.writeUInt32BE(0xffffffff, 1);
    const read = frameReader(() => {
      throw new Error("no frame expected");
    });
    expect(read(head)).toBe(false);
    expect(read(encodeFrame(Frame.Exit, "0"))).toBe(false);
  });
});

describe("frameForwarder", () => {
  it("hands every write to the socket before returning, so ending the socket loses none", () => {
    const sent: Buffer[] = [];
    const write = frameForwarder({ write: (chunk: Buffer) => sent.push(chunk) > 0 }, Frame.Stdout);
    write("one ");
    write(Buffer.from("two "));
    write("thrée", "utf8");
    const seen: string[] = [];
    frameReader((_type, body) => seen.push(body.toString()))(Buffer.concat(sent));
    expect(seen).toEqual(["one ", "two ", "thrée"]);
  });
});
