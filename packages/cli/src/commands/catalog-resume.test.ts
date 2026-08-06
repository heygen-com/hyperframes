import { describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createFilePrimitiveInstallStateStore,
  createPrimitiveInstallIntent,
  filterPrimitiveCatalogItems,
  resumePrimitiveInstallExactlyOnce,
  type PendingPrimitiveInstall,
  type PrimitiveInstallStateStore,
} from "./catalog-resume.js";

function memoryStore(): PrimitiveInstallStateStore {
  let state: PendingPrimitiveInstall | null = null;
  return {
    load: async () => state,
    save: async (next) => {
      state = next;
    },
  };
}

// Anonymous discovery and resume invariants share one coordinator fixture.
// fallow-ignore-next-line unit-size
describe("catalog OAuth resume", () => {
  it("supports anonymous content-free discovery before selection", () => {
    const items = [
      { name: "thread-message-stack", title: "Thread Message Stack", description: "Conversation" },
      { name: "shader-wipe", title: "Shader Wipe", description: "Transition" },
    ];
    expect(filterPrimitiveCatalogItems(items, " conversation ").map((item) => item.name)).toEqual([
      "thread-message-stack",
    ]);
    expect(filterPrimitiveCatalogItems(items, "")).toEqual(items);
  });

  it("preserves a non-content search fingerprint and resumes the same selection exactly once", async () => {
    const store = memoryStore();
    const authenticate = vi.fn(async () => true);
    const install = vi.fn(async () => undefined);
    let authenticated = false;
    authenticate.mockImplementation(async () => {
      authenticated = true;
      return true;
    });
    const intent = createPrimitiveInstallIntent({
      itemName: "thread-message-stack",
      query: "private authored search text",
      artifactId: "21c28523-7487-43e1-927d-43a7fe855859",
      versionId: "1aa00c22-b508-4b81-a3a1-4702453d48c2",
      funnelId: "funnel-1",
      installId: "install-1",
    });

    expect(JSON.stringify(intent)).not.toContain("private authored search text");
    const deps = {
      store,
      isAuthenticated: async () => authenticated,
      authenticate,
      install,
    };
    await expect(resumePrimitiveInstallExactlyOnce(intent, deps)).resolves.toBe("installed");
    await expect(resumePrimitiveInstallExactlyOnce(intent, deps)).resolves.toBe(
      "already-installed",
    );
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ itemName: intent.itemName }));
  });

  it.each(["cancelled", "failed"] as const)(
    "installs nothing when OAuth is %s",
    async (outcome) => {
      const install = vi.fn(async () => undefined);
      const intent = createPrimitiveInstallIntent({
        itemName: "thread-message-stack",
        query: "thread",
        artifactId: "21c28523-7487-43e1-927d-43a7fe855859",
        versionId: "1aa00c22-b508-4b81-a3a1-4702453d48c2",
        funnelId: `funnel-${outcome}`,
        installId: `install-${outcome}`,
      });

      await expect(
        resumePrimitiveInstallExactlyOnce(intent, {
          store: memoryStore(),
          isAuthenticated: async () => false,
          authenticate: async () => outcome,
          install,
        }),
      ).resolves.toBe(outcome);
      expect(install).not.toHaveBeenCalled();
    },
  );

  it("atomically admits only one live installer across independent file-store owners", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-catalog-claim-"));
    const statePath = join(dir, "pending.json");
    const intent = createPrimitiveInstallIntent({
      itemName: "thread-message-stack",
      query: "thread",
      artifactId: "21c28523-7487-43e1-927d-43a7fe855859",
      versionId: "1aa00c22-b508-4b81-a3a1-4702453d48c2",
      installId: "concurrent-install",
    });
    let releaseFirst!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const install = vi.fn(async () => await blocked);
    const deps = (store: PrimitiveInstallStateStore) => ({
      store,
      isAuthenticated: async () => true,
      authenticate: async () => true,
      install,
    });

    try {
      const first = resumePrimitiveInstallExactlyOnce(
        intent,
        deps(createFilePrimitiveInstallStateStore(statePath)),
      );
      await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1));
      const second = resumePrimitiveInstallExactlyOnce(
        intent,
        deps(createFilePrimitiveInstallStateStore(statePath)),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(install).toHaveBeenCalledTimes(1);
      releaseFirst();
      await expect(Promise.all([first, second])).resolves.toEqual([
        "installed",
        "already-installed",
      ]);
    } finally {
      releaseFirst();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recovers a bounded stale claim left by a dead owner", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-catalog-recovery-"));
    const statePath = join(dir, "pending.json");
    const claimDir = `${statePath}.claim`;
    const intent = createPrimitiveInstallIntent({
      itemName: "thread-message-stack",
      query: "thread",
      artifactId: "21c28523-7487-43e1-927d-43a7fe855859",
      versionId: "1aa00c22-b508-4b81-a3a1-4702453d48c2",
      installId: "recovered-install",
    });
    const install = vi.fn(async () => undefined);

    try {
      mkdirSync(claimDir, { recursive: true });
      writeFileSync(
        join(claimDir, "owner.json"),
        JSON.stringify({ pid: 2_147_483_647, token: "dead-owner" }),
      );
      const stale = new Date(Date.now() - 60_000);
      utimesSync(claimDir, stale, stale);

      await expect(
        resumePrimitiveInstallExactlyOnce(intent, {
          store: createFilePrimitiveInstallStateStore(statePath, { staleClaimMs: 10 }),
          isAuthenticated: async () => true,
          authenticate: async () => true,
          install,
        }),
      ).resolves.toBe("installed");
      expect(install).toHaveBeenCalledTimes(1);
      expect(existsSync(claimDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("admits exactly one installer when two Bun processes race the same install id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-catalog-cross-process-"));
    const statePath = join(dir, "pending.json");
    const installLog = join(dir, "installs.log");
    const moduleUrl = pathToFileURL(join(import.meta.dirname, "catalog-resume.ts")).href;
    const childSource = `
      import { appendFileSync } from "node:fs";
      import { createFilePrimitiveInstallStateStore, createPrimitiveInstallIntent, resumePrimitiveInstallExactlyOnce } from ${JSON.stringify(moduleUrl)};
      const intent = createPrimitiveInstallIntent({ itemName: "thread-message-stack", query: "thread", artifactId: "21c28523-7487-43e1-927d-43a7fe855859", versionId: "1aa00c22-b508-4b81-a3a1-4702453d48c2", installId: "cross-process-install", funnelId: "cross-process-funnel" });
      const result = await resumePrimitiveInstallExactlyOnce(intent, {
        store: createFilePrimitiveInstallStateStore(${JSON.stringify(statePath)}, { pollMs: 5 }),
        isAuthenticated: async () => true,
        authenticate: async () => true,
        install: async () => { appendFileSync(${JSON.stringify(installLog)}, process.pid + "\\n"); await new Promise((resolve) => setTimeout(resolve, 150)); },
      });
      console.log(result);
    `;
    const runChild = async (): Promise<string> =>
      await new Promise((resolveChild, rejectChild) => {
        const child = spawn("bun", ["-e", childSource], { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += String(chunk)));
        child.stderr.on("data", (chunk) => (stderr += String(chunk)));
        child.once("error", rejectChild);
        child.once("exit", (code) => {
          if (code === 0) resolveChild(stdout.trim());
          else rejectChild(new Error(`child exited ${code}: ${stderr}`));
        });
      });

    try {
      const results = await Promise.all([runChild(), runChild()]);
      expect(results.sort()).toEqual(["already-installed", "installed"]);
      expect(readFileSync(installLog, "utf8").trim().split("\n")).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never reclaims a stale-looking claim while its owner process is alive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-catalog-live-owner-"));
    const statePath = join(dir, "pending.json");
    const claimDir = `${statePath}.claim`;
    const intent = createPrimitiveInstallIntent({
      itemName: "thread-message-stack",
      query: "thread",
      artifactId: "21c28523-7487-43e1-927d-43a7fe855859",
      versionId: "1aa00c22-b508-4b81-a3a1-4702453d48c2",
      installId: "live-owner-install",
    });
    const install = vi.fn(async () => undefined);
    try {
      mkdirSync(claimDir, { recursive: true });
      writeFileSync(
        join(claimDir, "owner.json"),
        JSON.stringify({ pid: process.pid, token: "live-owner" }),
      );
      const stale = new Date(Date.now() - 60_000);
      utimesSync(claimDir, stale, stale);
      await expect(
        resumePrimitiveInstallExactlyOnce(intent, {
          store: createFilePrimitiveInstallStateStore(statePath, {
            staleClaimMs: 10,
            claimWaitMs: 30,
            pollMs: 5,
          }),
          isAuthenticated: async () => true,
          authenticate: async () => true,
          install,
        }),
      ).rejects.toThrow(/already claimed/);
      expect(install).not.toHaveBeenCalled();
      expect(existsSync(claimDir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
