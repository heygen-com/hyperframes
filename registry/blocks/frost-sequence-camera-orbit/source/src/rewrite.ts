const profiles: Record<string, string> = {
  original: "gpu",
  lookup: "gpu,materials",
  mesh: "gpu,mesh,materials",
  studio: "gpu,fast,environment,materials,aa",
  matcap: "gpu,matcap,materials,aa",
};
const params =
  typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
function resolveFlags(profile: string) {
  const flags = new Set(
    (params.has("rewrite") ? params.get("rewrite")! : profiles[profile] || profiles.studio).split(
      ",",
    ),
  );
  return {
    gpu: flags.has("gpu"),
    environment: flags.has("environment"),
    materials: flags.has("materials"),
    matcap: flags.has("matcap"),
    fast: flags.has("fast"),
    aa: flags.has("aa"),
    mesh: flags.has("mesh") || flags.has("matcap") || flags.has("fast"),
  };
}
export const RW = resolveFlags(typeof window === "undefined" ? "original" : "studio");
export const rwMetrics: any = { flags: RW, stages: [], sdf: [], start: performance.now() };
if (typeof window !== "undefined") (window as any).__rewrite = rwMetrics;
/** Host variables may be injected after the external bundle executes. Resolve
 * the profile from the same merged values as the composition, before mounting. */
export function setRendererProfile(profile = "studio") {
  Object.assign(RW, resolveFlags(profile));
  rwMetrics.profile = profile;
}
