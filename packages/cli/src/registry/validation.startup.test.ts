import { expect, it, vi } from "vitest";

const compiles = vi.hoisted(() => ({ count: 0 }));

vi.mock("ajv/dist/2020.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("ajv/dist/2020.js")>();
  const compile = real.Ajv2020.prototype.compile;
  real.Ajv2020.prototype.compile = function (this: unknown, ...args: unknown[]) {
    compiles.count += 1;
    return Reflect.apply(compile, this, args);
  } as typeof compile;
  return { ...real };
});

it("compiles the registry schemas on first use, not when the module is imported", async () => {
  const { validRegistryItem } = await import("./validation.js");
  expect(compiles.count).toBe(0);

  validRegistryItem({}, "demo", "hyperframes:component");
  expect(compiles.count).toBe(2);

  validRegistryItem({}, "demo", "hyperframes:component");
  expect(compiles.count).toBe(2);
});
