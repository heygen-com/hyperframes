// The build worker from source under Node: tsx resolves its relative .js imports to the .ts files beside them.
import { register } from "tsx/esm/api";

register();
await import("./subCompositionWorker.ts");
