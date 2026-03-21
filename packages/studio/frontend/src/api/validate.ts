/**
 * Lightweight Zod-like schema validation — zero dependencies.
 * Supports: string, number, boolean, enum, array, object, optional, nullable.
 * Usage mirrors Zod: v.object({ id: v.string() }).parse(data)
 */

export interface Schema<T> {
  parse(d: unknown): T;
  safeParse(d: unknown): { success: true; data: T } | { success: false; error: Error };
  optional(): Schema<T | undefined>;
  nullable(): Schema<T | null>;
}

function schema<T>(parse: (d: unknown) => T): Schema<T> {
  return {
    parse,
    safeParse(d: unknown) {
      try {
        return { success: true, data: parse(d) };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e : new Error(String(e)) };
      }
    },
    optional(): Schema<T | undefined> {
      return schema((d) => (d === undefined ? undefined : parse(d)));
    },
    nullable(): Schema<T | null> {
      return schema((d) => (d === null ? null : parse(d)));
    },
  };
}

function string(): Schema<string> {
  return schema((d) => {
    if (typeof d !== "string") throw new Error(`expected string, got ${typeof d}`);
    return d;
  });
}

function number(): Schema<number> {
  return schema((d) => {
    if (typeof d !== "number") throw new Error(`expected number, got ${typeof d}`);
    return d;
  });
}

function boolean(): Schema<boolean> {
  return schema((d) => {
    if (typeof d !== "boolean") throw new Error(`expected boolean, got ${typeof d}`);
    return d;
  });
}

function enumType<T extends string>(values: readonly [T, ...T[]]): Schema<T> {
  const set = new Set<string>(values);
  return schema((d) => {
    if (typeof d !== "string" || !set.has(d)) {
      throw new Error(`expected one of [${values.join(", ")}], got ${JSON.stringify(d)}`);
    }
    return d as T;
  });
}

function array<T>(itemSchema: Schema<T>): Schema<T[]> {
  return schema((d) => {
    if (!Array.isArray(d)) throw new Error(`expected array, got ${typeof d}`);
    return d.map((item, i) => {
      try {
        return itemSchema.parse(item);
      } catch (e) {
        throw new Error(`[${i}]: ${e instanceof Error ? e.message : e}`);
      }
    });
  });
}

type ObjectShape = Record<string, Schema<unknown>>;
type Infer<S> = S extends Schema<infer T> ? T : never;
type InferShape<S extends ObjectShape> = { [K in keyof S]: Infer<S[K]> };

function object<S extends ObjectShape>(shape: S): Schema<InferShape<S>> {
  return schema((d) => {
    if (typeof d !== "object" || d === null || Array.isArray(d)) {
      throw new Error(`expected object, got ${typeof d}`);
    }
    const obj = d as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      const field = shape[key];
      if (!field) continue;
      try {
        result[key] = field.parse(obj[key]);
      } catch (e) {
        throw new Error(`${key}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return result as InferShape<S>;
  });
}

export type { Infer };

export const v = {
  string,
  number,
  boolean,
  enum: enumType,
  array,
  object,
};
