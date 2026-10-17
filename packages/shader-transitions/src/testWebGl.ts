import { vi } from "vitest";

export function stubWebGl() {
  vi.stubGlobal("CanvasRenderingContext2D", class {});
  const gl = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === "getShaderParameter" || key === "getProgramParameter" ? () => true : () => ({}),
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((type: string) =>
    type === "webgl" ? gl : null) as HTMLCanvasElement["getContext"]);
}
