# GSAP with Vue, Svelte, and Other Frameworks

For **React**, see [react.md](react.md).

## Principles (All Frameworks)

- **Create** tweens/ScrollTriggers **after** DOM is available (onMounted/onMount).
- **Kill or revert** in unmount cleanup.
- **Scope selectors** to component root via `gsap.context(callback, scope)`.

## Vue 3 (Composition API / script setup)

```javascript
import { onMounted, onUnmounted, ref } from "vue";
import { gsap } from "gsap";

const container = ref(null);
let ctx;

onMounted(() => {
  ctx = gsap.context(() => {
    gsap.to(".box", { x: 100 });
    gsap.from(".item", { autoAlpha: 0, stagger: 0.1 });
  }, container.value);
});

onUnmounted(() => ctx?.revert());
```

## Svelte

```javascript
import { onMount } from "svelte";
import { gsap } from "gsap";

let container;
onMount(() => {
  const ctx = gsap.context(() => {
    gsap.to(".box", { x: 100 });
  }, container);
  return () => ctx.revert();
});
```

Use `bind:this={container}` for the root element ref.

## ScrollTrigger Cleanup

ScrollTriggers inside `gsap.context()` are reverted by `ctx.revert()`. Call `ScrollTrigger.refresh()` after layout changes (nextTick in Vue, tick in Svelte).

## Do Not

- Create tweens before the component is mounted.
- Use selector strings without a scope.
- Skip cleanup — always revert context on unmount.
- Register plugins inside re-rendering component bodies.
