import { c } from "../ui/colors.js";

/**
 * True only when `pkg` itself is absent. Node's message for a missing dependency of an
 * installed `pkg` also names `pkg` (in the importer path), so match the quoted specifier.
 */
export function isMissingPackageError(error: unknown, pkg: string): boolean {
  return (
    (error as NodeJS.ErrnoException)?.code === "ERR_MODULE_NOT_FOUND" &&
    error instanceof Error &&
    error.message.includes(`Cannot find package '${pkg}'`)
  );
}

export function missingPackageMessage(pkg: string, command: string): string {
  return (
    `${c.error(`${pkg} is not installed.`)} The ${c.accent(command)} command needs it at runtime.\n` +
    `Install it alongside the CLI:\n` +
    `  ${c.accent(`npm install -g ${pkg}`)}\n` +
    `Or, for an opt-in project setup:\n` +
    `  ${c.accent(`npm install ${pkg}`)}`
  );
}
