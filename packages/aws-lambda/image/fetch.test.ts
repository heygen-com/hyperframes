import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tarGz = (() => {
  const dir = mkdtempSync(join(tmpdir(), "fetch-src-"));
  writeFileSync(join(dir, "hello.txt"), "hi");
  const out = join(dir, "pkg.tar.gz");
  Bun.spawnSync(["tar", "-czf", out, "-C", dir, "hello.txt"]);
  return readFileSync(out);
})();

// Serves `body` after resetting the first `resets` connections.
function serve(body: Buffer, resets = 0) {
  let hits = 0;
  const server = createServer((socket) => {
    socket.once("data", () => {
      if (++hits <= resets) return socket.resetAndDestroy();
      socket.write(
        `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
      );
      socket.end(body);
    });
  }).listen(0, "127.0.0.1");
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/pkg.tar.gz`,
    hits: () => hits,
    close: () => server.close(),
  };
}

async function fetchSource(line: string) {
  const dir = mkdtempSync(join(tmpdir(), "fetch-run-"));
  writeFileSync(join(dir, "sources.txt"), `${line}\n`);
  const proc = Bun.spawn(
    [
      "bash",
      "-c",
      `set -euo pipefail; source ${import.meta.dir}/fetch.sh; fetch ${line.split(" ")[0]}`,
    ],
    {
      env: { ...process.env, SRC: dir, SOURCES: join(dir, "sources.txt") },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const code = await proc.exited;
  if (code !== 0) console.error(await new Response(proc.stderr).text());
  return { code, dir };
}

const sum = createHash("sha256").update(tarGz).digest("hex");

function gitRepo(file: string) {
  const dir = mkdtempSync(join(tmpdir(), "fetch-git-"));
  const git = (...args: string[]) =>
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", dir, ...args])
      .stdout.toString()
      .trim();
  git("init", "-q", "repo.git");
  writeFileSync(join(dir, "repo.git", file), file);
  git("-C", "repo.git", "add", ".");
  git("-C", "repo.git", "commit", "-qm", file);
  return { url: join(dir, "repo.git"), commit: git("-C", "repo.git", "rev-parse", "HEAD") };
}

describe("ffmpeg image fetch", () => {
  it("retries a reset connection and still checks the sha256", async () => {
    const host = serve(tarGz, 2);
    const r = await fetchSource(`pkg.tar.gz ${sum} ${host.url}`);
    host.close();
    expect(r.code).toBe(0);
    expect(host.hits()).toBe(3);
    expect(readFileSync(join(r.dir, "hello.txt"), "utf8")).toBe("hi");
  }, 30_000);

  it("skips a mirror whose bytes do not match the sha256 for the next one", async () => {
    const wrong = serve(Buffer.from("not the release"));
    const right = serve(tarGz);
    const r = await fetchSource(`pkg.tar.gz ${sum} ${wrong.url} ${right.url}`);
    wrong.close();
    right.close();
    expect(r.code).toBe(0);
    expect([wrong.hits(), right.hits()]).toEqual([1, 1]);
    expect(readFileSync(join(r.dir, "hello.txt"), "utf8")).toBe("hi");
  }, 30_000);

  it("fails when no URL serves the pinned bytes", async () => {
    const wrong = serve(Buffer.from("not the release"));
    const r = await fetchSource(`pkg.tar.gz ${sum} ${wrong.url}`);
    wrong.close();
    expect(r.code).not.toBe(0);
  }, 30_000);

  it("takes a git source only at its pinned commit", async () => {
    const stale = gitRepo("old.txt");
    const pinned = gitRepo("pinned.txt");
    const r = await fetchSource(`x264 ${pinned.commit} ${stale.url} ${pinned.url}`);
    expect(r.code).toBe(0);
    expect(readFileSync(join(r.dir, "x264", "pinned.txt"), "utf8")).toBe("pinned.txt");
  }, 30_000);
});
