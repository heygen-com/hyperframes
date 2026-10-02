/** Arrival-driven headline coverage. Each region belongs to an actual returning shard, so
 * disconnected glyphs and sparse powder never need a timed neighbour/global reveal. */
import * as THREE from "three/webgpu";
import { tsl } from "../tsl/t";
import type { ErosionField } from "./ErosionField";
const {
  Fn,
  instancedArray,
  instanceIndex,
  uint,
  int,
  float,
  ivec3,
  vec3,
  vec4,
  If,
  Loop,
  atomicStore,
  atomicLoad,
  atomicMin,
  clamp,
  floor,
  length,
  dot,
  select,
  texture3D,
  textureStore,
} = tsl;

export const ASSEMBLY_GRID = 32;
export const assemblyReach = (bound: number) => (4 * bound) / ASSEMBLY_GRID;
const NONE = 0xffffffff;

export class AssemblyField {
  private readonly seeds = instancedArray(ASSEMBLY_GRID ** 3, "uint").toAtomic();
  private readonly owners = [
    instancedArray(ASSEMBLY_GRID ** 3, "uint"),
    instancedArray(ASSEMBLY_GRID ** 3, "uint"),
  ];
  private readonly prepareNodes: any[];
  private readonly updateNode: any;

  constructor(
    private readonly erosion: ErosionField,
    count: number,
    buffers: Record<string, any>,
    u: any,
  ) {
    const G = ASSEMBLY_GRID,
      n = G ** 3,
      i = instanceIndex,
      bound = erosion.bound;
    const coord = (idx: any, res: number) =>
      ivec3(idx.mod(uint(res)), idx.div(uint(res)).mod(uint(res)), idx.div(uint(res * res)));
    const index = (c: any) =>
      uint(c.x)
        .add(uint(c.y).mul(uint(G)))
        .add(uint(c.z).mul(uint(G * G)));
    const grid = (p: any) =>
      clamp(
        ivec3(
          floor(
            p
              .div(2 * bound)
              .add(0.5)
              .mul(G),
          ),
        ),
        ivec3(0),
        ivec3(G - 1),
      );
    const at = (c: any) =>
      vec3(c)
        .add(0.5)
        .div(G)
        .sub(0.5)
        .mul(2 * bound);
    const clear = Fn(() => {
      atomicStore(this.seeds.element(i), uint(NONE));
    })().compute(n, [64]);
    const seed = Fn(() => {
      const state = buffers.meta.element(i).x;
      // Only shards genuinely in flight may own target volume. No invisible ghost arrivals.
      If(state.greaterThan(0.5).and(state.lessThan(2.5)), () => {
        atomicMin(this.seeds.element(index(grid(buffers.rest.element(i).xyz))), uint(i));
      });
    })().compute(count, [64]);
    const copy = Fn(() => {
      this.owners[0].element(i).assign(atomicLoad(this.seeds.element(i)));
    })().compute(n, [64]);
    this.prepareNodes = [clear, seed, copy];
    let source = 0;
    // Fixed, small ownership grid: six ping-pong passes on retarget only, independent of
    // erosion resolution and particle count. Extra unit pass closes jump-flood edge cases.
    for (const jump of [16, 8, 4, 2, 1, 1]) {
      const read = this.owners[source],
        write = this.owners[1 - source];
      this.prepareNodes.push(
        Fn(() => {
          const c = coord(i, G).toVar(),
            p = at(c).toVar();
          const best = uint(NONE).toVar(),
            distance = float(1e30).toVar();
          const range = { start: int(-1), end: int(1), condition: "<=" };
          Loop(range, range, range, ({ i: x, j: y, k: z }: any) => {
            const cc = clamp(c.add(ivec3(x, y, z).mul(jump)), ivec3(0), ivec3(G - 1));
            const candidate = read.element(index(cc)).toVar();
            If(candidate.notEqual(uint(NONE)), () => {
              const delta = buffers.rest.element(candidate).xyz.sub(p);
              const d = dot(delta, delta).toVar();
              If(d.lessThan(distance).or(d.equal(distance).and(candidate.lessThan(best))), () => {
                best.assign(candidate);
                distance.assign(d);
              });
            });
          });
          write.element(i).assign(best);
        })().compute(n, [64]),
      );
      source = 1 - source;
    }
    const owner = this.owners[source],
      R = erosion.res;
    const previous = texture3D(erosion.tex);
    this.updateNode = Fn(() => {
      const c = coord(i, R).toVar();
      const p = vec3(c)
        .add(0.5)
        .div(R)
        .sub(0.5)
        .mul(2 * bound)
        .toVar();
      const id = owner.element(index(grid(p))).toVar();
      const old = previous.load(c).level(0).toVar();
      const e = old.r.toVar();
      If(id.notEqual(uint(NONE)), () => {
        const rest = buffers.rest.element(id).xyz.toVar();
        const target = u.model.mul(vec4(rest, 1)).xyz;
        const distance = length(buffers.pos.element(id).xyz.sub(target));
        const state = buffers.meta.element(id).x;
        // A spatial contact front expands around this shard's own home as it approaches.
        // No elapsed-time fade, cell-wide wait, stochastic refill, or neighbour propagation.
        const localDistance = length(p.sub(rest));
        const contact = u.landRadius.add(
          float(assemblyReach(bound)).div(float(1).add(localDistance.div((2 * bound) / G))),
        );
        const returning = state
          .greaterThan(1.5)
          .and(state.lessThan(2.5))
          .or(state.greaterThan(4.5))
          .or(state.lessThan(0.5));
        If(returning.and(distance.lessThanEqual(contact)), () => {
          e.assign(0);
        });
      });
      textureStore(
        erosion.scratch,
        c,
        vec4(e, 0, select(e.lessThan(0.5), float(1), float(0)), 0),
      ).toWriteOnly();
    })().compute(R ** 3, [64]);
  }

  prepare(renderer: THREE.WebGPURenderer) {
    for (const node of this.prepareNodes) renderer.compute(node);
  }
  update(renderer: THREE.WebGPURenderer) {
    renderer.compute(this.updateNode);
    this.erosion.commitAssembly(renderer);
  }
  dispose() {
    for (const b of [this.seeds, ...this.owners]) b.value.dispose?.();
  }
}
