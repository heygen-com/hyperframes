const addedByRuntime = new WeakMap<object, Set<string>>();

export function recordRuntimeAttribute(el: object, name: string): void {
  const names = addedByRuntime.get(el) ?? new Set<string>();
  names.add(name);
  addedByRuntime.set(el, names);
}

export function forgetRuntimeAttribute(el: Element, name: string): boolean {
  return addedByRuntime.get(el)?.delete(name) === true;
}

export function isRuntimeAttribute(el: Element, name: string): boolean {
  return addedByRuntime.get(el)?.has(name) === true;
}

export function setRuntimePreload(
  media: Pick<HTMLMediaElement, "preload"> & Partial<Pick<Element, "hasAttribute">>,
  value: HTMLMediaElement["preload"],
): void {
  if (media.hasAttribute?.("preload") === false) recordRuntimeAttribute(media, "preload");
  media.preload = value;
}
