import { createReadinessAdapter } from "./_readiness";

type D3TransitionLike = {
  end: () => PromiseLike<void>;
};

export function createD3Adapter() {
  return createReadinessAdapter<D3TransitionLike>({
    name: "d3",
    getInstances: () => {
      if (typeof window === "undefined") return [];
      const arr = (window as { __hfD3?: D3TransitionLike[] }).__hfD3;
      return Array.isArray(arr) ? arr : [];
    },
    waitFor: (t) => t.end(),
  });
}
