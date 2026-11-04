import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { ActiveServer } from "../server/portUtils.js";
import { PreviewServerPortMismatchError } from "../utils/studioSelectionClient.js";
import {
  PreviewPortUnavailableError,
  buildBackgroundPreviewArgs,
  listBackgroundPreviewStatuses,
  previewSessionPath,
  readBackgroundPreviewStatus,
  startBackgroundPreview,
  stopBackgroundPreview,
  writePreviewSession,
} from "./previewLifecycle.js";

const projectDir = resolve("/tmp/hyperframes-preview-lifecycle-project");
const server: ActiveServer = {
  port: 3210,
  projectName: "preview-lifecycle-project",
  projectDir,
  version: "test",
  pid: "4321",
};

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function savePreviewSession(stateHome: string): void {
  writePreviewSession(
    { pid: 4321, port: 3210, projectDir, logPath: "/tmp/preview.log" },
    stateHome,
  );
}

describe("preview status selection and logs", () => {
  const saved = {
    pid: 4321,
    wrapperIdentity: "wrapper-birth",
    port: 32600,
    projectDir,
    logPath: "/tmp/managed-preview.log",
  };
  const managed: ActiveServer = { ...server, port: saved.port, pidSource: "os" };

  it("prefers the saved preview over a lower sibling when the requested port is absent", async () => {
    const stateHome = tempDir("hf-preview-status-");
    writePreviewSession(saved, stateHome);
    const before = readFileSync(previewSessionPath(projectDir, stateHome), "utf8");
    const status = await readBackgroundPreviewStatus(projectDir, 32521, {
      stateHome,
      preferredPort: 32521,
      scan: async () => [{ ...managed, port: 32530, pid: "5555" }, managed],
      identity: () => saved.wrapperIdentity,
    });

    expect(status).toMatchObject({ port: 32600, pid: 4321, logPath: saved.logPath });
    expect(readFileSync(previewSessionPath(projectDir, stateHome), "utf8")).toBe(before);
  });

  it("prefers the exact requested endpoint regardless of the supplied discovery order", async () => {
    const stateHome = tempDir("hf-preview-status-");
    writePreviewSession(saved, stateHome);
    const requested = { ...managed, port: 32580, pid: "8888" };
    const status = await readBackgroundPreviewStatus(projectDir, requested.port, {
      stateHome,
      preferredPort: requested.port,
      scan: async () => [{ ...managed, port: 32530, pid: "5555" }, managed, requested],
    });

    expect(status).toMatchObject({ port: requested.port, pid: 8888 });
    expect(status).not.toHaveProperty("logPath");
  });

  it.each(["4321", "9876"])("keeps the log for a confirmed managed listener %s", async (pid) => {
    const stateHome = tempDir("hf-preview-status-");
    writePreviewSession(saved, stateHome);
    const status = await readBackgroundPreviewStatus(projectDir, saved.port, {
      stateHome,
      scan: async () => [{ ...managed, pid }],
      identity: () => saved.wrapperIdentity,
      isDescendant: (child, parent) => child === 9876 && parent === saved.pid,
    });

    expect(status).toMatchObject({ pid: Number(pid), port: saved.port, logPath: saved.logPath });
  });

  it.each([
    { name: "another listener", pid: "5555", identity: "wrapper-birth", recorded: "wrapper-birth" },
    {
      name: "a recycled wrapper",
      pid: "4321",
      identity: "another-birth",
      recorded: "wrapper-birth",
    },
    { name: "an unavailable identity", pid: "4321", identity: null, recorded: "wrapper-birth" },
    { name: "a legacy record", pid: "4321", identity: null, recorded: undefined },
    {
      name: "an unknown listener PID",
      pid: null,
      identity: "wrapper-birth",
      recorded: "wrapper-birth",
    },
  ])("does not attach a managed log to $name", async ({ pid, identity, recorded }) => {
    const stateHome = tempDir("hf-preview-status-");
    writePreviewSession({ ...saved, wrapperIdentity: recorded }, stateHome);
    const before = readFileSync(previewSessionPath(projectDir, stateHome), "utf8");
    const status = await readBackgroundPreviewStatus(projectDir, saved.port, {
      stateHome,
      scan: async () => [{ ...managed, pid }],
      identity: () => identity,
      isDescendant: () => false,
    });

    expect(status).toMatchObject({ port: saved.port, pid: pid === null ? null : Number(pid) });
    expect(status).not.toHaveProperty("logPath");
    expect(readFileSync(previewSessionPath(projectDir, stateHome), "utf8")).toBe(before);
  });

  it("does not trust a self-reported PID to associate a log", async () => {
    const stateHome = tempDir("hf-preview-status-");
    writePreviewSession(saved, stateHome);
    const status = await readBackgroundPreviewStatus(projectDir, saved.port, {
      stateHome,
      scan: async () => [{ ...managed, pidSource: "self-reported" }],
      identity: () => saved.wrapperIdentity,
    });

    expect(status).toMatchObject({ port: saved.port, pid: saved.pid });
    expect(status).not.toHaveProperty("logPath");
  });

  it("reports an unmanaged endpoint without inventing a log path", async () => {
    const stateHome = tempDir("hf-preview-status-");
    const status = await readBackgroundPreviewStatus(projectDir, managed.port, {
      stateHome,
      scan: async () => [managed],
    });

    expect(status).toMatchObject({ port: managed.port, pid: saved.pid });
    expect(status).not.toHaveProperty("logPath");
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
  });
});

/** Launch deps whose wrapper (PID 4321) brings up `server` (PID 9876) on spawn and takes it down on kill. */
function reachableChildDependencies(stateHome: string, { immortal = false } = {}) {
  let spawned = false;
  let killed = false;
  const liveServer = { ...server, pid: "9876" };
  return {
    scan: async () => (spawned && (immortal || !killed) ? [liveServer] : []),
    probe: async (port: number) =>
      port === liveServer.port && spawned && (immortal || !killed) ? liveServer : null,
    spawn: () => {
      spawned = true;
      return { pid: 4321, unref: vi.fn() };
    },
    sleep: async () => {},
    kill: vi.fn(() => {
      killed = true;
    }),
    isDescendant: (child: number, ancestor: number) => child === 9876 && ancestor === 4321,
    stateHome,
  };
}

