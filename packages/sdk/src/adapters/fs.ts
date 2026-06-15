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

let _versionCounter = 0;

class FsAdapter implements PersistAdapter {
  private readonly root: string;
  private readonly maxVersions: number;
  private errorHandlers: Array<(e: PersistErrorEvent) => void> = [];
  private readonly inflightWrites = new Set<Promise<void>>();
  private _writeLocks = new Map<string, Promise<void>>();

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
    try {
      const abs = this.abs(path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
      await this.appendVersion(path, content);
    } catch (err) {
      for (const h of this.errorHandlers) h({ error: { message: String(err), cause: err } });
    }
  }

  async flush(): Promise<void> {
    // Promise.all rejects on the first write failure; per-write errors are also
    // surfaced individually through the persist:error event channel.
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
        sorted.map(async (f) => {
          const key = f.replace(/\.html$/, "");
          return {
            key,
            content: await readFile(join(dir, f), "utf8"),
            timestamp: Number(key.split("-")[0]),
          };
        }),
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

  private async appendVersion(path: string, content: string): Promise<void> {
    const prior = this._writeLocks.get(path) ?? Promise.resolve();
    const next = prior.then(() => this._doAppendVersion(path, content));
    this._writeLocks.set(
      path,
      next.catch(() => {}),
    );
    return next;
  }

  private async _doAppendVersion(path: string, content: string): Promise<void> {
    const dir = this.versionsDir(path);
    await mkdir(dir, { recursive: true });
    const key = `${Date.now()}-${String(++_versionCounter).padStart(4, "0")}`;
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
