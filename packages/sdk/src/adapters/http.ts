import type { PersistAdapter, PersistVersionEntry } from "./types.js";
import type { PersistErrorEvent } from "../types.js";

export interface HttpAdapterOptions {
  /**
   * Base URL for the project files REST API, no trailing slash.
   * E.g. "/api/projects/proj-abc"
   */
  projectFilesUrl: string;
}

class HttpAdapter implements PersistAdapter {
  private readonly baseUrl: string;
  private readonly errorListeners: Array<(e: PersistErrorEvent) => void> = [];
  private readonly inflightWrites = new Set<Promise<void>>();

  constructor(opts: HttpAdapterOptions) {
    this.baseUrl = opts.projectFilesUrl;
  }

  async read(path: string): Promise<string | undefined> {
    const url = `${this.baseUrl}/files/${encodeURIComponent(path)}?optional=1`;
    const res = await fetch(url);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let data: { content?: string };
    try {
      data = (await res.json()) as { content?: string };
    } catch {
      return undefined;
    }
    return typeof data.content === "string" ? data.content : undefined;
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
    const url = `${this.baseUrl}/files/${encodeURIComponent(path)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: content,
      });
    } catch (err) {
      this.fireError(String(err), err);
      return;
    }
    if (!res.ok) {
      this.fireError(`HTTP ${res.status}`);
    }
  }

  async flush(): Promise<void> {
    await Promise.all([...this.inflightWrites]);
  }

  async listVersions(_path: string): Promise<PersistVersionEntry[]> {
    return [];
  }

  async loadFrom(_path: string, _versionKey: string): Promise<string | undefined> {
    return undefined;
  }

  on(event: "persist:error", handler: (e: PersistErrorEvent) => void): () => void {
    if (event !== "persist:error") return () => {};
    this.errorListeners.push(handler);
    return () => {
      const idx = this.errorListeners.indexOf(handler);
      if (idx !== -1) this.errorListeners.splice(idx, 1);
    };
  }

  private fireError(message: string, cause?: unknown): void {
    const error: PersistErrorEvent["error"] =
      cause !== undefined ? { message, cause } : { message };
    for (const l of this.errorListeners) l({ error });
  }
}

export function createHttpAdapter(opts: HttpAdapterOptions): PersistAdapter {
  return new HttpAdapter(opts);
}
