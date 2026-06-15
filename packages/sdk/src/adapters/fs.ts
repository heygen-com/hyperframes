import type { PersistAdapter, PersistVersionEntry } from "./types.js";
import type { PersistErrorEvent } from "../types.js";
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";

export interface FsAdapterOptions {
  /** Root directory for composition files */
  root: string;
  /** Max versions to keep per file. Default: 20 */
  maxVersions?: number;
}

const DEFAULT_MAX_VERSIONS = 20;

class FsAdapter implements PersistAdapter {
  private readonly root: string;
  private readonly maxVersions: number;
  private errorHandlers: Array<(e: PersistErrorEvent) => void> = [];
  private readonly inflightWrites = new Set<Promise<void>>();
  private versionCounter = 0;
  private appendVersionQueue = Promise.resolve();

  constructor(opts: FsAdapterOptions) {
    this.root = opts.root;
    this.maxVersions = opts.maxVersions ?? DEFAULT_MAX_VERSIONS;
  }

  async read(path: string): Promise<string | undefined> {
    try {
      return await readFile(this.abs(path), "utf8");
    } catch (err: unknown) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const p = this.doWrite(path, content);
    this.inflightWrites.add(p);
    try {
      await p;
    } finally {
      this.inflightWrites.delete(p);
    }
  }

  private async doWrite(path: string, content: string): Promise<void> {
    const abs = this.abs(path);
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
    } catch (err) {
      for (const h of this.errorHandlers) h({ error: { message: String(err), cause: err } });
      return;
    }
    // Version archival is best-effort — failure here does not affect the primary write.
    try {
      await this.appendVersion(path, content);
    } catch {
      // version history unavailable; primary write succeeded
    }
  }

  async flush(): Promise<void> {
    await Promise.all([...this.inflightWrites]);
  }

  async listVersions(path: string): Promise<PersistVersionEntry[]> {
    const dir = this.versionsDir(path);
    try {
      const entries = await readdir(dir);
      const sorted = entries
        .filter((f) => f.endsWith(".html"))
        .sort()
        .reverse();
      return Promise.all(
        sorted.map(async (f) => ({
          key: f.replace(/\.html$/, ""),
          content: await readFile(join(dir, f), "utf8"),
          timestamp: Number(f.split("_")[0]),
        })),
      );
    } catch {
      return [];
    }
  }

  async loadFrom(path: string, versionKey: string): Promise<string | undefined> {
    try {
      return await readFile(join(this.versionsDir(path), `${versionKey}.html`), "utf8");
    } catch {
      return undefined;
    }
  }

  on(event: "persist:error", handler: (e: PersistErrorEvent) => void): () => void {
    if (event !== "persist:error") return () => {};
    this.errorHandlers.push(handler);
    return () => {
      const i = this.errorHandlers.indexOf(handler);
      if (i !== -1) this.errorHandlers.splice(i, 1);
    };
  }

  private abs(path: string): string {
    return join(this.root, path);
  }

  private versionsDir(path: string): string {
    return join(this.root, ".hf-versions", path);
  }

  private appendVersion(path: string, content: string): Promise<void> {
    this.appendVersionQueue = this.appendVersionQueue.then(() =>
      this.doAppendVersion(path, content),
    );
    return this.appendVersionQueue;
  }

  private async doAppendVersion(path: string, content: string): Promise<void> {
    const dir = this.versionsDir(path);
    await mkdir(dir, { recursive: true });
    // Pad counter to 6 digits so lexicographic sort = insertion order within same ms.
    const key = `${Date.now()}_${String(this.versionCounter++).padStart(6, "0")}`;
    await writeFile(join(dir, `${key}.html`), content, "utf8");
    // prune oldest beyond maxVersions
    const all = (await readdir(dir)).filter((f) => f.endsWith(".html")).sort();
    const excess = all.length - this.maxVersions;
    if (excess > 0) {
      await Promise.all(all.slice(0, excess).map((f) => unlink(join(dir, f)).catch(() => {})));
    }
  }
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

export function createFsAdapter(opts: FsAdapterOptions): PersistAdapter {
  return new FsAdapter(opts);
}
