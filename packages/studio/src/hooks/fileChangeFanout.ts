type FileChangeListener = (payload: unknown) => void;

const listeners = new Set<FileChangeListener>();

/** Hears every decoded external file change the coordinator receives, without a transport of its own. */
export function onExternalFileChange(listener: FileChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function announceExternalFileChange(payload: unknown): void {
  for (const listener of listeners) listener(payload);
}
