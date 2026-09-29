import { resolve } from "node:path";

interface StudioServerDevModuleLoader {
  ssrLoadModule(id: string): Promise<unknown>;
}

/** Load the workspace server source so Studio dev cannot execute a stale ignored dist build. */
export function loadStudioServerDevModule(
  server: StudioServerDevModuleLoader,
  studioDir: string,
): Promise<unknown> {
  return server.ssrLoadModule(resolve(studioDir, "../studio-server/src/index.ts"));
}
