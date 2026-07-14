import type { vi as ViType } from "vitest";

const STORE = new Map<string, string>();

class MockStorage {
  get length() {
    return STORE.size;
  }
  getItem(k: string) {
    return STORE.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    STORE.set(k, v);
  }
  removeItem(k: string) {
    STORE.delete(k);
  }
  clear() {
    STORE.clear();
  }
  key(i: number) {
    return [...STORE.keys()][i] ?? null;
  }
}

export function mockLocalStorage(vi: typeof ViType): void {
  if (typeof localStorage === "undefined") {
    vi.stubGlobal("localStorage", new MockStorage());
  }
}

export function clearMockStorage(): void {
  STORE.clear();
}
