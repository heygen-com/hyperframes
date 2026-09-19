# Source for assets/frost.js and assets/motion.js

This directory holds the TypeScript source and esbuild script that produce
the two bundled scripts the composition loads: `../assets/frost.js` (the
WebGPU/TSL ice rig, via `src/frost.ts`) and `../assets/motion.js` (the
lightweight WebGL editor helper, via `src/motion/editor.ts`).

## Build

```sh
npm install
npm run build
```

This regenerates `../assets/frost.js` and `../assets/motion.js`, plus a
`.LEGAL.txt` file next to each listing the bundled third-party notices
esbuild was able to extract automatically. `assets/Three-LICENSE.txt`,
`assets/ThreeMeshBVH-LICENSE.txt`, `assets/OpentypeJS-LICENSE.txt`, and
`assets/Clipper-LICENSE.txt` cover the same dependencies explicitly, since
automatic extraction doesn't catch every one of them.

`build.mjs` runs two checks before bundling: a source-only TypeScript pass
(`tools/compile-preflight.mjs`) and a headless shader-compile probe
(`tools/run-shard-compile.mjs`) that generates the WGSL for one shard
without a GPU, to catch a class of shader bug that only shows up at
compile time.

## Scope

This is the buildable subset: the TypeScript source, `build.mjs`, and the
two tool scripts it imports. The original project's test suite and a
standalone visual tuning UI (`workbench/`) are not included here.
