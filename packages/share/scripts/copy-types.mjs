import { cp } from "node:fs/promises";
await cp("src/types", "dist/types", { recursive: true });
await cp("src/hosts.d.ts", "dist/hosts.d.ts");

await cp("src/sources/types.d.ts", "dist/sources/types.d.ts");
await cp("src/sources/adapterTypes.d.ts", "dist/sources/adapterTypes.d.ts");
