# Vendored 3D libraries

`three-path-tracer.min.js` is one local ES module, so the project renders without any network
access. It re-exports all of three plus these classes from three-gpu-pathtracer:
`WebGLPathTracer`, `PhysicalSpotLight`, `ShapedAreaLight`, `PhysicalCamera`, `DenoiseMaterial`
and `GradientEquirectTexture`.

| Package              | Version | Licence                                 |
| -------------------- | ------- | --------------------------------------- |
| three                | 0.180.0 | MIT, `three.LICENSE.txt`                |
| three-gpu-pathtracer | 0.0.24  | MIT, `three-gpu-pathtracer.LICENSE.txt` |
| three-mesh-bvh       | 0.9.5   | MIT, `three-mesh-bvh.LICENSE.txt`       |

Built with esbuild 0.25.12 (`--bundle --format=esm --minify --target=es2020`). SHA-256 of the
bundle: `a247cb7f88eff8b1d423a2892e5ca27c7d03d83939fe0ca6fa9a11c7f9f21fc9`.

To rebuild the bundle or update its dependencies, follow the [maintainer instructions in the HyperFrames repository](https://github.com/heygen-com/hyperframes/tree/main/registry/examples/path-traced-3d/source).
