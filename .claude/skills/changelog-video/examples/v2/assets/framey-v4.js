/* Framey v4: a drop-in, seek-safe Framey for HyperFrames compositions (GSAP 3). The green Studio guide.
 *
 *   <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
 *   <script src="assets/framey-v4.js"></script>          (copy this file into the project's assets/)
 *   <div id="fy"></div>
 *   const tl = gsap.timeline({ paused: true });
 *   const F = FrameyV4.framey(document.querySelector("#fy"), { tl, x: 960, y: 540, scale: 1.5 });
 *   FrameyV4.flyTo(F, 1400, 500, 1.0); FrameyV4.mood(F, "found", 1.6); FrameyV4.hop(F, 1.7);
 *   window.__timelines["main"] = tl;
 *
 * Canon: 03-brand/v4/BRAND-V4.md §6. Drawn with the public Studio component's own geometry
 * (packages/studio/src/components/FrameyGlyph.tsx: viewBox 65.55 34.315 69.22 69.22, the body path, rim 24 /
 * fill 19 with round joins, the eye at 111.6 68.2 r 11.5) and theme colours (#3ce6ac, #16121a). No wings, no mouth.
 * Rest pose = the glyph as drawn: tip up and to the left (the tip is the pointer), eye on the right.
 *
 * Units: scale 1 = a 100 px square frame that the glyph fills, centred on the host's (x, y). Distances you pass to
 * the moves (hop height, shake, bob) are px at scale 1. Faces, gaze and props work in the app's own units.
 * Everything is a tween or a set on the timeline you pass, so any frame can be sought in any order: no Math.random
 * (jitter comes from a seeded hash), no Date.now, no requestAnimationFrame, no repeat: -1.
 * Call the helpers in time order per Framey (moods and moves remember the previous state at build time).
 *
 * v2 → v4: same API minus the wings (flap, wings, POSES are gone; v2's "wings as hands" become the tip: point, tap,
 * push, or a hop / nudge). New: tap, push, wiggle, handOff (the app's own moves). Moods are the app's:
 * idle, found, official, thinking, error, plus blink. v2's zoom and happy faces are not in the app and are gone.
 */
