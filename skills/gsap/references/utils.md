# gsap.utils

Pure helpers on `gsap.utils`. No registration needed.

**Function form:** Most utils accept the value as the last argument. Omit it to get a reusable function: `gsap.utils.clamp(0, 100)(150)`. Exception: `random()` — pass `true` as the last argument for a reusable function.

## Clamping and Ranges

### clamp(min, max, value?)

```javascript
gsap.utils.clamp(0, 100, 150); // 100
let c = gsap.utils.clamp(0, 100);
c(150); // 100
```

### mapRange(inMin, inMax, outMin, outMax, value?)

```javascript
gsap.utils.mapRange(0, 1, 0, 360, 0.5); // 180
let m = gsap.utils.mapRange(0, 100, 0, 500);
m(50); // 250
```

### normalize(min, max, value?)

Returns 0-1 for the range.

```javascript
gsap.utils.normalize(0, 100, 50); // 0.5
```

### interpolate(start, end, progress?)

Numbers, colors, or objects with matching keys.

```javascript
gsap.utils.interpolate(0, 100, 0.5); // 50
gsap.utils.interpolate("#ff0000", "#0000ff", 0.5); // mid color
```

## Random and Snap

### random(min, max[, snap, returnFunction]) / random(array[, returnFunction])

```javascript
gsap.utils.random(-100, 100);
gsap.utils.random(0, 500, 5); // snapped to 5
let fn = gsap.utils.random(-200, 500, 10, true);
fn(); // reusable
gsap.utils.random(["red", "blue"]); // pick one
```

**String form in tweens:** `x: "random(-100, 100, 5)"`.

### snap(snapTo, value?)

```javascript
gsap.utils.snap(10, 23); // 20
gsap.utils.snap([0, 100, 200], 150); // nearest
```

### shuffle(array)

Returns shuffled copy.

### distribute(config)

Returns a function assigning values by position. Config: `base`, `amount`/`each`, `from`, `grid`, `axis`, `ease`.

```javascript
gsap.to(".class", { scale: gsap.utils.distribute({ base: 0.5, amount: 2.5, from: "center" }) });
```

## Units and Parsing

- **getUnit(value)** — `gsap.utils.getUnit("100px")` → `"px"`
- **unitize(value, unit)** — `gsap.utils.unitize(100, "px")` → `"100px"`
- **splitColor(color, returnHSL?)** — `gsap.utils.splitColor("red")` → `[255, 0, 0]`. Pass `true` for HSL.

## Arrays and Collections

- **selector(scope)** — scoped selector: `gsap.utils.selector(ref)(".box")`
- **toArray(value, scope?)** — convert selector/NodeList/element to array
- **pipe(...fns)** — compose: `pipe(f1, f2)(value)` = `f2(f1(value))`
- **wrap(min, max, value?)** — cyclic wrap: `wrap(0, 360, 370)` → `10`
- **wrapYoyo(min, max, value?)** — bounce wrap: `wrapYoyo(0, 100, 150)` → `50`

## Do Not

- Assume mapRange/normalize handle units — they work on numbers. Use getUnit/unitize.
