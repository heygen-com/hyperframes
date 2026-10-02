import { describe, expect, it } from "vitest";
import {
  HF_VFX_ATTR,
  chainCapture,
  getVfxDef,
  normalizeVfxParams,
  parseVfxChain,
  serializeVfxChain,
} from "./vfx";

describe("vfx chain", () => {
  it("round-trips a one-node chain with the audio-chain field names", () => {
    const json =
      '{"version":1,"nodes":[{"type":"fractal-noise","id":"n1","params":{"contrast":562}}]}';
    const chain = parseVfxChain(json);
    expect(chain.nodes[0].type).toBe("fractal-noise");
    expect(JSON.parse(serializeVfxChain(chain))).toEqual(JSON.parse(json));
  });
  it("rejects an unknown type and a wrong version loudly", () => {
    expect(() =>
      parseVfxChain('{"version":1,"nodes":[{"type":"nope","id":"n1","params":{}}]}'),
    ).toThrow(/unknown effect type/);
    expect(() => parseVfxChain('{"version":2,"nodes":[]}')).toThrow(/version/);
  });
  it("normalizes params to the def's range and defaults", () => {
    const p = normalizeVfxParams("fractal-noise", { contrast: 99999 });
    expect(p.contrast).toBe(1000); // clamped to the def's max
    expect(p.complexity).toBe(6); // default filled in
    expect(getVfxDef("fractal-noise")!.capture).toBe("none");
  });
  it("a chain's capture is the strongest enabled node's", () => {
    expect(
      chainCapture(
        parseVfxChain('{"version":1,"nodes":[{"type":"fractal-noise","id":"n1","params":{}}]}'),
      ),
    ).toBe("none");
  });
  it("attribute name is data-vfx-chain", () => expect(HF_VFX_ATTR).toBe("data-vfx-chain"));
});
