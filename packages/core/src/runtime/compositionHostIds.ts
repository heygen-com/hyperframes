export type HostCompositionIdentity = {
  authoredCompositionId: string | null;
  runtimeCompositionId: string | null;
};

export function hostCompositionIdentity(host: Element): HostCompositionIdentity {
  const currentCompositionId = (host.getAttribute("data-composition-id") || "").trim() || null;
  const authoredCompositionId =
    (host.getAttribute("data-hf-original-composition-id") || currentCompositionId || "").trim() ||
    null;
  return { authoredCompositionId, runtimeCompositionId: currentCompositionId };
}

const MOUNT_HOST =
  "[data-composition-src], [data-composition-file], [data-hf-original-composition-id]";

function mountsComposition(element: Element, authoredId: string): boolean {
  if (hostCompositionIdentity(element).authoredCompositionId !== authoredId) return false;
  return (
    element.matches(MOUNT_HOST) || !!element.ownerDocument.getElementById(`${authoredId}-template`)
  );
}

/**
 * The one runtime-id policy for preview, render and mount. Each pending host, in order, keeps its
 * authored id unless another element uses it or another host mounts the same composition; then it
 * takes the lowest free `<id>__hfN`. Callers pass one discovery level at a time.
 */
export function assignCompositionHostIds(
  pending: readonly Element[],
  identities: Map<Element, HostCompositionIdentity>,
): void {
  const waiting = new Set(pending);
  for (const host of pending) {
    waiting.delete(host);
    const identity = hostCompositionIdentity(host);
    const authoredId = identity.authoredCompositionId;
    if (!authoredId) {
      identities.set(host, identity);
      continue;
    }
    // ponytail: scans the document per host; fine for tens of hosts, index by id if that grows.
    const others = Array.from(host.ownerDocument.querySelectorAll("[data-composition-id]")).filter(
      (element) => element !== host,
    );
    // A host still waiting holds its authored id; its id from an earlier load is about to change.
    const taken = new Set(
      others.map((element) =>
        waiting.has(element)
          ? hostCompositionIdentity(element).authoredCompositionId
          : element.getAttribute("data-composition-id"),
      ),
    );
    const idAt = (index: number) => (index === 0 ? authoredId : `${authoredId}__hf${index}`);
    let index = others.some((element) => mountsComposition(element, authoredId)) ? 1 : 0;
    while (taken.has(idAt(index))) index += 1;
    const runtimeId = idAt(index);
    if (index > 0) host.setAttribute("data-hf-original-composition-id", authoredId);
    else host.removeAttribute("data-hf-original-composition-id");
    host.setAttribute("data-composition-id", runtimeId);
    identities.set(host, { authoredCompositionId: authoredId, runtimeCompositionId: runtimeId });
  }
}
