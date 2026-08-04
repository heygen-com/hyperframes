import { describe, expect, it } from "vitest";
import { createJsonStore } from "./jsonStore";

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => map.delete(key) as unknown as void,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

interface Prefs {
  theme?: string;
  size?: number;
}

const parsePrefs = (raw: unknown): Prefs => {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    theme: typeof value.theme === "string" ? value.theme : undefined,
    size: typeof value.size === "number" ? value.size : undefined,
  };
};

function storeOver(storage: Storage | null, fallback: Prefs = {}) {
  return createJsonStore<Prefs>({ key: "k", fallback, parse: parsePrefs, storage: () => storage });
}

describe("createJsonStore", () => {
  it("round-trips a value", () => {
    const store = storeOver(memoryStorage());
    store.write({ theme: "dark", size: 2 });
    expect(store.read()).toEqual({ theme: "dark", size: 2 });
  });

  it("merges on update, leaving the rest alone", () => {
    const store = storeOver(memoryStorage());
    store.write({ theme: "dark", size: 2 });
    store.update({ size: 3 });
    expect(store.read()).toEqual({ theme: "dark", size: 3 });
  });

  it("falls back when nothing is stored, when the JSON is broken, and when a field is junk", () => {
    expect(storeOver(memoryStorage()).read()).toEqual({});
    expect(storeOver(memoryStorage({ k: "{not json" })).read()).toEqual({});
    // Parsing is the caller's: a junk field drops, it does not poison the read.
    expect(storeOver(memoryStorage({ k: '{"theme":5,"size":2}' })).read()).toEqual({
      theme: undefined,
      size: 2,
    });
  });

  it("survives storage that is missing or refuses to write", () => {
    const missing = storeOver(null);
    expect(() => missing.write({ theme: "dark" })).not.toThrow();
    expect(missing.read()).toEqual({});

    const full = memoryStorage();
    full.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(() => storeOver(full).write({ theme: "dark" })).not.toThrow();
  });

  it("clears the key", () => {
    const storage = memoryStorage();
    const store = storeOver(storage);
    store.write({ theme: "dark" });
    store.clear();
    expect(storage.getItem("k")).toBeNull();
  });
});
