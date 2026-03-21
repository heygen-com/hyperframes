import type { Schema } from "./validate";

const BASE_URL = "/api";

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function validatedApiFetch<T>(schema: Schema<T>) {
  return async (path: string, options?: RequestInit): Promise<T> => {
    const res = await fetch(`${BASE_URL}${path}`, options);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed: ${res.status}`);
    }
    const json: unknown = await res.json();
    return schema.parse(json);
  };
}
