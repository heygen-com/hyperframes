# ScrollTrigger

## Registering

```javascript
gsap.registerPlugin(ScrollTrigger);
```

## Basic Trigger

```javascript
gsap.to(".box", {
  x: 500,
  scrollTrigger: {
    trigger: ".box",
    start: "top center",
    end: "bottom center",
    toggleActions: "play reverse play reverse",
  },
});
```

**start/end** format: `"triggerPosition viewportPosition"`. Examples: `"top top"`, `"center center"`, `"bottom 80%"`, numeric px `500`, relative `"+=300"`, `"+=100%"` (scroller height), `"max"`. Wrap in `clamp()` (v3.12+): `"clamp(top bottom)"`. Can be a function returning string/number.

## Key Config Options

| Property                                        | Type                                  | Description                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **trigger**                                     | String/Element                        | Element whose position defines start. Required.                                                                                                           |
| **start**                                       | String/Number/Function                | When active. Default `"top bottom"` (or `"top top"` if pinned).                                                                                           |
| **end**                                         | String/Number/Function                | When ends. Default `"bottom top"`.                                                                                                                        |
| **endTrigger**                                  | String/Element                        | Different element for end calculation.                                                                                                                    |
| **scrub**                                       | Boolean/Number                        | Link progress to scroll. `true` = direct; number = catch-up seconds.                                                                                      |
| **toggleActions**                               | String                                | Four actions: onEnter, onLeave, onEnterBack, onLeaveBack. Values: play/pause/resume/reset/restart/complete/reverse/none. Default `"play none none none"`. |
| **pin**                                         | Boolean/String/Element                | Pin element while active. `true` = pin trigger. Animate children, not the pinned element.                                                                 |
| **pinSpacing**                                  | Boolean/String                        | Default `true` (adds spacer). `false` or `"margin"`.                                                                                                      |
| **horizontal**                                  | Boolean                               | For horizontal scrolling.                                                                                                                                 |
| **scroller**                                    | String/Element                        | Scroll container (default: viewport).                                                                                                                     |
| **markers**                                     | Boolean/Object                        | Dev markers. Remove in production.                                                                                                                        |
| **once**                                        | Boolean                               | Kill after end reached once.                                                                                                                              |
| **snap**                                        | Number/Array/Function/"labels"/Object | Snap to progress values.                                                                                                                                  |
| **containerAnimation**                          | Tween/Timeline                        | For fake horizontal scroll (see below).                                                                                                                   |
| **toggleClass**                                 | String/Object                         | Add/remove class when active.                                                                                                                             |
| **onEnter/onLeave/onEnterBack/onLeaveBack**     | Function                              | Callbacks; receive ScrollTrigger instance.                                                                                                                |
| **onUpdate/onToggle/onRefresh/onScrubComplete** | Function                              | Progress/state callbacks.                                                                                                                                 |

**Standalone** (no linked tween): `ScrollTrigger.create({...})` with callbacks.

## Scrub

```javascript
scrollTrigger: { trigger: ".box", start: "top center", end: "bottom center", scrub: true }
```

`scrub: true` = direct link; number (e.g. `1`) = smooth lag.

## Pinning

```javascript
scrollTrigger: {
  trigger: ".section", start: "top top", end: "+=1000", pin: true, scrub: 1
}
```

## Timeline + ScrollTrigger

```javascript
const tl = gsap.timeline({
  scrollTrigger: { trigger: ".container", start: "top top", end: "+=2000", scrub: 1, pin: true },
});
tl.to(".a", { x: 100 }).to(".b", { y: 50 });
```

## ScrollTrigger.batch()

Creates one ScrollTrigger per target, batches callbacks within a short interval. Good for staggered reveal of many elements.

```javascript
ScrollTrigger.batch(".box", {
  onEnter: (elements) => gsap.to(elements, { opacity: 1, y: 0, stagger: 0.15 }),
  start: "top 80%",
});
```

Options: `interval` (batch window), `batchMax` (max per batch). Callbacks receive `(targets, scrollTriggers)`.

## Horizontal Scroll (containerAnimation)

Pin a section, animate inner content's `x`/`xPercent` horizontally on vertical scroll:

1. Pin the section
2. Animate inner content with **ease: "none"** (required)
3. Attach ScrollTrigger with pin + scrub
4. Use `containerAnimation` on nested triggers

```javascript
const scrollTween = gsap.to(scrollingEl, {
  xPercent: () => Math.max(0, window.innerWidth - scrollingEl.offsetWidth),
  ease: "none",
  scrollTrigger: {
    trigger: scrollingEl,
    pin: scrollingEl.parentNode,
    start: "top top",
    end: "+=1000",
  },
});

gsap.to(".nested", {
  y: 100,
  scrollTrigger: { containerAnimation: scrollTween, trigger: ".wrapper", start: "left center" },
});
```

Pinning and snapping unavailable on containerAnimation-based ScrollTriggers.

## ScrollTrigger.scrollerProxy()

Override scroll position reading for third-party smooth-scroll libraries. Call `ScrollTrigger.update` when the scroller updates.

```javascript
ScrollTrigger.scrollerProxy(document.body, {
  scrollTop(value) {
    if (arguments.length) scrollbar.scrollTop = value;
    return scrollbar.scrollTop;
  },
  getBoundingClientRect() {
    return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
  },
});
scrollbar.addListener(ScrollTrigger.update);
```

## Refresh and Cleanup

- `ScrollTrigger.refresh()` — recalculate after DOM/layout changes. Auto on resize (200ms debounce).
- Create ScrollTriggers top-to-bottom or set `refreshPriority`.
- Kill instances when removing elements: `ScrollTrigger.getAll().forEach(t => t.kill())` or `ScrollTrigger.getById("id")?.kill()`.

## Do Not

- Put ScrollTrigger on child tweens inside a timeline — put on the timeline.
- Nest ScrollTriggered animations inside a parent timeline.
- Use scrub and toggleActions together (scrub wins).
- Use an ease other than "none" on the horizontal animation with containerAnimation.
- Leave markers in production.
- Create triggers in random order without refreshPriority.
- Forget refresh() after layout changes.
