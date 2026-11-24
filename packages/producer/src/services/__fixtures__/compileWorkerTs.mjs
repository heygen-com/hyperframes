// Loads the real compileWorker.ts under tsx for tests: a worker's own entry loads before --import hooks
// can map its ".js" imports to ".ts" sources, so the hooks are registered first and the entry imported after.
import { register } from "tsx/esm/api";

register();
await import("../compileWorker.ts");
