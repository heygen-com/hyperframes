interface HiddenCheckEl {
  hasAttribute(name: string): boolean;
  parentElement: HiddenCheckEl | null;
}

export function isSelfOrAncestorHidden(el: HiddenCheckEl): boolean {
  for (let current: HiddenCheckEl | null = el; current; current = current.parentElement) {
    if (current.hasAttribute("data-hidden")) return true;
  }
  return false;
}
