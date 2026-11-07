import { cp } from "node:fs/promises";
await cp("src/types", "dist/types", { recursive: true });
await cp("src/hosts.d.ts", "dist/hosts.d.ts");
