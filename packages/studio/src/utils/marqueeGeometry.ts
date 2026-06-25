export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Corners = [Point, Point, Point, Point];

function isIdentityMatrix(m: DOMMatrix): boolean {
  const e = 1e-6;
  return Math.abs(m.a - 1) < e && Math.abs(m.b) < e && Math.abs(m.c) < e && Math.abs(m.d - 1) < e;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

function projectOntoAxis(corners: Corners, ax: number, ay: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const c of corners) {
    const dot = c.x * ax + c.y * ay;
    if (dot < min) min = dot;
    if (dot > max) max = dot;
  }
  return [min, max];
}

function projectionsOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/**
 * SAT intersection test between an axis-aligned marquee rect and a
 * convex quadrilateral (the element's OBB corners in overlay space).
 *
 * Separating axes: 2 from the AABB (horizontal, vertical) + 2 from
 * the OBB's edge normals. If projections overlap on all 4 axes, the
 * shapes intersect.
 */
export function marqueeIntersectsObb(marquee: Rect, corners: Corners): boolean {
  if (marquee.width <= 0 || marquee.height <= 0) return false;

  const mCorners: Corners = [
    { x: marquee.left, y: marquee.top },
    { x: marquee.left + marquee.width, y: marquee.top },
    { x: marquee.left + marquee.width, y: marquee.top + marquee.height },
    { x: marquee.left, y: marquee.top + marquee.height },
  ];

  // AABB axes: (1,0) and (0,1)
  const mProjX: [number, number] = [marquee.left, marquee.left + marquee.width];
  const mProjY: [number, number] = [marquee.top, marquee.top + marquee.height];

  const oProjX = projectOntoAxis(corners, 1, 0);
  const oProjY = projectOntoAxis(corners, 0, 1);

  if (!projectionsOverlap(mProjX, oProjX)) return false;
  if (!projectionsOverlap(mProjY, oProjY)) return false;

  // OBB edge normals (only need 2 — edges 0→1 and 1→2)
  for (let i = 0; i < 2; i++) {
    const edge = {
      x: corners[i + 1].x - corners[i].x,
      y: corners[i + 1].y - corners[i].y,
    };
    const len = Math.hypot(edge.x, edge.y);
    if (len < 1e-9) continue;
    const ax = -edge.y / len;
    const ay = edge.x / len;

    const mProj = projectOntoAxis(mCorners, ax, ay);
    const oProj = projectOntoAxis(corners, ax, ay);
    if (!projectionsOverlap(mProj, oProj)) return false;
  }

  return true;
}

/**
 * Compute the four corners of an element's OBB in overlay-pixel space.
 *
 * For elements with an identity transform, returns the axis-aligned
 * corners from the element's BCR mapped to overlay space (fast path).
 */
// fallow-ignore-next-line complexity
export function elementObbCorners(
  element: HTMLElement,
  overlayEl: HTMLDivElement,
  iframe: HTMLIFrameElement,
): Corners | null {
  const doc = iframe.contentDocument;
  if (!doc) return null;

  const iframeRect = iframe.getBoundingClientRect();
  const overlayRect = overlayEl.getBoundingClientRect();
  const root = doc.querySelector<HTMLElement>("[data-composition-id]") ?? doc.documentElement;
  const declaredW = Number.parseFloat(root?.getAttribute("data-width") ?? "");
  const declaredH = Number.parseFloat(root?.getAttribute("data-height") ?? "");
  const rootW = declaredW > 0 ? declaredW : root?.getBoundingClientRect().width || 1;
  const rootH = declaredH > 0 ? declaredH : root?.getBoundingClientRect().height || 1;

  const scaleX = iframeRect.width / rootW;
  const scaleY = iframeRect.height / rootH;
  const offsetX = iframeRect.left - overlayRect.left;
  const offsetY = iframeRect.top - overlayRect.top;

  const win = element.ownerDocument.defaultView;
  if (!win) return null;

  const transform = win.getComputedStyle(element).transform;
  const m = transform && transform !== "none" ? new DOMMatrix(transform) : new DOMMatrix();

  if (isIdentityMatrix(m)) {
    const r = element.getBoundingClientRect();
    const left = offsetX + r.left * scaleX;
    const top = offsetY + r.top * scaleY;
    const w = r.width * scaleX;
    const h = r.height * scaleY;
    return [
      { x: left, y: top },
      { x: left + w, y: top },
      { x: left + w, y: top + h },
      { x: left, y: top + h },
    ];
  }

  // Walk offsetParent chain for pre-transform position
  let ox = 0;
  let oy = 0;
  let el: HTMLElement | null = element;
  while (el && el !== doc.body && el !== doc.documentElement) {
    ox += el.offsetLeft;
    oy += el.offsetTop;
    el = el.offsetParent as HTMLElement | null;
  }

  const w = element.offsetWidth;
  const h = element.offsetHeight;
  // ponytail: center-based transform — CSS transforms originate at 50% 50%
  const cx = ox + w / 2;
  const cy = oy + h / 2;

  const localCorners: [number, number][] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];

  return localCorners.map(([lx, ly]) => {
    const tx = m.a * lx + m.c * ly + cx;
    const ty = m.b * lx + m.d * ly + cy;
    return {
      x: offsetX + tx * scaleX,
      y: offsetY + ty * scaleY,
    };
  }) as Corners;
}

export { rectsOverlap };
