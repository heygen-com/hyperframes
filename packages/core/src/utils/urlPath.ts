export function decodeUrlPathVariants(path: string): string[] {
  const variants = [path];
  try {
    const decoded = decodeURIComponent(path);
    if (decoded !== path) variants.unshift(decoded);
  } catch {
    // Malformed percent sequences may be literal filesystem names.
  }

  return variants;
}
