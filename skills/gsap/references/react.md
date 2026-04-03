# GSAP with React

## Installation

```bash
npm install gsap @gsap/react
```

## useGSAP() Hook (Preferred)

```javascript
import { useGSAP } from "@gsap/react";
gsap.registerPlugin(useGSAP);

const containerRef = useRef(null);
useGSAP(
  () => {
    gsap.to(".box", { x: 100 });
  },
  { scope: containerRef },
);
```

- Pass **scope** (ref) so selectors are scoped to the component.
- Cleanup runs automatically on unmount.
- Use **contextSafe** for callbacks created after useGSAP executes:

```javascript
useGSAP(
  (context, contextSafe) => {
    const onClick = contextSafe(() => {
      gsap.to(ref.current, { rotation: 180 });
    });
    ref.current.addEventListener("click", onClick);
    return () => ref.current.removeEventListener("click", onClick);
  },
  { scope: container },
);
```

## Dependency Array and revertOnUpdate

```javascript
useGSAP(
  () => {
    /* gsap code */
  },
  {
    dependencies: [endX],
    scope: container,
    revertOnUpdate: true, // reverts + re-runs on dependency change
  },
);
```

## gsap.context() in useEffect (Fallback)

When @gsap/react isn't available:

```javascript
useEffect(() => {
  const ctx = gsap.context(() => {
    gsap.to(".box", { x: 100 });
  }, containerRef);
  return () => ctx.revert();
}, []);
```

Always return `ctx.revert()` in cleanup.

## SSR (Next.js)

GSAP runs in the browser. Keep all GSAP code inside useGSAP or useEffect.

## Do Not

- Target by selector without a scope — always pass scope.
- Skip cleanup — always revert context or kill tweens on unmount.
- Run GSAP during SSR.
- Register plugins inside components that re-render — register once at app level.
