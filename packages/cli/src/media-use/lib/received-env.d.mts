export function receivedFileState(
  projectDir: string,
  path: string,
  options?: { atOrAboveOnly?: boolean },
): "received" | "unchecked" | null;
