export function bench(cfg: {
  playMs: number;
  seekFractions: number[];
  countersOnly?: boolean;
  emptyProxies?: boolean;
  fullRaster?: boolean;
  removeLoader?: boolean;
}): Promise<unknown>;
