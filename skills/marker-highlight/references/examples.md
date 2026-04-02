# Marker Highlight Examples

## Recipes

### Underline

```html
<mark
  data-height="0.15"
  data-offset="0.8"
  data-padding="0"
  data-highlight='{"amplitude":0.2,"wavelength":5,"roughEnds":0}'
  data-color="rgba(30, 136, 229, 0.6)"
  >important</mark
>
```

### Strikethrough

```html
<mark
  data-drawing-mode="highlight"
  data-height="0.1"
  data-offset="0"
  data-highlight='{"amplitude":0.1,"wavelength":3}'
  data-color="rgba(229, 57, 53, 0.8)"
  >wrong answer</mark
>
```

### Circled Annotation

```html
<mark
  data-drawing-mode="circle"
  data-circle='{"curve":0.8,"wobble":0.4,"loops":2,"thickness":3}'
  data-animation-speed="1200"
  data-color="rgba(229, 57, 53, 0.6)"
  >this one</mark
>
```

## Full Example in a Composition

```html
<div data-composition-id="highlight-demo" data-width="1920" data-height="1080">
  <div
    id="content"
    style="
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Inter', sans-serif; font-size: 72px; color: #fff;
    background: #111;
  "
  >
    <p id="hero">
      The <mark id="m1" data-color="rgba(255, 220, 50, 0.5)">fastest</mark> way to
      <mark
        id="m2"
        data-drawing-mode="circle"
        data-circle='{"curve":0.8,"wobble":0.3,"loops":2,"thickness":3}'
        data-color="rgba(229, 57, 53, 0.6)"
        >ship</mark
      >
    </p>
  </div>

  <style>
    [data-composition-id="highlight-demo"] mark {
      background-color: transparent;
      color: inherit;
    }
  </style>

  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script src="marker-highlight.global.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    var tl = gsap.timeline({ paused: true });

    // Set colors via data attribute (no visible flash)
    document.querySelectorAll("mark[data-color]").forEach(function (m) {
      m.setAttribute("data-original-bgcolor", m.getAttribute("data-color"));
    });

    // Init once after fonts, then hide all canvases
    var hl;
    document.fonts.ready.then(function () {
      setTimeout(function () {
        hl = new MarkerHighlighter(document.getElementById("hero"), {
          animate: false,
          animationSpeed: 800,
          padding: 0.3,
          highlight: { amplitude: 0.3, wavelength: 5 },
        });
        setTimeout(function () {
          document.querySelectorAll(".highlight").forEach(function (d) {
            d.style.opacity = "0";
          });
        }, 100);
      }, 50);
    });

    function addHighlight(markId, time) {
      tl.to(
        {},
        {
          duration: 0.001,
          onStart: function () {
            var mark = document.getElementById(markId);
            var ref = mark.getAttribute("data-mark-ref");
            if (!ref || !hl) return;
            mark.parentElement
              .querySelectorAll('.highlight[data-mark-id="' + ref + '"]')
              .forEach(function (div) {
                var c = div.querySelector("canvas");
                if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height);
                div.style.opacity = "1";
              });
            hl.reanimateMark(mark);
          },
          onReverseComplete: function () {
            var mark = document.getElementById(markId);
            var ref = mark.getAttribute("data-mark-ref");
            if (!ref) return;
            mark.parentElement
              .querySelectorAll('.highlight[data-mark-id="' + ref + '"]')
              .forEach(function (div) {
                div.style.opacity = "0";
              });
          },
        },
        time,
      );
    }

    gsap.set("#hero", { opacity: 0 });
    tl.to("#hero", { opacity: 1, duration: 0.6 }, 0);

    addHighlight("m1", 0.8);
    addHighlight("m2", 1.6);

    window.__timelines["highlight-demo"] = tl;
  </script>
</div>
```
