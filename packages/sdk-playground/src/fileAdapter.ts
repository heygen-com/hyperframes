import type { PersistAdapter, PersistErrorEvent, PersistVersionEntry } from "@hyperframes/sdk";

const API = "/api/composition";

class FileAdapter implements PersistAdapter {
  private errorHandlers = new Set<(e: PersistErrorEvent) => void>();

  async read(_path: string): Promise<string | undefined> {
    const res = await fetch(API);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`read failed: ${res.status}`);
    return res.text();
  }

  async write(_path: string, content: string): Promise<void> {
    try {
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: content,
      });
      if (!res.ok) throw new Error(`write failed: ${res.status}`);
    } catch (err) {
      for (const h of this.errorHandlers) h({ error: { message: String(err), cause: err } });
    }
  }

  async flush(): Promise<void> {}

  async listVersions(_path: string): Promise<PersistVersionEntry[]> {
    const res = await fetch("/api/composition/versions");
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{ key: string; timestamp?: number }>;
    return rows.map((r) => ({ key: r.key, content: "", timestamp: r.timestamp }));
  }

  async loadFrom(_path: string, versionKey: string): Promise<string | undefined> {
    const res = await fetch(`/api/composition?version=${encodeURIComponent(versionKey)}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`loadFrom failed: ${res.status}`);
    return res.text();
  }

  on(event: "persist:error", handler: (e: PersistErrorEvent) => void): () => void {
    if (event !== "persist:error") return () => {};
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }
}

export async function createFileAdapter(): Promise<{
  adapter: PersistAdapter;
  initialHtml: string | undefined;
}> {
  const adapter = new FileAdapter();
  const initialHtml = await adapter.read("composition.html");
  return { adapter, initialHtml };
}
