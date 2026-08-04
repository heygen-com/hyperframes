import { safeLocalStorage } from "./safeStorage";

/**
 * One JSON-in-Web-Storage implementation for all of Studio's persisted state.
 *
 * Every store here was independently re-implementing the same four concerns —
 * reaching a Storage that can throw, parsing JSON that may be anything,
 * validating it, and writing without letting a quota error escape — each with
 * its own `try {} catch {}` and its own idea of what a bad value means.
 * `createJsonStore` owns those; a caller supplies only the key, the fallback,
 * and how to read its own shape out of unknown data.
 */

export interface JsonStore<T> {
  /** The stored value, or the fallback when it is absent or unreadable. */
  read(): T;
  /** Replace the stored value. */
  write(value: T): void;
  /** Merge into the stored value — for record-shaped state like preferences. */
  update(patch: Partial<T>): void;
  clear(): void;
}

export interface JsonStoreOptions<T> {
  key: string;
  fallback: T;
  /**
   * Turn unknown parsed JSON into T. Validation belongs to the caller: only it
   * knows which fields are meaningful and what a stale one should become.
   */
  parse: (raw: unknown) => T;
  /** Defaults to localStorage; pass a getter for session or a test double. */
  storage?: () => Storage | null;
}

export function createJsonStore<T>({
  key,
  fallback,
  parse,
  storage = safeLocalStorage,
}: JsonStoreOptions<T>): JsonStore<T> {
  const read = (): T => {
    const store = storage();
    if (!store) return fallback;
    try {
      const raw = store.getItem(key);
      return raw === null ? fallback : parse(JSON.parse(raw));
    } catch {
      // Absent, unparseable, or written by an older Studio: the fallback is
      // always a usable answer, and a broken read must not break the caller.
      return fallback;
    }
  };

  const write = (value: T): void => {
    const store = storage();
    if (!store) return;
    try {
      store.setItem(key, JSON.stringify(value));
    } catch {
      // Quota, or a private-mode storage that refuses writes. Losing the
      // preference beats taking the interaction down with it.
    }
  };

  return {
    read,
    write,
    update: (patch) => write({ ...read(), ...patch }),
    clear: () => {
      const store = storage();
      try {
        store?.removeItem(key);
      } catch {
        // Same contract as write: never throw at the caller.
      }
    },
  };
}
