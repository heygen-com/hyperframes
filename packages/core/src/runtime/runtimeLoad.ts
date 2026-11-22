let loading: object | null = null;

/** Every load() the runtime makes goes through here, so the sealed CORS handling can tell it from the composition's. */
export function runtimeLoad(media: Pick<HTMLMediaElement, "load">): void {
  const outer = loading;
  loading = media;
  try {
    media.load();
  } finally {
    loading = outer;
  }
}

export const loadedByRuntime = (media: object): boolean => loading === media;
