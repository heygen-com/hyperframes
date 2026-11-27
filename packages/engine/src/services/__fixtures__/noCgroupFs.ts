import { vi } from "vitest";

/** `fs` for a test that describes a host with no cgroup CPU or memory limit, whatever box runs it. */
export async function fsWithoutCgroup(): Promise<typeof import("fs")> {
  const real = await vi.importActual<typeof import("fs")>("fs");
  const readFileSync = ((path: unknown, ...rest: unknown[]) => {
    if (/^\/(sys\/fs\/cgroup|proc\/self\/cgroup)/.test(String(path)))
      throw Object.assign(new Error(`ENOENT: ${String(path)}`), { code: "ENOENT" });
    return (real.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof real.readFileSync;
  return { ...real, readFileSync };
}
