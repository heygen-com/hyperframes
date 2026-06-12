import type { RegistryItem } from "@hyperframes/core";
import { compareVersions } from "compare-versions";
import { VERSION } from "../version.js";

export interface RegistryCompatibilityResult {
  warnings: string[];
  error?: string;
}

const DEV_VERSION = "0.0.0-dev";

export function checkRegistryItemCompatibility(
  item: RegistryItem,
  currentCliVersion = VERSION,
): RegistryCompatibilityResult {
  const warnings: string[] = [];
  if (item.deprecated) {
    warnings.push(`Registry item "${item.name}" is deprecated: ${item.deprecated}`);
  }

  const minCliVersion = item.minCliVersion?.trim();
  if (!minCliVersion || currentCliVersion === DEV_VERSION) {
    return { warnings };
  }

  try {
    if (compareVersions(currentCliVersion, minCliVersion) >= 0) {
      return { warnings };
    }
  } catch {
    return {
      warnings,
      error: `Registry item "${item.name}" declares invalid minCliVersion "${minCliVersion}".`,
    };
  }

  return {
    warnings,
    error:
      `Registry item "${item.name}" requires hyperframes >= ${minCliVersion} ` +
      `(current: ${currentCliVersion}). Run \`npx hyperframes@latest add ${item.name}\` ` +
      "or upgrade your installed hyperframes CLI.",
  };
}

/** Thrown by `gateRegistryItemsCompatibility` when an item requires a newer CLI. */
export class RegistryCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryCompatibilityError";
  }
}

/**
 * Compatibility-gate a set of resolved items (e.g. an item plus its transitive
 * `registryDependencies`) before any of them are installed. Throws a
 * `RegistryCompatibilityError` on the first item that requires a newer CLI, so
 * a partial install never happens; returns the accumulated (non-fatal)
 * deprecation warnings from every item.
 *
 * Every install path — `add`, template fetch, and the Studio "add block"
 * action — funnels through this so a dependency that ships `minCliVersion` is
 * rejected uniformly, not just by `hyperframes add`.
 */
export function gateRegistryItemsCompatibility(
  items: RegistryItem[],
  currentCliVersion = VERSION,
): string[] {
  const warnings: string[] = [];
  for (const item of items) {
    const result = checkRegistryItemCompatibility(item, currentCliVersion);
    if (result.error) {
      throw new RegistryCompatibilityError(result.error);
    }
    warnings.push(...result.warnings);
  }
  return warnings;
}
