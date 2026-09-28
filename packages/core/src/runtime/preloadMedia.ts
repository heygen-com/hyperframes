type PreloadableMedia = Pick<
  HTMLMediaElement,
  "tagName" | "preload" | "readyState" | "networkState" | "load"
>;

export function preloadMedia(media: PreloadableMedia): void {
  if (media.preload !== "auto") media.preload = "auto";
  // load() resets an in-flight video fetch, discarding its selected resource and buffered data.
  const videoAlreadyLoading = media.tagName === "VIDEO" && media.networkState === 2;
  if (media.readyState < 3 && !videoAlreadyLoading) media.load();
}
