// Everything the starter imports, as one local ES module: all of three plus the tracer classes.
export * from "three";
export {
  DenoiseMaterial,
  GradientEquirectTexture,
  PhysicalCamera,
  PhysicalSpotLight,
  ShapedAreaLight,
  WebGLPathTracer,
} from "three-gpu-pathtracer";
