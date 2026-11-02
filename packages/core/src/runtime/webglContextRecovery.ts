export function watchSceneWebglContexts(onRestored: () => void): () => void {
  let frame: number | null = null;
  // Without preventDefault the browser never restores the context.
  const onLost = (event: Event) => event.preventDefault();
  const onRestore = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      onRestored();
    });
  };
  // These events do not bubble, so only a capture listener sees every canvas.
  document.addEventListener("webglcontextlost", onLost, true);
  document.addEventListener("webglcontextrestored", onRestore, true);
  return () => {
    document.removeEventListener("webglcontextlost", onLost, true);
    document.removeEventListener("webglcontextrestored", onRestore, true);
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
}