(function (root) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";

  // ------------------------------------------------------------------ the app's glyph (app units)
  const APP = {
    view: [65.55, 34.315, 69.22, 69.22],
    body: "M77.55 48.44 L122.77 65.85 L99.3 89.41 Z",
    tipV: [77.55, 48.44], // the pointing corner (up-left)
    sideV: [122.77, 65.85], // the eye corner (right)
    baseV: [99.3, 89.41], // the lowest corner: what it stands on
    rimStroke: 24,
    bodyStroke: 19,
    eye: { cx: 111.6, cy: 68.2, r: 11.5 },
    mint: "#3ce6ac",
    rim: "#ffffff",
    ink: "#16121a",
  };
  const BOX = 100; // px of the square frame at scale 1
  const K = BOX / APP.view[2]; // px per app unit at scale 1
  const VC = [APP.view[0] + APP.view[2] / 2, APP.view[1] + APP.view[3] / 2]; // frame centre (app units)
  const R = APP.rimStroke / 2;

  // the tip's outer point: the round rim's furthest point along the corner's outward bisector
  const unit = (v) => {
    const l = Math.hypot(v[0], v[1]);
    return [v[0] / l, v[1] / l];
  };
  const tipOut = (() => {
    const [a, b, c] = [APP.tipV, APP.sideV, APP.baseV];
    const u1 = unit([b[0] - a[0], b[1] - a[1]]),
      u2 = unit([c[0] - a[0], c[1] - a[1]]);
    return unit([-(u1[0] + u2[0]), -(u1[1] + u2[1])]);
  })();
  const TIP_APP = [APP.tipV[0] + R * tipOut[0], APP.tipV[1] + R * tipOut[1]];
  const BASE_APP = [APP.baseV[0], APP.baseV[1] + R]; // the bottom of the rim under the lowest corner
  const CENT_APP = [
    (APP.tipV[0] + APP.sideV[0] + APP.baseV[0]) / 3,
    (APP.tipV[1] + APP.sideV[1] + APP.baseV[1]) / 3,
  ];
  // app units → px from the host centre at scale 1, rotation 0
  const px = (p) => [(p[0] - VC[0]) * K, (p[1] - VC[1]) * K];

  const C = {
    ...APP,
    box: BOX,
    k: K,
    tip: px(TIP_APP), // ≈ [-45.5, -41.1] px: what touches a button, a pill, a word
    tipAngle: (Math.atan2(tipOut[1], tipOut[0]) * 180) / Math.PI, // ≈ -138.4°: the way the tip points at rotation 0
    base: px(BASE_APP), // ≈ [-1.2, 46.9] px: what lands on a ledge
    centroid: px(CENT_APP),
    eyePx: px([APP.eye.cx, APP.eye.cy]), // ≈ [16.5, -1.1] px
    tipApp: TIP_APP,
    baseApp: BASE_APP,
    centroidApp: CENT_APP,
    reach: [4.2, 3.4], // gaze, app units for look(±1, ±1)
    breath: { period: 3.27, swell: 0.018 }, // the app's CSS
    blink: { close: 0.05, hold: 0.04, open: 0.07, sy: 0.12 }, // ~0.1 s at scaleY .12 (the app)
    orbitLap: 1.4, // thinking: the two dots circle once every 1.4 s (the app)
  };
  const MOODS = ["idle", "found", "official", "thinking", "error"];

  // seeded hash in [0, 1): the only "randomness" Framey is allowed
  function hash01(seed, i) {
    let t = (seed * 2654435761 + i * 40503) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const el = (name, attrs, parent) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.append(n);
    return n;
  };
  const so = (p) => `${p[0]} ${p[1]}`;
  // fix an SVG group's pivot once, at rest, with smoothOrigin off (GSAP otherwise shifts a group the first time a
  // tween hands it an svgOrigin). Tweens never pass svgOrigin again.
  const pin = (g, o) => gsap.set(g, { svgOrigin: so(o), smoothOrigin: false });

  // ------------------------------------------------------------------ build
  /** framey(host, opts) → F. host: an empty div (its x/y is the centre of Framey's frame).
   *  opts: { tl (required to animate), x, y, scale = 1 (or size in px = 100 × scale), rotation = 0, opacity = 1,
   *          mood = "idle", look: [dx, dy], shadow = true | false | "dark" | css filter string, props = true } */
  function framey(host, opts = {}) {
    const tl = opts.tl || root.__frameyTimeline;
    const scale = opts.size ? opts.size / BOX : (opts.scale ?? 1);
    Object.assign(host.style, {
      position: "absolute",
      left: "0px",
      top: "0px",
      width: "0px",
      height: "0px",
    });
    const bob = document.createElement("div");
    Object.assign(bob.style, {
      position: "absolute",
      left: "0px",
      top: "0px",
      width: "0px",
      height: "0px",
    });
    host.append(bob);
    const svg = el("svg", {
      viewBox: APP.view.join(" "),
      width: BOX,
      height: BOX,
      overflow: "visible",
      "aria-hidden": "true",
    });
    const sh = opts.shadow ?? true;
    Object.assign(svg.style, {
      position: "absolute",
      left: -BOX / 2 + "px",
      top: -BOX / 2 + "px",
      overflow: "visible",
      filter:
        sh === "dark"
          ? "drop-shadow(0 2px 6px rgba(0,0,0,.45))"
          : sh === true
            ? "drop-shadow(0 3.5px 8px rgba(19,17,9,.22))" // BRAND-V4: 0 .035·size .08·size
            : sh || "none",
    });
    bob.append(svg);
    // press (about the tip) > squash (about the base) > turn (about the base) > body (breath, centroid) > talk (base)
    const press = el("g", { class: "fy-press" }, svg);
    const squashG = el("g", { class: "fy-squash" }, press);
    const turn = el("g", { class: "fy-turn" }, squashG);
    const body = el("g", { class: "fy-body" }, turn);
    const talkG = el("g", { class: "fy-talk" }, body);
    const round = { "stroke-linejoin": "round" };
    el(
      "path",
      {
        d: APP.body,
        fill: APP.rim,
        stroke: APP.rim,
        "stroke-width": APP.rimStroke,
        ...round,
      },
      talkG,
    );
    el(
      "path",
      {
        d: APP.body,
        fill: APP.mint,
        stroke: APP.mint,
        "stroke-width": APP.bodyStroke,
        ...round,
      },
      talkG,
    );
    const { cx, cy, r } = APP.eye;
    const eye = el("g", { class: "fy-eye" }, talkG);
    el("circle", { cx, cy, r, fill: "#fff" }, eye);
    const look = el("g", { class: "fy-look" }, eye);
    const blinkG = el("g", { class: "fy-blink" }, look);
    const ink = APP.ink;
    const m = {};
    m.idle = el(
      "path",
      {
        d: `M${cx - 2.6} ${cy - 2.4} V${cy + 2.4} M${cx + 2.6} ${cy - 2.4} V${cy + 2.4}`,
        stroke: ink,
        "stroke-width": 2.4,
        "stroke-linecap": "round",
        fill: "none",
      },
      blinkG,
    );
    m.found = el("g", { transform: `translate(${cx + 1.7} ${cy - 2.3})` }, blinkG);
    el("circle", { r: 4.6, fill: ink }, m.found);
    el("circle", { cx: 1.4, cy: -1.6, r: 1.3, fill: "#fff" }, m.found);
    m.official = el("g", { transform: `translate(${cx} ${cy})` }, blinkG);
    el("circle", { r: 4.6, fill: ink }, m.official);
    el("circle", { cx: 1.4, cy: -1.6, r: 1.3, fill: "#fff" }, m.official);
    m.thinking = el("g", {}, blinkG);
    const orbit = el("g", { class: "fy-orbit" }, m.thinking);
    el("circle", { cx: cx - 2.8, cy, r: 1.9, fill: ink }, orbit);
    el("circle", { cx: cx + 2.8, cy, r: 1.9, fill: ink }, orbit);
    m.error = el(
      "path",
      {
        transform: `translate(${cx} ${cy})`,
        d: "M-5 -2 L-1.4 1.6 M-1.4 -2 L-5 1.6 M1.4 -2 L5 1.6 M5 -2 L1.4 1.6",
        stroke: ink,
        "stroke-width": 1.7,
        "stroke-linecap": "round",
        fill: "none",
      },
      blinkG,
    );
    // the closed eye (the sheet's blink): shown for the blink's hold only
    const lid = el(
      "path",
      {
        d: `M${cx - 4.6} ${cy} H${cx + 4.6}`,
        stroke: ink,
        "stroke-width": 2.2,
        "stroke-linecap": "round",
      },
      look,
    );

    // props from the launch film: reading glasses and the idea bulb, plus a floating magnifier. They float on the eye
    // or beside it; Framey never wears or holds them.
    const props = {};
    if (opts.props !== false) {
      props.glasses = el(
        "g",
        {
          class: "fy-glasses",
          fill: "none",
          stroke: "#3a2416",
          "stroke-width": 1.6,
        },
        talkG,
      );
      el("circle", { cx, cy, r: r - 1.2 }, props.glasses);
      el("path", { d: `M${cx - r + 1.2} ${cy - 1} q-6 -3 -10 1` }, props.glasses);
      el("path", { d: `M${cx + r - 1.2} ${cy - 1} l5 -2` }, props.glasses);
      props.bulb = el("g", { class: "fy-bulb" }, turn);
      const bulb = el("g", { transform: "translate(100 27)" }, props.bulb);
      el("circle", { r: 7.2, fill: "#fff6c9", opacity: 0.9 }, bulb);
      el("circle", { r: 4.6, fill: "#ffe27a" }, bulb);
      el("rect", { x: -2.4, y: 4.2, width: 4.8, height: 3.6, rx: 1, fill: "#b9b2a0" }, bulb);
      [0, 45, 90, 135, 180].forEach((a) =>
        el(
          "path",
          {
            d: "M0 -10.5 V-13.6",
            transform: `rotate(${a - 90})`,
            stroke: "#f1c94a",
            "stroke-width": 1.3,
            "stroke-linecap": "round",
          },
          bulb,
        ),
      );
      // magnifier: a ring round the (magnified) eye and a short handle out past the rim, floating
      props.lens = el("g", { class: "fy-lens" }, talkG);
      const lr = 15.2,
        a = Math.PI / 4;
      el(
        "path",
        {
          d: `M${cx + lr * Math.cos(a)} ${cy + lr * Math.sin(a)} L${cx + (lr + 11) * Math.cos(a)} ${cy + (lr + 11) * Math.sin(a)}`,
          stroke: "#131109",
          "stroke-width": 4.4,
          "stroke-linecap": "round",
        },
        props.lens,
      );
      el(
        "circle",
        {
          cx,
          cy,
          r: lr,
          fill: "rgba(214,240,255,0.22)",
          stroke: "#131109",
          "stroke-width": 2.6,
        },
        props.lens,
      );
      el(
        "path",
        {
          d: `M${cx - 10.5} ${cy - 5} A 11.6 11.6 0 0 1 ${cx - 4} ${cy - 10.8}`,
          stroke: "rgba(255,255,255,0.85)",
          "stroke-width": 1.6,
          fill: "none",
          "stroke-linecap": "round",
        },
        props.lens,
      );
    }

    const F = {
      host,
      bob,
      svg,
      press,
      squashG,
      turn,
      body,
      talkG,
      eye,
      look,
      blinkG,
      lid,
      orbit,
      moods: m,
      props,
      tl,
      _mood: opts.mood || "idle",
      _look: opts.look || [0, 0],
      // where the host is at the end of the last move built so far (build-time bookkeeping, never read at render)
      _at: { x: opts.x ?? 0, y: opts.y ?? 0, s: scale },
    };
    gsap.set(host, {
      x: opts.x ?? 0,
      y: opts.y ?? 0,
      scale,
      rotation: opts.rotation ?? 0,
      opacity: opts.opacity ?? 1,
    });
    pin(press, TIP_APP);
    pin(squashG, BASE_APP);
    pin(turn, BASE_APP);
    pin(body, CENT_APP);
    pin(talkG, BASE_APP);
    pin(eye, [cx, cy]);
    pin(blinkG, [cx, cy]);
    pin(orbit, [cx, cy]);
    Object.entries(props).forEach(([k, p]) => {
      pin(p, k === "bulb" ? [100, 27] : [cx, cy]); // props pop about their own centre
      gsap.set(p, { opacity: 0 });
    });
    MOODS.forEach((k) => gsap.set(m[k], { opacity: k === F._mood ? 1 : 0 }));
    gsap.set(lid, { opacity: 0 });
    gsap.set(look, { x: F._look[0] * C.reach[0], y: F._look[1] * C.reach[1] });
    return F;
  }
  const T = (F) => {
    if (!F.tl) throw new Error("framey: pass { tl } to framey(host, opts)");
    return F.tl;
  };

  // ------------------------------------------------------------------ the face
  /** blink at t: the pupils squash to scaleY .12, the closed lid shows for the hold, then they open (~0.16 s). */
  function blink(F, t) {
    const tl = T(F),
      b = C.blink;
    tl.to(F.blinkG, { scaleY: b.sy, duration: b.close, ease: "power2.in" }, t);
    tl.set(F.blinkG, { opacity: 0 }, t + b.close);
    tl.set(F.lid, { opacity: 1 }, t + b.close);
    tl.set(F.lid, { opacity: 0 }, t + b.close + b.hold);
    tl.set(F.blinkG, { opacity: 1 }, t + b.close + b.hold);
    tl.to(F.blinkG, { scaleY: 1, duration: b.open, ease: "power2.out" }, t + b.close + b.hold);
    return t + b.close + b.hold + b.open;
  }
  /** blinks between t0 and t1, every ~`every` s with seeded jitter (and the odd double blink); skips the last 0.3 s. */
  function blinks(F, t0, t1, { every = 2.6, jitter = 0.9, seed = 7, first = 0.5 } = {}) {
    let t = t0 + first,
      i = 0;
    while (t < t1 - 0.3) {
      blink(F, t);
      if (hash01(seed, i) < 0.18) blink(F, t + 0.22);
      t += every + (hash01(seed, i + 99) - 0.5) * 2 * jitter;
      i++;
    }
  }
  /** gaze: dx, dy in -1..1 of the pupil reach. The app follows a pointer in 80 ms linear; 0.12 s power2 on camera. */
  function look(F, dx, dy, t, dur = 0.12) {
    T(F).to(
      F.look,
      {
        x: dx * C.reach[0],
        y: dy * C.reach[1],
        duration: dur,
        ease: "power2.out",
      },
      t,
    );
    F._look = [dx, dy];
    return t + dur;
  }
  /** mood(F, name, t, { take = true, dur = 2.8, hops = 0 }): swap the face through a take (squash, new face, settle).
   *  names: idle · found · official (the still: centred round pupil) · thinking (the dots circle for `dur`) ·
   *  error (+ shake) · blink (just blinks). hops: the app's "found" hops (2 over 1.8 s). */
  function mood(F, name, t, { take = true, dur = 2.8, hops = 0 } = {}) {
    const tl = T(F);
    if (name === "blink") return blink(F, t);
    if (!F.moods[name])
      throw new Error(`framey: unknown mood "${name}" (have ${MOODS.join(", ")}, blink)`);
    const swap = take ? t + 0.07 : t;
    if (take) {
      tl.to(F.squashG, { scaleX: 1.05, scaleY: 0.93, duration: 0.07, ease: "power2.in" }, t);
      tl.to(F.squashG, { scaleX: 1, scaleY: 1, duration: 0.22, ease: "back.out(2.6)" }, swap);
    }
    MOODS.forEach((k) => {
      if (k !== name) tl.set(F.moods[k], { opacity: 0 }, swap);
    });
    tl.set(F.moods[name], { opacity: 1 }, swap);
    if (name === "thinking") {
      const laps = Math.max(1, Math.round(dur / C.orbitLap));
      tl.fromTo(
        F.orbit,
        { rotation: 0 },
        {
          rotation: 360 * laps,
          duration: laps * C.orbitLap,
          ease: "none",
          immediateRender: false,
        },
        swap,
      );
    }
    if (name === "error") shake(F, swap + 0.02);
    for (let i = 0; i < hops; i++) hop(F, swap + (take ? 0.24 : 0.02) + i * 0.9, i ? 12 : 18); // after the take settles
    F._mood = name;
    return swap + (take ? 0.22 : 0);
  }
  /** error shake: ±amp px (the app's 3 px at icon size), 0.6 s. */
  function shake(F, t, amp = 4) {
    const tl = T(F);
    [-amp, amp, -amp * 0.7, amp * 0.6, -amp * 0.3, 0].forEach((x, i) =>
      tl.to(F.svg, { x, duration: 0.1, ease: "sine.inOut" }, t + i * 0.1),
    );
    return t + 0.6;
  }

  // ------------------------------------------------------------------ the body
  /** squash (sx, sy) about the base (a landing, a stomp) and back. */
  function squash(F, t, sx = 1.14, sy = 0.86, inDur = 0.07, outDur = 0.16) {
    const tl = T(F);
    tl.to(F.squashG, { scaleX: sx, scaleY: sy, duration: inDur, ease: "power2.out" }, t);
    tl.to(F.squashG, { scaleX: 1, scaleY: 1, duration: outDur, ease: "back.out(2)" }, t + inDur);
    return t + inDur + outDur;
  }
  /** tap with the tip: the body pokes in toward the tip and springs back (a press, a click). */
  function tap(F, t, depth = 0.88) {
    const tl = T(F);
    tl.to(F.press, { scale: depth, duration: 0.06, ease: "power2.in" }, t);
    tl.to(F.press, { scale: 1, duration: 0.18, ease: "back.out(3)" }, t + 0.06);
    return t + 0.24;
  }
  /** hop of h px: anticipation, up (stretched), down, landing squash, settle (~0.55 s). */
  function hop(F, t, h = 26, { anticipate = true } = {}) {
    const tl = T(F),
      a = anticipate ? 0.06 : 0;
    if (anticipate)
      tl.to(F.squashG, { scaleX: 1.08, scaleY: 0.92, duration: a, ease: "power2.in" }, t);
    tl.to(F.svg, { y: -h, duration: 0.16, ease: "power2.out" }, t + a);
    tl.to(F.squashG, { scaleX: 0.95, scaleY: 1.06, duration: 0.16, ease: "power2.out" }, t + a);
    tl.to(F.svg, { y: 0, duration: 0.16, ease: "power2.in" }, t + a + 0.16);
    tl.to(F.squashG, { scaleX: 1, scaleY: 1, duration: 0.16, ease: "power2.in" }, t + a + 0.16);
    squash(F, t + a + 0.32, 1.12, 0.88, 0.07, 0.16);
    return t + a + 0.55;
  }
  /** the app's hover wiggle: −14° then +10° then rest, 0.5 s, about the base. */
  function wiggle(F, t, amp = 14) {
    const tl = T(F);
    tl.to(F.turn, { rotation: -amp, duration: 0.14, ease: "power2.out" }, t);
    tl.to(F.turn, { rotation: amp * 0.71, duration: 0.18, ease: "sine.inOut" }, t + 0.14);
    tl.to(F.turn, { rotation: 0, duration: 0.18, ease: "back.out(2)" }, t + 0.32);
    return t + 0.5;
  }
  /** breath: scale 1 → 1.018 → 1 every 3.27 s (the app's numbers), whole cycles in [t0, t1]. */
  function breath(F, t0, t1) {
    const tl = T(F),
      p = C.breath.period,
      n = Math.floor((t1 - t0) / p);
    for (let i = 0; i < n; i++) {
      tl.to(F.body, { scale: 1 + C.breath.swell, duration: p / 2, ease: "sine.inOut" }, t0 + i * p);
      tl.to(F.body, { scale: 1, duration: p / 2, ease: "sine.inOut" }, t0 + i * p + p / 2);
    }
  }
  /** float in place: amp px (host px), period 1.4 s. It has no wings; it simply hovers, as the app's glyph does. */
  function bob(F, t0, t1, { amp = 6, period = 1.4 } = {}) {
    const tl = T(F),
      n = Math.floor((t1 - t0) / period);
    for (let i = 0; i < n; i++) {
      const a = t0 + i * period;
      tl.to(F.bob, { y: -amp, duration: period / 2, ease: "sine.inOut" }, a);
      tl.to(F.bob, { y: 0, duration: period / 2, ease: "sine.inOut" }, a + period / 2);
    }
  }
  /** alive(F, t0, t1): breath + seeded blinks, the "never frozen" baseline for a held shot. */
  function alive(F, t0, t1, o = {}) {
    breath(F, t0, t1);
    blinks(F, t0, t1, o);
  }

  // ------------------------------------------------------------------ travel
  /** flyTo(F, x, y, t, o) → arrival time. A whip: lean into the move, motion blur, overshoot settle.
   *  o: { dur = 0.5, rotation = 0 (final), lean (deg, default from dx), blur = 6, arc = "back" | "none",
   *       easeX, easeY, from: { x, y } (if the host is still off-stage at build time, pass where it starts) } */
  function flyTo(F, x, y, t, o = {}) {
    const tl = T(F),
      dur = o.dur ?? 0.5;
    const fx = o.from ? o.from.x : F._at.x;
    F._at.x = x;
    F._at.y = y;
    const lean = o.lean ?? Math.max(-32, Math.min(32, (x - fx) / 18));
    const lt = Math.min(0.12, dur * 0.3);
    tl.to(F.host, { x, duration: dur, ease: o.easeX || "power3.out" }, t);
    tl.to(
      F.host,
      {
        y,
        duration: dur,
        ease: o.easeY || (o.arc === "none" ? "power3.out" : "back.out(1.5)"),
      },
      t,
    );
    tl.to(F.host, { rotation: lean, duration: lt, ease: "power2.out" }, t);
    // ends on arrival, so a flight can chain at the returned time
    tl.to(F.host, { rotation: o.rotation ?? 0, duration: dur - lt, ease: "back.out(1.8)" }, t + lt);
    if (o.blur !== 0)
      tl.fromTo(
        F.host,
        { filter: `blur(${o.blur ?? 6}px)` },
        {
          filter: "blur(0px)",
          duration: dur * 0.8,
          ease: "power2.out",
          immediateRender: false,
        },
        t,
      );
    return t + dur;
  }
  /** perch(F, x, y, t, o) → settle time: fly in and land with the base (its lowest corner) on (x, y), squash, blink. */
  function perch(F, x, y, t, o = {}) {
    const s = F._at.s;
    const at = flyTo(F, x - C.base[0] * s, y - C.base[1] * s, t, {
      easeY: "back.out(1.6)",
      ...o,
      rotation: 0,
    });
    squash(F, at, 1.14, 0.86, 0.07, 0.16);
    blink(F, at + 0.3);
    return at + 0.4;
  }
  /** where the host must be for the tip to touch (x, y) pointing along `angle` (deg, screen; default = rest pose,
   *  the cursor pose: tip up-left). → { x, y, rotation } */
  function tipPose(F, x, y, angle = C.tipAngle, s = F._at.s) {
    const rot = angle - C.tipAngle,
      r = (rot * Math.PI) / 180;
    const tx = (C.tip[0] * Math.cos(r) - C.tip[1] * Math.sin(r)) * s,
      ty = (C.tip[0] * Math.sin(r) + C.tip[1] * Math.cos(r)) * s;
    return { x: x - tx, y: y - ty, rotation: rot };
  }
  /** point(F, x, y, t, o) → time after the tap: the tip touches (x, y), then taps (o.tap = false to just point).
   *  o.angle: the way the tip points (deg; 90 = pointing down, 0 = right). Default: the rest pose (up-left, like a
   *  cursor arriving from the lower right), so no turn is needed. */
  function point(F, x, y, t, o = {}) {
    const P = tipPose(F, x, y, o.angle ?? C.tipAngle);
    const at = flyTo(F, P.x, P.y, t, {
      arc: "none",
      ...o,
      rotation: P.rotation,
    });
    if (o.tap !== false) tap(F, at + 0.05);
    return at + 0.25;
  }
  /** push(F, dx, dy, t, dur): shove something with the tip: lean in (press held), travel, release. → end time.
   *  Tween the pushed object yourself over [t, t + dur]. */
  function push(F, dx, dy, t, dur = 0.4, ease = "power2.inOut") {
    const tl = T(F);
    tl.to(F.press, { scale: 0.9, duration: 0.08, ease: "power2.out" }, t);
    F._at.x += dx;
    F._at.y += dy;
    tl.to(F.host, { x: F._at.x, y: F._at.y, duration: dur, ease }, t);
    tl.to(F.press, { scale: 1, duration: 0.2, ease: "back.out(2.6)" }, t + dur);
    return t + dur + 0.2;
  }
  /** flyAtCamera(F, t, o): tiny → rushes past the lens (blurred) → settles big, squash pop, blink. → settle time.
   *  o: { x = 960, y = 540, from = 0.12, peak = 4.8, hold = 3.3 } (scales) */
  function flyAtCamera(F, t, o = {}) {
    const tl = T(F),
      x = o.x ?? 960,
      y = o.y ?? 540;
    tl.set(
      F.host,
      { x, y: y + 20, scale: o.from ?? 0.12, rotation: -8, opacity: 1 },
      Math.max(0, t - 0.004),
    );
    tl.to(
      F.host,
      {
        scale: o.peak ?? 4.8,
        y,
        rotation: 3,
        duration: 0.3,
        ease: "power3.in",
      },
      t,
    );
    tl.fromTo(
      F.host,
      { filter: "blur(0px)" },
      {
        filter: "blur(7px)",
        duration: 0.3,
        ease: "power3.in",
        immediateRender: false,
      },
      t,
    );
    tl.to(
      F.host,
      { scale: o.hold ?? 3.3, rotation: 0, duration: 0.45, ease: "power3.out" },
      t + 0.3,
    );
    tl.to(F.host, { filter: "blur(0px)", duration: 0.3, ease: "power2.out" }, t + 0.3);
    squash(F, t + 0.62, 1.1, 0.9, 0.07, 0.2);
    blink(F, t + 0.92);
    F._at = { x, y, s: o.hold ?? 3.3 };
    return t + 1.1;
  }
  /** handOff(F, t): the app's hand-off flight: up and away (48, −28 px), turn 25°, shrink to .6, fade, 0.9 s ease-in. */
  function handOff(F, t, o = {}) {
    const tl = T(F),
      s = F._at.s;
    F._at.x += (o.dx ?? 48) * s;
    F._at.y += (o.dy ?? -28) * s;
    F._at.s = s * 0.6;
    tl.to(
      F.host,
      {
        x: F._at.x,
        y: F._at.y,
        rotation: 25,
        scale: F._at.s,
        opacity: 0,
        duration: 0.9,
        ease: "power2.in",
      },
      t,
    );
    return t + 0.9;
  }
  /** place(F, t, { x, y, scale, rotation, opacity }): a cut, not a move (teleport between shots). */
  function place(F, t, v) {
    T(F).set(F.host, v, t);
    F._at = { x: v.x ?? F._at.x, y: v.y ?? F._at.y, s: v.scale ?? F._at.s };
  }
  /** scaleTo(F, s, t, dur): grow or shrink in place. */
  function scaleTo(F, s, t, dur = 0.4, ease = "power3.inOut") {
    T(F).to(F.host, { scale: s, duration: dur, ease }, t);
    F._at.s = s;
    return t + dur;
  }
  /** exit(F, t, dx, dy, dur, o): leave frame with a lean and blur (o.shrink: dive into something and fade). */
  function exit(F, t, dx, dy, dur = 0.45, o = {}) {
    const tl = T(F);
    F._at.x += dx;
    F._at.y += dy;
    tl.to(
      F.host,
      {
        x: F._at.x,
        y: F._at.y,
        rotation: o.rotation ?? Math.max(-30, Math.min(30, dx / 20)),
        duration: dur,
        ease: "power3.in",
      },
      t,
    );
    if (o.shrink)
      tl.to(F.host, { scale: o.shrink, opacity: 0, duration: dur, ease: "power3.in" }, t);
    tl.to(F.host, { filter: "blur(6px)", duration: dur * 0.7, ease: "power2.in" }, t + dur * 0.3);
    return t + dur;
  }

  // ------------------------------------------------------------------ props and talk
  /** prop(F, "glasses" | "bulb" | "lens", t0, t1): pop a prop on (and off at t1). The lens magnifies the eye 1.2x. */
  function prop(F, name, t0, t1) {
    const tl = T(F),
      p = F.props[name];
    if (!p) throw new Error(`framey: unknown prop "${name}"`);
    tl.fromTo(
      p,
      { opacity: 0, scale: 0.4 },
      {
        opacity: 1,
        scale: 1,
        duration: 0.22,
        ease: "back.out(2.2)",
        immediateRender: false,
      },
      t0,
    );
    if (name === "lens") tl.to(F.eye, { scale: 1.2, duration: 0.22, ease: "back.out(2)" }, t0);
    if (t1 != null) {
      tl.to(p, { opacity: 0, scale: 0.2, duration: 0.18, ease: "power2.in" }, t1);
      if (name === "lens") tl.to(F.eye, { scale: 1, duration: 0.18, ease: "power2.inOut" }, t1);
    }
  }
  /** talk(F, t0, t1, o): no mouth, ever. The body pulses on syllables (seeded, ~rate/s) or on an envelope o.env
   *  (0..1 per frame at o.fps = 30, from the voice's RMS). Pair it with a cream bubble with ink text. */
  function talk(F, t0, t1, { rate = 5.5, seed = 3, env = null, fps = 30 } = {}) {
    const tl = T(F);
    if (env) {
      let last = -1;
      for (let i = 0; i < env.length && t0 + i / fps < t1; i++) {
        const e = Math.max(0, Math.min(1, env[i]));
        if (Math.abs(e - last) < 0.04) continue;
        last = e;
        tl.set(F.talkG, { scaleY: 1 + 0.05 * e, scaleX: 1 - 0.025 * e, y: -2.2 * e }, t0 + i / fps);
      }
      tl.set(F.talkG, { scaleY: 1, scaleX: 1, y: 0 }, t1);
      return;
    }
    let t = t0,
      i = 0;
    while (t < t1 - 0.12) {
      const k = 0.5 + hash01(seed, i);
      tl.to(
        F.talkG,
        {
          scaleY: 1 + 0.045 * k,
          scaleX: 1 - 0.022 * k,
          y: -2 * k,
          duration: 0.07,
          ease: "power2.out",
        },
        t,
      );
      tl.to(F.talkG, { scaleY: 1, scaleX: 1, y: 0, duration: 0.1, ease: "power2.in" }, t + 0.07);
      t += (1 / rate) * (0.7 + 0.6 * hash01(seed, i + 50));
      i++;
    }
  }

  root.FrameyV4 = {
    C,
    MOODS,
    framey,
    blink,
    blinks,
    look,
    mood,
    shake,
    squash,
    tap,
    hop,
    wiggle,
    breath,
    bob,
    alive,
    flyTo,
    perch,
    tipPose,
    point,
    push,
    flyAtCamera,
    handOff,
    exit,
    place,
    scaleTo,
    prop,
    talk,
    hash01,
  };
})(window);