async function expectStaleSessionRemoved(stateHome: string): Promise<void> {
  const status = await readBackgroundPreviewStatus(projectDir, 3002, {
    scan: async () => [],
    stateHome,
  });

  expect(status).toBeNull();
  expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
}

describe("background preview lifecycle", () => {
  it("keeps case-distinct project paths separate on case-sensitive platforms", () => {
    if (process.platform === "win32") return;
    const stateHome = tempDir("hf-preview-state-");

    expect(previewSessionPath("/tmp/Project", stateHome)).not.toBe(
      previewSessionPath("/tmp/project", stateHome),
    );
  });

  it("forces the detached child foreground without inheriting launcher-only flags", () => {
    expect(
      buildBackgroundPreviewArgs([
        "/opt/hyperframes/cli.js",
        "preview",
        projectDir,
        "--background",
        "--open",
        "--json",
      ]),
    ).toEqual([
      "/opt/hyperframes/cli.js",
      "preview",
      projectDir,
      "--foreground",
      "--no-open",
      "--force-new",
    ]);
  });

  it("makes the detached child start its own server, never reuse a sibling launch's", () => {
    const args = buildBackgroundPreviewArgs(["cli.js", "preview", projectDir, "--force-new"]);

    expect(args.filter((arg) => arg === "--force-new")).toHaveLength(1);
    expect(args.at(-1)).toBe("--force-new");
  });

  it("reuses an already-running server for the same project", async () => {
    const spawn = vi.fn();
    const scan = vi.fn(async () => [server]);

    const result = await startBackgroundPreview(projectDir, 3002, {
      argv: ["/opt/hyperframes/cli.js", "preview", projectDir, "--background"],
      execPath: "/usr/bin/node",
      scan,
      spawn,
      stateHome: tempDir("hf-preview-state-"),
    });

    expect(result).toMatchObject({ type: "reused", port: 3210 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("reuses a saved managed preview on a custom port without repeating --port", async () => {
    const stateHome = tempDir("hf-preview-state-");
    writePreviewSession(
      { pid: 4321, port: 41402, projectDir, logPath: "/tmp/custom.log" },
      stateHome,
    );
    const customServer = { ...server, port: 41402, browserGpuMode: "software" as const };
    const scan = vi.fn(async (startPort?: number) => (startPort === 41402 ? [customServer] : []));
    const spawn = vi.fn();

    const result = await startBackgroundPreview(projectDir, 3002, {
      scan,
      spawn,
      stateHome,
    });

    expect(result).toMatchObject({ type: "reused", port: 41402, pid: 4321 });
    expect(scan).toHaveBeenCalledExactlyOnceWith(41402);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([3021, 32521, 32522, 32620, 32621])(
    "bounds the explicit-port scan when the saved port is %s",
    async (savedPort) => {
      const stateHome = tempDir("hf-preview-state-");
      const requestedPort = 32521;
      const owned = { ...server, port: savedPort };
      const requested = { ...server, port: requestedPort, pid: "5555" };
      const servers = savedPort === requestedPort ? [requested] : [owned, requested];
      writePreviewSession(
        { pid: 4321, port: savedPort, projectDir, logPath: "/tmp/preview.log" },
        stateHome,
      );
      const scan = vi.fn(async (start = 3002) =>
        servers.filter((candidate) => candidate.port >= start && candidate.port < start + 100),
      );
      const probe = vi.fn(
        async (port: number) => servers.find((candidate) => candidate.port === port) ?? null,
      );
      const spawn = vi.fn();
      const kill = vi.fn();

      const result = await startBackgroundPreview(projectDir, requestedPort, {
        scan,
        probe,
        spawn,
        kill,
        stateHome,
        preferredPort: requestedPort,
      });

      expect(result).toMatchObject({ type: "reused", port: requestedPort, pid: 5555 });
      expect(scan).toHaveBeenCalledExactlyOnceWith(requestedPort);
      expect(probe.mock.calls).toEqual(
        savedPort < requestedPort || savedPort > 32620 ? [[savedPort]] : [],
      );
      expect(spawn).not.toHaveBeenCalled();
      expect(kill).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "bounds the explicit-port replacement scan through shutdown (force-new: %s)",
    async (forceNew) => {
      const stateHome = tempDir("hf-preview-state-");
      const owned = { ...server, port: 3021, browserGpuMode: "hardware" as const };
      const replacement = {
        ...server,
        port: 32521,
        pid: "5432",
        browserGpuMode: "software" as const,
      };
      const sibling = { ...replacement, port: 32522, pid: "8765" };
      writePreviewSession(
        { pid: 4321, port: owned.port, projectDir, logPath: "/tmp/preview.log" },
        stateHome,
      );
      let ownedRunning = true;
      let replacementRunning = false;
      let stopping = false;
      const scan = vi.fn(async (start = 3002) =>
        [
          sibling,
          ...(ownedRunning ? [owned] : []),
          ...(replacementRunning ? [replacement] : []),
        ].filter((candidate) => candidate.port >= start && candidate.port < start + 100),
      );
      const probe = vi.fn(async (port: number) =>
        ownedRunning && port === owned.port ? owned : null,
      );
      const kill = vi.fn((pid: number) => {
        expect(pid).toBe(4321);
        stopping = true;
      });
      const sleep = vi.fn(async () => {
        if (stopping) ownedRunning = false;
      });
      const spawn = vi.fn(() => {
        expect(ownedRunning).toBe(false);
        replacementRunning = true;
        return { pid: 5432, unref: vi.fn() };
      });

      const result = await startBackgroundPreview(projectDir, replacement.port, {
        browserGpuMode: "software",
        forceNew,
        preferredPort: replacement.port,
        kill,
        probe,
        scan,
        sleep,
        spawn,
        stateHome,
      });

      expect(result).toMatchObject({ type: "started", port: replacement.port, pid: 5432 });
      expect(scan.mock.calls.length).toBeGreaterThan(1);
      expect(scan.mock.calls.every(([port]) => port === replacement.port)).toBe(true);
      expect(probe.mock.calls.length).toBeGreaterThanOrEqual(4);
      expect(probe.mock.calls.every(([port]) => port === owned.port)).toBe(true);
      expect(kill).toHaveBeenCalledExactlyOnceWith(4321);
      expect(sleep).toHaveBeenCalledOnce();
      expect(spawn).toHaveBeenCalledOnce();
      expect(
        JSON.parse(readFileSync(previewSessionPath(projectDir, stateHome), "utf8")),
      ).toMatchObject({
        port: replacement.port,
        pid: 5432,
      });
    },
  );

  it("keeps explicit-port replacement blocked while the saved listener is still running", async () => {
    const stateHome = tempDir("hf-preview-state-");
    const owned = { ...server, port: 3021 };
    writePreviewSession(
      { pid: 4321, port: owned.port, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );
    const scan = vi.fn(async (start = 3002) =>
      owned.port >= start && owned.port < start + 100 ? [owned] : [],
    );
    const probe = vi.fn(async (port: number) => (port === owned.port ? owned : null));
    const spawn = vi.fn();
    const kill = vi.fn();

    await expect(
      startBackgroundPreview(projectDir, 32521, {
        forceNew: true,
        preferredPort: 32521,
        scan,
        probe,
        spawn,
        kill,
        sleep: async () => {},
        stateHome,
      }),
    ).rejects.toThrow("background preview did not stop");

    expect(scan.mock.calls.every(([port]) => port === 32521)).toBe(true);
    expect(probe.mock.calls.every(([port]) => port === owned.port)).toBe(true);
    expect(kill).toHaveBeenCalledExactlyOnceWith(4321);
    expect(spawn).not.toHaveBeenCalled();
    expect(
      JSON.parse(readFileSync(previewSessionPath(projectDir, stateHome), "utf8")),
    ).toMatchObject({
      port: owned.port,
      pid: 4321,
    });
  });

  it("throws a port-mismatch error when the caller explicitly requests a port the reused server isn't on", async () => {
    const spawn = vi.fn();
    const scan = vi.fn(async () => [server]);

    await expect(
      startBackgroundPreview(projectDir, 3002, {
        scan,
        spawn,
        stateHome: mkdtempSync(join(tmpdir(), "hf-preview-state-")),
        preferredPort: server.port + 1,
      }),
    ).rejects.toThrow(PreviewServerPortMismatchError);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("reuses normally when the caller's explicit port matches the reused server", async () => {
    const spawn = vi.fn();
    const scan = vi.fn(async () => [server]);

    const result = await startBackgroundPreview(projectDir, 3002, {
      scan,
      spawn,
      stateHome: mkdtempSync(join(tmpdir(), "hf-preview-state-")),
      preferredPort: server.port,
    });

    expect(result).toMatchObject({ type: "reused", port: server.port });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("discovers managed previews outside the default port scan and removes stale records", async () => {
    const stateHome = tempDir("hf-preview-state-");
    const otherProjectDir = resolve("/tmp/hyperframes-preview-managed-custom-port");
    const staleProjectDir = resolve("/tmp/hyperframes-preview-managed-stale");
    writePreviewSession(
      {
        pid: 8765,
        wrapperIdentity: "custom-wrapper-birth",
        port: 41402,
        projectDir: otherProjectDir,
        logPath: "/tmp/custom.log",
      },
      stateHome,
    );
    writePreviewSession(
      {
        pid: 9999,
        port: 45000,
        projectDir: staleProjectDir,
        logPath: "/tmp/stale.log",
      },
      stateHome,
    );

    const statuses = await listBackgroundPreviewStatuses({
      stateHome,
      identity: () => "custom-wrapper-birth",
      scan: async (startPort) =>
        startPort === 41402
          ? [
              {
                port: 41402,
                projectName: "managed-custom-port",
                projectDir: otherProjectDir,
                version: "test",
                pid: "8765",
                pidSource: "os",
              },
            ]
          : [],
    });

    expect(statuses).toEqual([
      {
        pid: 8765,
        port: 41402,
        projectDir: otherProjectDir,
        logPath: "/tmp/custom.log",
      },
    ]);
    expect(existsSync(previewSessionPath(staleProjectDir, stateHome))).toBe(false);
  });

  it("force-new waits for a different server instead of reusing the existing one", async () => {
    const replacement = { ...server, port: 3211, pid: "5432" };
    let scans = 0;
    const scan = vi.fn(async () => (++scans < 3 ? [server] : [server, replacement]));
    const spawn = vi.fn(() => ({ pid: 5432, unref: vi.fn() }));

    const result = await startBackgroundPreview(projectDir, 3002, {
      forceNew: true,
      scan,
      spawn,
      sleep: async () => {},
      stateHome: tempDir("hf-preview-state-"),
    });

    expect(result).toMatchObject({ type: "started", port: 3211, pid: 5432 });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it.each([
    ["force-new", true],
    ["a GPU-policy change", false],
  ])(
    "%s replaces a previously managed server instead of orphaning it",
    async (_label, forceNew) => {
      const stateHome = tempDir("hf-preview-state-");
      const oldServer = { ...server, port: 41490, browserGpuMode: "hardware" as const };
      writePreviewSession(
        { pid: 4321, port: 41490, projectDir, logPath: "/tmp/preview.log" },
        stateHome,
      );
      const replacement = {
        ...server,
        port: 41491,
        pid: "5432",
        browserGpuMode: "software" as const,
      };
      let oldRunning = true;
      let replacementRunning = false;
      const scan = vi.fn(async () =>
        oldRunning ? [oldServer] : replacementRunning ? [replacement] : [],
      );
      const probe = vi.fn(async (port: number) =>
        oldRunning && port === oldServer.port ? oldServer : null,
      );
      const kill = vi.fn((pid: number) => {
        if (pid === 4321) oldRunning = false;
      });
      const spawn = vi.fn(() => {
        replacementRunning = true;
        return { pid: 5432, unref: vi.fn() };
      });

      const result = await startBackgroundPreview(projectDir, 41491, {
        browserGpuMode: "software",
        forceNew,
        kill,
        probe,
        scan,
        sleep: async () => {},
        spawn,
        stateHome,
      });

      expect(scan).toHaveBeenNthCalledWith(1, 41490);
      expect(kill).toHaveBeenCalledWith(4321);
      expect(result).toMatchObject({ type: "started", port: 41491, pid: 5432 });
      expect(readFileSync(previewSessionPath(projectDir, stateHome), "utf8")).toContain(
        '"port": 41491',
      );
    },
  );

  it("replaces the owned preview instead of reusing an unmanaged policy-matching sibling", async () => {
    const stateHome = tempDir("hf-preview-state-");
    const owned = { ...server, port: 41490, browserGpuMode: "hardware" as const };
    const sibling = {
      ...server,
      port: 41491,
      pid: "8765",
      browserGpuMode: "software" as const,
    };
    const replacement = {
      ...server,
      port: 41492,
      pid: "5432",
      browserGpuMode: "software" as const,
    };
    writePreviewSession(
      { pid: 4321, port: owned.port, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );
    let ownedRunning = true;
    let replacementRunning = false;
    const scan = vi.fn(async () => [
      ...(ownedRunning ? [owned] : []),
      sibling,
      ...(replacementRunning ? [replacement] : []),
    ]);
    const probe = vi.fn(async (port: number) =>
      ownedRunning && port === owned.port ? owned : port === sibling.port ? sibling : null,
    );
    const kill = vi.fn((pid: number) => {
      if (pid === 4321) ownedRunning = false;
    });
    const spawn = vi.fn(() => {
      replacementRunning = true;
      return { pid: 5432, unref: vi.fn() };
    });

    const result = await startBackgroundPreview(projectDir, replacement.port, {
      browserGpuMode: "software",
      kill,
      probe,
      scan,
      sleep: async () => {},
      spawn,
      stateHome,
    });

    expect(kill).toHaveBeenCalledWith(4321);
    expect(spawn).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ type: "started", port: replacement.port, pid: 5432 });
  });

  it("launches the replacement when the owned server died on its own", async () => {
    const stateHome = tempDir("hf-preview-state-");
    const owned = { ...server, port: 41490 };
    const replacement = { ...server, port: 41491, pid: "5432" };
    writePreviewSession(
      { pid: 4321, port: owned.port, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );
    let scans = 0;
    let replacementRunning = false;
    const scan = vi.fn(async () => {
      scans += 1;
      const ownedNow = scans === 1 ? [owned] : [];
      return [...ownedNow, ...(replacementRunning ? [replacement] : [])];
    });
    const kill = vi.fn();
    const spawn = vi.fn(() => {
      replacementRunning = true;
      return { pid: 5432, unref: vi.fn() };
    });

    const result = await startBackgroundPreview(projectDir, replacement.port, {
      forceNew: true,
      kill,
      probe: async () => null,
      scan,
      sleep: async () => {},
      spawn,
      stateHome,
    });

    expect(kill).not.toHaveBeenCalled();
    expect(result).toMatchObject({ type: "started", port: replacement.port, pid: 5432 });
  });

  it("starts a replacement when the existing server uses a different GPU policy", async () => {
    const hardwareServer = { ...server, browserGpuMode: "hardware" as const };
    const softwareServer = {
      ...server,
      port: 3211,
      pid: "5432",
      browserGpuMode: "software" as const,
    };
    let replacementRunning = false;
    const scan = vi.fn(async () => [
      hardwareServer,
      ...(replacementRunning ? [softwareServer] : []),
    ]);
    const spawn = vi.fn(() => {
      replacementRunning = true;
      return { pid: 5432, unref: vi.fn() };
    });

    const result = await startBackgroundPreview(projectDir, 3002, {
      browserGpuMode: "software",
      scan,
      spawn,
      sleep: async () => {},
      stateHome: tempDir("hf-preview-state-"),
    });

    expect(result).toMatchObject({ type: "started", port: 3211, pid: 5432 });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("returns after a detached child becomes reachable and records its session", async () => {
    let spawned = false;
    const scan = vi.fn(async () => (spawned ? [server] : []));
    const unref = vi.fn();
    const spawn = vi.fn<
      NonNullable<NonNullable<Parameters<typeof startBackgroundPreview>[2]>["spawn"]>
    >(() => {
      spawned = true;
      return { pid: 4321, unref };
    });
    const stateHome = tempDir("hf-preview-state-");

    const result = await startBackgroundPreview(projectDir, 3002, {
      argv: ["/opt/hyperframes/cli.js", "preview", projectDir, "--background"],
      execPath: "/usr/bin/node",
      scan,
      spawn,
      sleep: async () => {},
      stateHome,
    });

    expect(result).toMatchObject({ type: "started", port: 3210, pid: 4321 });
    expect(spawn).toHaveBeenCalledOnce();
    const launch = spawn.mock.calls[0];
    expect(launch?.[0]).toBe("/usr/bin/node");
    expect(launch?.[1]).toEqual(expect.arrayContaining(["preview", projectDir, "--foreground"]));
    expect(launch?.[2].windowsHide).toBe(true);
    expect(launch?.[2].detached).toBe(true);
    expect(launch?.[2].stdio).toEqual(["ignore", expect.any(Number), expect.any(Number)]);
    expect(launch?.[2].env).toBe(process.env);
    expect(unref).toHaveBeenCalledOnce();
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(true);
  });

  it("reports the live server PID while retaining the wrapper PID for cleanup", async () => {
    const liveServer = { ...server, pid: "9876" };
    let spawned = false;
    const scan = vi.fn(async () => (spawned ? [liveServer] : []));
    const stateHome = tempDir("hf-preview-state-");

    const result = await startBackgroundPreview(projectDir, 3002, {
      scan,
      spawn: () => {
        spawned = true;
        return { pid: 4321, unref: vi.fn() };
      },
      isDescendant: (child, ancestor) => child === 9876 && ancestor === 4321,
      stateHome,
    });

    expect(result).toMatchObject({ type: "started", pid: 9876 });
    expect(
      JSON.parse(readFileSync(previewSessionPath(projectDir, stateHome), "utf8")),
    ).toMatchObject({ pid: 4321 });
  });

  it("reports the explicitly requested port when the detached child binds it", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    const dependencies = reachableChildDependencies(stateHome);

    const result = await startBackgroundPreview(projectDir, server.port, {
      ...dependencies,
      preferredPort: server.port,
    });

    expect(result).toMatchObject({ type: "started", port: server.port, pid: 9876 });
    expect(dependencies.kill).not.toHaveBeenCalled();
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(true);
  });

  it("reaps a detached child that could not bind the explicitly requested port", async () => {
    // The child scans upward from --port and lands on the next free port.
    const requestedPort = server.port - 1;
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    const dependencies = reachableChildDependencies(stateHome);

    const launch = startBackgroundPreview(projectDir, requestedPort, {
      ...dependencies,
      preferredPort: requestedPort,
    });

    await expect(launch).rejects.toThrow(PreviewPortUnavailableError);
    await expect(launch).rejects.toMatchObject({ requestedPort, boundPort: server.port });
    // The wrapper PID is reaped, not the server's self-reported PID.
    expect(dependencies.kill).toHaveBeenCalledExactlyOnceWith(4321);
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
  });

  it("fails loudly when the reaped child keeps serving the substitute port", async () => {
    const requestedPort = server.port - 1;
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    const dependencies = reachableChildDependencies(stateHome, { immortal: true });

    await expect(
      startBackgroundPreview(projectDir, requestedPort, {
        ...dependencies,
        preferredPort: requestedPort,
      }),
    ).rejects.toThrow(/did not stop after failing to bind port/);
    expect(dependencies.kill).toHaveBeenCalledExactlyOnceWith(4321);
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
  });

  it("two launches at once each keep the server their own child started", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    // A's server (3002) answers only after B's (3003) has appeared, and after A's pre-launch snapshot.
    const children: Record<number, ActiveServer & { after: number }> = {
      4321: { ...server, port: 3002, pid: "9876", after: 3 },
      5555: { ...server, port: 3003, pid: "7777", after: 0 },
    };
    const parent: Record<number, number> = { 9876: 4321, 7777: 5555 };
    const spawnedAt = new Map<number, number>();
    let scans = 0;
    let secondSpawned!: () => void;
    const secondUp = new Promise<void>((done) => (secondSpawned = done));
    const scan = async () => {
      scans++;
      return [...spawnedAt]
        .filter(([wrapper, at]) => scans - at > children[wrapper]!.after)
        .map(([wrapper]) => children[wrapper]!);
    };
    const launch = (wrapper: number, sleep: () => Promise<void>, preferredPort?: number) =>
      startBackgroundPreview(projectDir, 3002, {
        scan,
        spawn: () => {
          spawnedAt.set(wrapper, scans);
          if (wrapper === 5555) secondSpawned();
          return { pid: wrapper, unref: vi.fn() };
        },
        sleep,
        kill: vi.fn(),
        isDescendant: (child: number, ancestor: number) => parent[child] === ancestor,
        stateHome,
        preferredPort,
      });

    const first = launch(4321, () => secondUp, 3002);
    await vi.waitFor(() => expect(spawnedAt.has(4321)).toBe(true));
    const second = launch(5555, async () => {});

    await expect(first).resolves.toMatchObject({ type: "started", port: 3002, pid: 9876 });
    await expect(second).resolves.toMatchObject({ type: "started", port: 3003, pid: 7777 });
  });

  it("keeps the next free port when no explicit port was requested", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    const dependencies = reachableChildDependencies(stateHome);

    const result = await startBackgroundPreview(projectDir, server.port - 1, dependencies);

    expect(result).toMatchObject({ type: "started", port: server.port });
    expect(dependencies.kill).not.toHaveBeenCalled();
  });

  it("reuses the same-project server on the explicit port when several are running", async () => {
    const sibling = { ...server, port: server.port + 1, pid: "5555" };
    const spawn = vi.fn();

    const result = await startBackgroundPreview(projectDir, 3002, {
      scan: async () => [server, sibling],
      spawn,
      stateHome: mkdtempSync(join(tmpdir(), "hf-preview-state-")),
      preferredPort: sibling.port,
    });

    expect(result).toMatchObject({ type: "reused", port: sibling.port, pid: 5555 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("reuses the unmanaged sibling on the explicit port instead of rejecting against the owned server", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    const owned = { ...server, port: 3002 };
    const sibling = { ...server, port: 3003, pid: "5555" };
    writePreviewSession(
      { pid: 4321, port: owned.port, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );
    const spawn = vi.fn();
    const kill = vi.fn();

    const result = await startBackgroundPreview(projectDir, sibling.port, {
      kill,
      scan: async () => [sibling],
      probe: async (port) => (port === owned.port ? owned : null),
      spawn,
      stateHome,
      preferredPort: sibling.port,
    });

    expect(result).toMatchObject({ type: "reused", port: sibling.port, pid: 5555 });
    expect(spawn).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });

  it("lists every same-project server in the port-mismatch error, not just the reuse candidate", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    const owned = { ...server, port: 3002 };
    const sibling = { ...server, port: 3004, pid: "5555" };
    const foreign = {
      ...server,
      port: 3003,
      projectDir: resolve("/tmp/hyperframes-preview-lifecycle-other"),
      pid: "7777",
    };
    writePreviewSession(
      { pid: 4321, port: owned.port, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );
    const spawn = vi.fn();

    const failure = await startBackgroundPreview(projectDir, foreign.port, {
      scan: async () => [sibling, foreign],
      probe: async (port) => (port === owned.port ? owned : null),
      spawn,
      stateHome,
      preferredPort: foreign.port,
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(PreviewServerPortMismatchError);
    expect(failure).toMatchObject({ requestedPort: 3003, ports: [3002, 3004] });
    expect((failure as Error).message).toContain("add --force-new or run --stop first");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("reuses a same-project server on an explicit port outside the saved port's scan window", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    const owned = { ...server, port: 3002 };
    const farSibling = { ...server, port: 3500, pid: "5555" };
    writePreviewSession(
      { pid: 4321, port: owned.port, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );
    const spawn = vi.fn();
    const probe = vi.fn(async (port: number) => (port === owned.port ? owned : null));

    const result = await startBackgroundPreview(projectDir, farSibling.port, {
      scan: async () => [farSibling],
      probe,
      spawn,
      stateHome,
      preferredPort: farSibling.port,
    });

    expect(result).toMatchObject({ type: "reused", port: farSibling.port, pid: 5555 });
    expect(probe).toHaveBeenCalledExactlyOnceWith(owned.port);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("replaces the owned server on the explicit port when the GPU policy changes", async () => {
    const stateHome = mkdtempSync(join(tmpdir(), "hf-preview-state-"));
    const owned = { ...server, port: 3002, browserGpuMode: "hardware" as const };
    const replacement = { ...server, port: 3002, pid: "5432", browserGpuMode: "software" as const };
    writePreviewSession(
      { pid: 4321, port: owned.port, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );
    let ownedRunning = true;
    let replacementRunning = false;
    const scan = vi.fn(async () => [
      ...(ownedRunning ? [owned] : []),
      ...(replacementRunning ? [replacement] : []),
    ]);
    const probe = vi.fn(async (port: number) =>
      port === owned.port && ownedRunning ? owned : null,
    );
    const kill = vi.fn((pid: number) => {
      if (pid === 4321) ownedRunning = false;
    });
    const spawn = vi.fn(() => {
      replacementRunning = true;
      return { pid: 5432, unref: vi.fn() };
    });

    const result = await startBackgroundPreview(projectDir, 3002, {
      browserGpuMode: "software",
      kill,
      probe,
      scan,
      sleep: async () => {},
      spawn,
      stateHome,
      preferredPort: 3002,
    });

    expect(kill).toHaveBeenCalledWith(4321);
    expect(spawn).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ type: "started", port: 3002, pid: 5432 });
  });

  it("stops waiting when the detached child exits and reports its exit and log", async () => {
    const stateHome = tempDir("hf-preview-state-");
    const kill = vi.fn();
    const scan = vi.fn(async () => []);
    let onExit: ((code: number | null, signal: string | null) => void) | undefined;

    await expect(
      startBackgroundPreview(projectDir, 3002, {
        scan,
        spawn: (_command, _args, options) => {
          writeSync(
            options.stdio[1],
            "\u001b[?25hError: listen EPERM: operation not permitted 127.0.0.1:3002\n",
          );
          return { pid: 4321, unref: vi.fn(), once: (_event, listener) => (onExit = listener) };
        },
        sleep: async () => onExit?.(1, null),
        kill,
        stateHome,
      }),
    ).rejects.toThrow(/exited \(exit code 1\) before it was ready[\s\S]*\nError: listen EPERM/);

    expect(kill).not.toHaveBeenCalled();
    expect(scan.mock.calls.length).toBeLessThan(5);
  });

  it("keeps its records under LOCALAPPDATA on Windows, not a Unix-style ~/.local/state", () => {
    const localAppData = tempDir("hf-localappdata-");
    vi.stubEnv("XDG_STATE_HOME", "");
    vi.stubEnv("LOCALAPPDATA", localAppData);
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    onTestFinished(() => {
      vi.unstubAllEnvs();
      if (platform) Object.defineProperty(process, "platform", platform);
    });

    expect(previewSessionPath(projectDir).startsWith(localAppData)).toBe(true);
  });

  it("starts the preview when the log's folder refuses it, and names the path", async () => {
    const blocker = join(tempDir("hf-preview-state-"), "not-a-folder");
    writeFileSync(blocker, "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    let stdio: unknown;

    await expect(
      startBackgroundPreview(projectDir, 3002, {
        scan: async () => [],
        spawn: (_command, _args, options) => {
          stdio = options.stdio;
          return { pid: 4321, unref: vi.fn() };
        },
        sleep: async () => {},
        kill: vi.fn(),
        stateHome: blocker,
      }),
    ).rejects.toThrow(/did not become ready/i);

    expect(stdio).toEqual(["ignore", expect.any(Number), expect.any(Number)]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(blocker));
  });

  it("reaps a detached child that never becomes reachable without recording ownership", async () => {
    const stateHome = tempDir("hf-preview-state-");
    const kill = vi.fn();

    await expect(
      startBackgroundPreview(projectDir, 3002, {
        scan: async () => [],
        spawn: () => ({ pid: 4321, unref: vi.fn() }),
        sleep: async () => {},
        kill,
        stateHome,
      }),
    ).rejects.toThrow(/did not become ready/i);

    expect(kill).toHaveBeenCalledOnce();
    expect(kill).toHaveBeenCalledWith(4321);
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
  });

  it("removes a stale session when no matching server or process survives", async () => {
    const stateHome = tempDir("hf-preview-state-");
    writePreviewSession(
      { pid: 999_999, port: 3210, projectDir, logPath: "/tmp/missing.log" },
      stateHome,
    );

    await expectStaleSessionRemoved(stateHome);
  });

  it("removes stale session metadata when its PID is alive but no server proves ownership", async () => {
    const stateHome = tempDir("hf-preview-state-");
    savePreviewSession(stateHome);

    await expectStaleSessionRemoved(stateHome);
  });

  it.each([undefined, 32521])(
    "keeps a live preview's record after a missed status probe (port: %s)",
    async (preferredPort) => {
      // A server whose event loop is briefly blocked (a Puppeteer thumbnail
      // capture will do it) answers nothing for a second or two. Retiring the
      // record on that destroys the wrapperIdentity that is the only PID-reuse
      // guard `--stop` has, and it never comes back.
      const stateHome = tempDir("hf-preview-state-");
      writePreviewSession(
        {
          pid: 4321,
          wrapperIdentity: "posix:birth",
          port: 3210,
          projectDir,
          logPath: "/tmp/p.log",
        },
        stateHome,
      );

      const status = await readBackgroundPreviewStatus(projectDir, preferredPort ?? 3002, {
        scan: async () => [],
        probe: async () => null,
        identity: () => "posix:birth",
        isSignalable: () => true,
        stateHome,
        preferredPort,
      });

      expect(status).toBeNull();
      expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(true);
    },
  );

  it("keeps a live preview's record when the identity lookup gives no answer", async () => {
    // `processIdentity` catches every failure into `null`, and on Windows and
    // macOS that failure is a subprocess timeout on a LIVE process — under the
    // same load that made the HTTP probe miss. Treating no-answer as
    // "recycled" destroyed the only PID-reuse guard `--stop` has.
    const stateHome = tempDir("hf-preview-state-");
    writePreviewSession(
      { pid: 4321, wrapperIdentity: "posix:birth", port: 3210, projectDir, logPath: "/tmp/p.log" },
      stateHome,
    );

    const status = await readBackgroundPreviewStatus(projectDir, 3002, {
      scan: async () => [],
      identity: () => null,
      isSignalable: () => true,
      stateHome,
    });

    expect(status).toBeNull();
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(true);
  });

  it("retires the record when the PID cannot be signalled at all", async () => {
    // Gone is gone: no birth token needed, and no subprocess spawned for it.
    const stateHome = tempDir("hf-preview-state-");
    writePreviewSession(
      { pid: 4321, wrapperIdentity: "posix:birth", port: 3210, projectDir, logPath: "/tmp/p.log" },
      stateHome,
    );
    const identity = vi.fn(() => "posix:birth");

    const status = await readBackgroundPreviewStatus(projectDir, 3002, {
      scan: async () => [],
      identity,
      isSignalable: () => false,
      stateHome,
    });

    expect(status).toBeNull();
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
    expect(identity).not.toHaveBeenCalled();
  });

  it("retires the record once the wrapper PID has been recycled", async () => {
    const stateHome = tempDir("hf-preview-state-");
    writePreviewSession(
      { pid: 4321, wrapperIdentity: "posix:birth", port: 3210, projectDir, logPath: "/tmp/p.log" },
      stateHome,
    );

    const status = await readBackgroundPreviewStatus(projectDir, 3002, {
      scan: async () => [],
      identity: () => "posix:someone-else",
      isSignalable: () => true,
      stateHome,
    });

    expect(status).toBeNull();
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
  });

  it("never leaves a partial session record for a concurrent reader", () => {
    const stateHome = tempDir("hf-preview-state-");
    savePreviewSession(stateHome);
    const path = previewSessionPath(projectDir, stateHome);

    writePreviewSession({ pid: 55, port: 3211, projectDir, logPath: "/tmp/two.log" }, stateHome);

    // Written through a temp file and renamed, so a reader mid-write sees the
    // whole previous record rather than truncated JSON it would then delete.
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ pid: 55, port: 3211 });
    expect(
      readdirSync(join(stateHome, "hyperframes", "previews")).filter((n) => n.endsWith(".tmp")),
    ).toHaveLength(0);
  });

  it("uses the recorded custom port when status is called without repeating --port", async () => {
    const stateHome = tempDir("hf-preview-state-");
    savePreviewSession(stateHome);
    const scan = vi.fn(async () => [server]);

    const status = await readBackgroundPreviewStatus(projectDir, 3002, {
      scan,
      stateHome,
    });

    expect(status?.port).toBe(3210);
    expect(scan).toHaveBeenCalledExactlyOnceWith(3210);
  });

  it.each([3021, 32521, 32620, 32621])(
    "bounds explicit status discovery when the saved port is %s",
    async (savedPort) => {
      const stateHome = tempDir("hf-preview-state-");
      const requestedPort = 32521;
      const savedServer = { ...server, port: savedPort };
      const requested = { ...server, port: requestedPort, pid: "5555" };
      const servers = savedPort === requestedPort ? [requested] : [savedServer, requested];
      writePreviewSession(
        { pid: 4321, port: savedPort, projectDir, logPath: "/tmp/preview.log" },
        stateHome,
      );
      const scan = vi.fn(async (start = 3002) =>
        servers
          .filter((candidate) => candidate.port >= start && candidate.port < start + 100)
          .sort((a, b) => a.port - b.port),
      );
      const probe = vi.fn(
        async (port: number) => servers.find((candidate) => candidate.port === port) ?? null,
      );

      const status = await readBackgroundPreviewStatus(projectDir, requestedPort, {
        scan,
        probe,
        stateHome,
        preferredPort: requestedPort,
      });

      expect(status).toMatchObject({ port: requestedPort, pid: 5555 });
      expect(scan).toHaveBeenCalledExactlyOnceWith(requestedPort);
      expect(probe.mock.calls).toEqual(
        savedPort < requestedPort || savedPort > 32620 ? [[savedPort]] : [],
      );
      expect(
        JSON.parse(readFileSync(previewSessionPath(projectDir, stateHome), "utf8")),
      ).toMatchObject({
        port: savedPort,
        pid: 4321,
      });
    },
  );

  it("finds a saved preview outside the explicit status range without reporting another project", async () => {
    const stateHome = tempDir("hf-preview-state-");
    savePreviewSession(stateHome);
    const scan = vi.fn(async () => [{ ...server, port: 32521, projectDir: `${projectDir}-other` }]);
    const probe = vi.fn(async (port: number) => (port === server.port ? server : null));

    const status = await readBackgroundPreviewStatus(projectDir, 32521, {
      scan,
      probe,
      stateHome,
      preferredPort: 32521,
    });

    expect(status).toMatchObject({ port: server.port, pid: 4321 });
    expect(scan).toHaveBeenCalledExactlyOnceWith(32521);
    expect(probe).toHaveBeenCalledExactlyOnceWith(server.port);
  });

  it.each([3021, 32521])(
    "only probes the saved port %s for an explicit stop",
    async (savedPort) => {
      const stateHome = tempDir("hf-preview-state-");
      writePreviewSession(
        { pid: 4321, port: savedPort, projectDir, logPath: "/tmp/preview.log" },
        stateHome,
      );
      let running = true;
      const owned = { ...server, port: savedPort };
      const scan = vi.fn(async () => [{ ...server, port: 32522, pid: "8765" }]);
      const probe = vi.fn(async (port: number) => (running && port === savedPort ? owned : null));
      const kill = vi.fn(() => {
        running = false;
      });

      expect(
        await stopBackgroundPreview(projectDir, 32521, {
          scan,
          probe,
          kill,
          stateHome,
          preferredPort: 32521,
        }),
      ).toBe(true);

      expect(scan).not.toHaveBeenCalled();
      expect(probe.mock.calls).toEqual([[savedPort], [savedPort]]);
      expect(kill).toHaveBeenCalledExactlyOnceWith(4321);
      expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
    },
  );

  it("discovers within the explicit stop range when no session was saved", async () => {
    const stateHome = tempDir("hf-preview-state-");
    const discovered = { ...server, port: 32522 };
    const scan = vi.fn(async () => [discovered]);
    const probe = vi.fn(async () => null);
    const kill = vi.fn();

    expect(
      await stopBackgroundPreview(projectDir, 32521, {
        scan,
        probe,
        kill,
        stateHome,
        preferredPort: 32521,
      }),
    ).toBe(true);

    expect(scan).toHaveBeenCalledExactlyOnceWith(32521);
    expect(probe).toHaveBeenCalledExactlyOnceWith(discovered.port);
    expect(kill).toHaveBeenCalledExactlyOnceWith(4321);
  });

  it("stops only the matching project server and waits until it is unreachable", async () => {
    let running = true;
    let stopping = false;
    const scan = vi.fn(async () => (running ? [server] : []));
    const probe = vi.fn(async (port: number) => (running && port === server.port ? server : null));
    const kill = vi.fn(() => {
      stopping = true;
    });
    const sleep = vi.fn(async () => {
      if (stopping) running = false;
    });

    const result = await stopBackgroundPreview(projectDir, 3002, {
      scan,
      probe,
      kill,
      sleep,
      stateHome: tempDir("hf-preview-state-"),
    });

    expect(result).toBe(true);
    expect(kill).toHaveBeenCalledWith(4321);
    expect(scan).toHaveBeenCalledOnce();
    expect(probe.mock.calls).toEqual([[server.port], [server.port]]);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("does not kill an unmatched saved PID that may have been reused", async () => {
    const stateHome = tempDir("hf-preview-state-");
    savePreviewSession(stateHome);
    const kill = vi.fn();

    const result = await stopBackgroundPreview(projectDir, 3002, {
      scan: async () => [],
      probe: async () => null,
      kill,
      stateHome,
    });

    expect(result).toBe(false);
    expect(kill).not.toHaveBeenCalled();
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
  });

  it("refuses to stop when the live server cannot prove its own PID", async () => {
    const stateHome = tempDir("hf-preview-state-");
    writePreviewSession(
      { pid: 4321, port: 3210, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );
    const scan = vi.fn(async () => [{ ...server, pid: null }]);
    const kill = vi.fn();

    await expect(
      stopBackgroundPreview(projectDir, 3002, {
        scan,
        probe: async () => ({ ...server, pid: null }),
        kill,
        sleep: async () => {},
        stateHome,
      }),
    ).rejects.toThrow(/ownership/i);

    expect(kill).not.toHaveBeenCalled();
  });

  it("reaps the saved wrapper when the live server is proven to be its descendant", async () => {
    const stateHome = tempDir("hf-preview-state-");
    writePreviewSession(
      {
        pid: 4321,
        wrapperIdentity: "wrapper-birth",
        port: 3210,
        projectDir,
        logPath: "/tmp/preview.log",
      },
      stateHome,
    );
    let running = true;
    const scan = vi.fn(async () => (running ? [{ ...server, pid: "9876" }] : []));
    const kill = vi.fn((pid: number) => {
      if (pid === 4321) running = false;
    });

    const result = await stopBackgroundPreview(projectDir, 3002, {
      scan,
      probe: async (port) => (running && port === server.port ? { ...server, pid: "9876" } : null),
      kill,
      isDescendant: (childPid, ancestorPid) => childPid === 9876 && ancestorPid === 4321,
      identity: (pid) => (pid === 4321 ? "wrapper-birth" : null),
      sleep: async () => {},
      stateHome,
    });

    expect(result).toBe(true);
    expect(kill.mock.calls).toEqual([[4321]]);
  });

  it("kills only the live server when the saved wrapper birth identity has changed", async () => {
    const stateHome = tempDir("hf-preview-state-");
    writePreviewSession(
      {
        pid: 4321,
        wrapperIdentity: "original-wrapper-birth",
        port: 3210,
        projectDir,
        logPath: "/tmp/preview.log",
      },
      stateHome,
    );
    let running = true;
    const scan = vi.fn(async () => (running ? [{ ...server, pid: "9876" }] : []));
    const kill = vi.fn((pid: number) => {
      if (pid === 9876) running = false;
    });

    const result = await stopBackgroundPreview(projectDir, 3002, {
      scan,
      probe: async (port) => (running && port === server.port ? { ...server, pid: "9876" } : null),
      kill,
      isDescendant: () => true,
      identity: () => "reused-pid-birth",
      sleep: async () => {},
      stateHome,
    });

    expect(result).toBe(true);
    expect(kill.mock.calls).toEqual([[9876]]);
  });

  it("fails loudly when the server remains reachable after stop", async () => {
    const stateHome = tempDir("hf-preview-state-");
    writePreviewSession(
      { pid: 4321, port: 3210, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );

    await expect(
      stopBackgroundPreview(projectDir, 3002, {
        scan: async () => [server],
        probe: async () => server,
        kill: vi.fn(),
        sleep: async () => {},
        stateHome,
      }),
    ).rejects.toThrow(/did not stop/i);
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(true);
  });

  it("verifies the owned port stopped even when another server serves the same project", async () => {
    const stateHome = tempDir("hf-preview-state-");
    const owned = { ...server, port: 41490 };
    const sibling = { ...server, port: 41491, pid: "8765" };
    writePreviewSession(
      { pid: 4321, port: owned.port, projectDir, logPath: "/tmp/preview.log" },
      stateHome,
    );
    let ownedRunning = true;
    const scan = vi.fn(async () => [...(ownedRunning ? [owned] : []), sibling]);
    const kill = vi.fn((pid: number) => {
      if (pid === 4321) ownedRunning = false;
    });

    const stopped = await stopBackgroundPreview(projectDir, owned.port, {
      kill,
      scan,
      probe: async (port) =>
        ownedRunning && port === owned.port ? owned : port === sibling.port ? sibling : null,
      sleep: async () => {},
      stateHome,
    });

    expect(stopped).toBe(true);
    expect(kill).toHaveBeenCalledWith(4321);
    expect(existsSync(previewSessionPath(projectDir, stateHome))).toBe(false);
  });
});
