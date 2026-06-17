import type { PersistAdapter, PersistVersionEntry } from "./types.js";
import type { PersistErrorEvent } from "../types.js";

export interface HttpAdapterOptions {
  /**
   * Base URL for the project files REST API, no trailing slash.
   * E.g. "/api/projects/proj-abc"
   */
  projectFilesUrl: string;
  /**
   * Extra headers to include on every PUT write request.
   * Pass a function to compute them lazily (e.g. to refresh a bearer token on each request).
   * Useful for cross-origin or CLI contexts where ambient cookies are not available.
   */
  headers?: HeadersInit | (() => HeadersInit);
}

class HttpAdapter implements PersistAdapter {
  private readonly baseUrl: string;
  private readonly extraHeaders?: HttpAdapterOptions["headers"];
  private readonly errorListeners: Array<(e: PersistErrorEvent) => void> = [];
  private readonly inflightWrites = new Set<Promise<void>>();
  private readonly pathQueues = new Map<string, Promise<void>>();

  constructor(opts: HttpAdapterOptions) {
    this.baseUrl = opts.projectFilesUrl;
    this.extraHeaders = opts.headers;
  }

  async read(path: string): Promise<string | undefined> {
    const url = `${this.baseUrl}/files/${encodeURIComponent(path)}?optional=1`;
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const data = (await res.json()) as { content?: string };
    return typeof data.content === "string" ? data.content : undefined;
  }

  /**
   * Enqueue a write for path. Same-path writes are serialized via pathQueues
   * so concurrent saves never interleave. Each write is a single-shot PUT —
   * on network error or non-2xx response, persist:error fires and the write
   * is not retried. Retry is the caller's responsibility.
   */
  async write(path: string, content: string): Promise<void> {
    const prev = this.pathQueues.get(path) ?? Promise.resolve();
    const p = prev.then(() => this.doWrite(path, content));
    this.pathQueues.set(
      path,
      p.catch(() => {}),
    );
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
      const extra =
        typeof this.extraHeaders === "function" ? this.extraHeaders() : this.extraHeaders;
      res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "text/plain", ...extra },
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

  /** Server-side versioning is not exposed by this adapter; returns [] intentionally. */
  async listVersions(_path: string): Promise<PersistVersionEntry[]> {
    return [];
  }

  /** Server-side versioning is not exposed by this adapter; returns undefined intentionally. */
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
