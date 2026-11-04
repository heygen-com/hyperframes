import { promises as dns } from "node:dns";
import { createRequire, syncBuiltinESMExports } from "node:module";

const server = process.env.HF_TEST_DNS ?? "";
if (!server) throw new Error("Missing DNS server");
const Resolver = dns.Resolver;
dns.Resolver = class extends Resolver {
  constructor(options?: ConstructorParameters<typeof Resolver>[0]) {
    super(options);
    this.setServers([server]);
  }
};
const requireBuiltin = createRequire(import.meta.url);
const fsPromises = requireBuiltin("node:fs/promises");
const readFile = fsPromises.readFile;
fsPromises.readFile = (path: string, ...rest: unknown[]) =>
  /hosts$/.test(String(path))
    ? Promise.resolve(process.env.HF_TEST_HOSTS ?? "")
    : readFile(path, ...rest);
// HF_TEST_SYSTEM: "stall" for a system lookup that never returns, or the address it answers.
const system = process.env.HF_TEST_SYSTEM ?? "stall";
const childProcess = requireBuiltin("node:child_process");
const execFile = childProcess.execFile;
let lookupPid: number | undefined;
childProcess.execFile = (file: string, _args: string[], ...rest: unknown[]) => {
  const child = execFile(
    file,
    [
      "-e",
      system === "stall" ? "setInterval(() => {}, 1000)" : `process.stdout.write('["${system}"]')`,
    ],
    ...rest,
  );
  lookupPid = child.pid;
  return child;
};
syncBuiltinESMExports();
const exitAfterMs = Number(process.env.HF_TEST_EXIT_AFTER_MS ?? 0);
if (exitAfterMs) {
  setTimeout(() => {
    process.stdout.write(`exit ${lookupPid}\n`);
    process.exit(0);
  }, exitAfterMs);
}
const { resolvePublicAddress } = await import("./publicNetwork.js");
const outcome = await resolvePublicAddress("assets.capture-fixture.com").catch(
  (error: Error) => error.message,
);
process.stdout.write(`${outcome}\n`);
