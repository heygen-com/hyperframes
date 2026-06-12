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
