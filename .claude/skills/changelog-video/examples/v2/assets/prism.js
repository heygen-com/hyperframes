/* Soft prism light, as on hyperframes.dev: a bright cream core with a spectral fringe, heavily blurred.
 * Prism.streaks(host, ribbons, w, h) draws into `host` (an absolutely placed div) and returns the <g> of each ribbon,
 * so a timeline can tween each ribbon's opacity / x / y / scale. Static drawing: no timers, no randomness.
 * ribbon: { d (SVG path in w x h units), n: [nx, ny] fringe direction, gap = 20, sw = 26, blur = 22,
 *           op = 0.75, coreOp = 0.95 (use about 0.2 on dark grounds), fringeOp = 0.62, core (core stroke width) } */
(function (root) {
  "use strict";
  const SPEC = ["#ff3b3b", "#ff8f1f", "#ffe23b", "#3ff07a", "#22d8ff", "#4a6dff", "#a54bff"];
  function streaks(host, ribbons, w, h) {
    w = w || 1920;
    h = h || 1080;
    const id = (host.id || "prism") + "-f";
    let defs = "",
      body = "";
    ribbons.forEach(function (r, i) {
      const n = r.n || [0, 1],
        gap = r.gap || 20,
        sw = r.sw || 26,
        blur = r.blur || 22;
      const op = r.op == null ? 0.75 : r.op,
        coreOp = r.coreOp == null ? 0.95 : r.coreOp,
        fringeOp = r.fringeOp == null ? 0.62 : r.fringeOp;
      defs +=
        '<filter id="' +
        id +
        "b" +
        i +
        '" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="' +
        blur * 0.75 +
        '"/></filter>';
      defs +=
        '<filter id="' +
        id +
        "c" +
        i +
        '" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="' +
        blur * 1.4 +
        '"/></filter>';
      const fringe = SPEC.map(function (c, k) {
        return (
          '<path d="' +
          r.d +
          '" transform="translate(' +
          n[0] * (gap * (k + 1.6)) +
          " " +
          n[1] * (gap * (k + 1.6)) +
          ')" stroke="' +
          c +
          '" stroke-width="' +
          sw +
          '" fill="none" stroke-linecap="round"/>'
        );
      }).join("");
      const core =
        '<path d="' +
        r.d +
        '" stroke="#fffbf2" stroke-width="' +
        (r.core || sw * 2.4) +
        '" fill="none" stroke-linecap="round"/>';
      body +=
        '<g class="prism-ribbon" opacity="' +
        op +
        '"><g filter="url(#' +
        id +
        "b" +
        i +
        ')" opacity="' +
        fringeOp +
        '">' +
        fringe +
        '</g><g filter="url(#' +
        id +
        "c" +
        i +
        ')" opacity="' +
        coreOp +
        '">' +
        core +
        "</g></g>";
    });
    host.innerHTML =
      '<svg viewBox="0 0 ' +
      w +
      " " +
      h +
      '" width="' +
      w +
      '" height="' +
      h +
      '" preserveAspectRatio="none" style="position:absolute;left:0;top:0;overflow:visible"><defs>' +
      defs +
      "</defs>" +
      body +
      "</svg>";
    return Array.prototype.slice.call(host.querySelectorAll("g.prism-ribbon"));
  }

  /* The film's dark stage: near-black ground, warm amber leaks in two corners (the Fable light) and soft prism
   * streaks that float (the HyperFrames light). One call so every scene matches.
   * Prism.darkStage(host, tl, dur, { variant: 0 | 1 | 2 | 3, amber: 1 (leak strength), rainbow: 1 (streak strength), flareAt: [times] })
   * `host` is an empty, absolutely placed full-frame div that sits UNDER the scene's content (give it data-layout-ignore).
   * Returns { leaks: [a, b], ribbons: [g...], prism: div } so a scene can add its own hits (e.g. flare a leak on a beat). */
  const VARIANTS = [
    [
      { d: "M -260 1010 C 420 860, 1180 700, 2200 420", n: [0.18, 1], gap: 26, sw: 34, blur: 30 },
      { d: "M 1180 -160 C 1420 40, 1700 130, 2140 150", n: [0.3, 1], gap: 20, sw: 26, blur: 26 },
    ],
    [
      { d: "M -240 240 C 380 150, 1040 60, 2160 -60", n: [0.12, 1], gap: 24, sw: 30, blur: 28 },
      { d: "M -260 1120 C 460 1010, 1240 930, 2200 760", n: [0.14, 1], gap: 26, sw: 34, blur: 30 },
      { d: "M 1500 -200 C 1640 80, 1820 220, 2160 300", n: [0.5, 1], gap: 18, sw: 22, blur: 24 },
    ],
    [
      { d: "M -300 760 C 300 900, 900 1040, 1500 1240", n: [0.2, -1], gap: 24, sw: 32, blur: 30 },
      { d: "M 900 -200 C 1250 -40, 1650 60, 2200 60", n: [0.2, 1], gap: 22, sw: 28, blur: 28 },
    ],
    [
      { d: "M -260 120 C 300 60, 700 -40, 1100 -220", n: [0.16, 1], gap: 22, sw: 28, blur: 28 },
      { d: "M 700 1300 C 1150 1100, 1650 960, 2200 900", n: [0.2, 1], gap: 26, sw: 34, blur: 30 },
    ],
  ];
  function darkStage(host, tl, dur, o) {
    o = o || {};
    const amber = o.amber == null ? 1 : o.amber,
      rainbow = o.rainbow == null ? 1 : o.rainbow;
    const id = host.id || "stage";
    host.style.position = "absolute";
    host.style.left = "0px";
    host.style.top = "0px";
    host.style.width = "1920px";
    host.style.height = "1080px";
    host.style.background = "#070504";
    host.style.overflow = "hidden";
    const grad =
      "radial-gradient(circle, rgba(255,150,50,0.95) 0%, rgba(255,106,20,0.55) 26%, rgba(255,90,10,0.16) 50%, rgba(255,90,10,0) 68%)";
    function disc(l, t) {
      const d = document.createElement("div");
      d.style.cssText =
        "position:absolute;width:2000px;height:2000px;border-radius:50%;left:" +
        l +
        "px;top:" +
        t +
        "px;background:" +
        grad;
      host.appendChild(d);
      return d;
    }
    const a = disc(-1120, 260),
      b = disc(1020, -1180);
    const ph = document.createElement("div");
    ph.id = id + "-prism";
    ph.style.cssText = "position:absolute;left:0;top:0;width:1920px;height:1080px";
    host.appendChild(ph);
    const defs = VARIANTS[(o.variant || 0) % VARIANTS.length].map(function (r) {
      return {
        d: r.d,
        n: r.n,
        gap: r.gap,
        sw: r.sw,
        blur: r.blur,
        op: 1,
        coreOp: 0.26,
        fringeOp: 0.9,
      };
    });
    const ribbons = streaks(ph, defs, 1920, 1080);
    if (tl) {
      tl.fromTo(
        a,
        { scale: 0.92, opacity: 0.62 * amber, x: 0, y: 0, transformOrigin: "50% 50%" },
        { scale: 1.06, opacity: 0.74 * amber, x: 70, y: -40, duration: dur, ease: "sine.inOut" },
        0,
      );
      tl.fromTo(
        b,
        { scale: 1, opacity: 0.42 * amber, x: 0, y: 0, transformOrigin: "50% 50%" },
        { scale: 0.9, opacity: 0.34 * amber, x: -60, y: 40, duration: dur, ease: "sine.inOut" },
        0,
      );
      ribbons.forEach(function (g, i) {
        const dir = i % 2 ? -1 : 1;
        tl.fromTo(
          g,
          { opacity: 0.78 * rainbow, x: -70 * dir, y: 26 * dir },
          { opacity: 0.62 * rainbow, x: 70 * dir, y: -26 * dir, duration: dur, ease: "sine.inOut" },
          0,
        );
      });
      (o.flareAt || []).forEach(function (t) {
        tl.fromTo(
          ph,
          { opacity: 1.35 },
          { opacity: 1, duration: 0.7, ease: "power2.out", immediateRender: false },
          t,
        );
      });
    }
    return { leaks: [a, b], ribbons: ribbons, prism: ph };
  }

  /* Halftone dots, the HyperFrames Studio film's texture (its card reveal at 14.6 s and dot burst at 50.4 s), in the
   * film's orange. One helper so both sides of a seam match.
   * Prism.halftone(host, tl, { mode: "out" | "in", at, dur, cx, cy, color, pitch })
   *   "out": a disc of dots bursts from (cx, cy) and the dots swell until the frame is SOLID `color` at at + dur.
   *   "in":  starts as a solid `color` frame at `at`, the dots shrink away to nothing by at + dur (what is under shows).
   * Append it LAST in the scene root so it covers everything. Returns the element. */
  function halftone(host, tl, o) {
    o = o || {};
    const mode = o.mode || "out",
      at = o.at || 0,
      dur = o.dur || 0.35,
      color = o.color || "#ff8a2a",
      pitch = o.pitch || 28;
    const cx = o.cx == null ? 960 : o.cx,
      cy = o.cy == null ? 540 : o.cy;
    const el = document.createElement("div");
    el.setAttribute("data-layout-ignore", "");
    el.style.cssText =
      "position:absolute;left:0;top:0;width:1920px;height:1080px;pointer-events:none;opacity:0";
    el.style.setProperty("--d", mode === "in" ? "100" : "16");
    el.style.setProperty("--r", "0");
    el.style.backgroundImage =
      "radial-gradient(circle at 50% 50%, " +
      color +
      " calc(var(--d) * 1%), rgba(0,0,0,0) calc(var(--d) * 1% + 2.5%))";
    el.style.backgroundSize = pitch + "px " + pitch + "px";
    el.style.backgroundPosition =
      (cx % pitch) - pitch / 2 + "px " + ((cy % pitch) - pitch / 2) + "px";
    if (mode === "out") {
      const m =
        "radial-gradient(circle at " +
        cx +
        "px " +
        cy +
        "px, #000 calc(var(--r) * 1px), rgba(0,0,0,0) calc(var(--r) * 1px + 120px))";
      el.style.webkitMaskImage = m;
      el.style.maskImage = m;
    }
    host.appendChild(el);
    if (mode === "out") {
      tl.set(el, { opacity: 1 }, at);
      tl.fromTo(el, { "--r": 0 }, { "--r": 2400, duration: dur * 0.8, ease: "power2.in" }, at);
      tl.fromTo(el, { "--d": 16 }, { "--d": 104, duration: dur, ease: "power2.in" }, at);
    } else {
      tl.set(el, { opacity: 1 }, at);
      tl.fromTo(el, { "--d": 104 }, { "--d": 0, duration: dur, ease: "power2.out" }, at);
      tl.set(el, { opacity: 0 }, at + dur);
    }
    return el;
  }

  /* The HyperFrames wordmark alone (the official lockup's own letter shapes: no "HeyGen", no mark, nothing re-typeset),
   * as a plain text animation inside a soft prism fan:
   *   - a soft, wide three-ribbon rainbow fan (the same light as the prism shot in n2-meet) opens left to right from a point;
   *   - the eleven letters arrive one frame apart, left to right: blur 12 px -> sharp in 0.16 s, bright then cooling to cream;
   *   - the fan's middle ribbon then goes out so the wordmark sits in the dark lane, and the outer two dim or fade.
   * Prism.wordmark(host, tl, { x, y, width, landAt | at, fan: { ox, oy } | false, fanFade: true | false })
   *   host: an empty full-frame div (data-layout-ignore) placed UNDER Framey. x, y: top-left of the wordmark; height = width * 37 / 263.
   *   landAt: when the last letter is sharp (use a beat); or at: when the first letter starts. fan origin defaults to just left of the wordmark, mid-height.
   *   fanFade (default true): the fan fades out about a second after it opens; false keeps the two outer ribbons, dim.
   * Returns { letters, fan, ribbons, at, doneAt, height }. */
  const WM = [
    "M0 71.9996V42.7256H7.7367V53.1806H17.9826V42.7256H25.7193V71.9996H17.9826V59.8718H7.7367V71.9996H0Z",
    "M31.9606 78.4405L36.0171 69.5329L26.9004 48.5811H35.1389L40.0737 60.6252L44.9666 48.5811H52.5779L39.8646 78.4405H31.9606Z",
    "M53.3711 78.4404V48.5809H60.9823V52.052C62.446 49.501 65.0807 48.0791 68.3008 48.0791C74.3647 48.0791 78.9649 53.3066 78.9649 60.2487C78.9649 67.2745 74.3229 72.4602 68.259 72.4602C65.0807 72.4602 62.446 71.1637 60.9823 68.78V78.4404H53.3711ZM66.1262 66.1872C69.2627 66.1872 71.3119 63.7616 71.3119 60.2905C71.3119 56.8195 69.2627 54.4357 66.1262 54.4357C62.7388 54.4357 60.9823 57.2795 60.9823 59.7051V60.9178C60.9823 63.3434 62.7388 66.1872 66.1262 66.1872Z",
    "M93.4397 72.6269C85.4939 72.6269 80.2246 67.5667 80.2246 60.4155C80.2246 53.2643 85.4521 47.9531 92.5615 47.9531C99.1273 47.9531 103.686 52.7206 103.686 59.7045C103.686 60.7082 103.56 61.6701 103.518 62.4647H87.5849C88.2541 65.2666 90.7214 66.8139 94.6525 66.8139C97.1199 66.8139 99.4618 66.1866 101.135 65.0993V70.7868C99.3782 71.916 96.4508 72.6269 93.4397 72.6269ZM87.5849 57.5717H96.869C96.7435 54.9789 95.0289 53.4734 92.4779 53.4734C89.9687 53.4734 88.1286 54.9789 87.5849 57.5717Z",
    "M105.645 72V48.5808H113.214V52.9719C114.218 50.0445 116.183 48.2881 118.692 48.2881C119.361 48.2881 119.989 48.4135 120.407 48.6645V55.8993C119.822 55.5648 119.111 55.4393 118.274 55.4393C115.138 55.4393 113.256 57.6558 113.256 61.2941V72H105.645Z",
    "M122.643 71.9996V42.7256H139.371V49.124H130.379V54.477H138.911V60.5827H130.379V71.9996H122.643Z",
    "M141.258 72V48.5808H148.827V52.9719C149.831 50.0445 151.796 48.2881 154.306 48.2881C154.975 48.2881 155.602 48.4135 156.02 48.6645V55.8993C155.435 55.5648 154.724 55.4393 153.887 55.4393C150.751 55.4393 148.869 57.6558 148.869 61.2941V72H141.258Z",
    "M167.26 72.4602C161.154 72.4602 156.596 67.2745 156.596 60.3324C156.596 53.3066 161.196 48.0791 167.302 48.0791C170.438 48.0791 173.031 49.4173 174.536 51.8429V48.5809H182.148V72.0001H174.536V68.4873C173.031 71.0801 170.438 72.4602 167.26 72.4602ZM169.393 66.1872C172.78 66.1872 174.536 63.3434 174.536 60.876V59.6632C174.536 57.2377 172.78 54.4357 169.393 54.4357C166.298 54.4357 164.207 56.7777 164.207 60.2905C164.207 63.7616 166.298 66.1872 169.393 66.1872Z",
    "M184.998 72.0001V48.5809H192.609V51.6756C193.989 49.4173 196.373 48.0791 199.426 48.0791C202.521 48.0791 204.779 49.5428 206.075 52.052C207.497 49.5846 210.132 48.0791 213.352 48.0791C218.245 48.0791 221.214 51.592 221.214 57.0286V72.0001H213.603V58.5341C213.603 55.774 212.557 54.4357 210.634 54.4357C208.459 54.4357 206.912 56.234 206.912 59.0778V72.0001H199.3V58.5341C199.3 55.774 198.255 54.4357 196.373 54.4357C194.157 54.4357 192.609 56.234 192.609 59.0778V72.0001H184.998Z",
    "M236.338 72.6269C228.392 72.6269 223.123 67.5667 223.123 60.4155C223.123 53.2643 228.351 47.9531 235.46 47.9531C242.026 47.9531 246.584 52.7206 246.584 59.7045C246.584 60.7082 246.459 61.6701 246.417 62.4647H230.483C231.152 65.2666 233.62 66.8139 237.551 66.8139C240.018 66.8139 242.36 66.1866 244.033 65.0993V70.7868C242.277 71.916 239.349 72.6269 236.338 72.6269ZM230.483 57.5717H239.767C239.642 54.9789 237.927 53.4734 235.376 53.4734C232.867 53.4734 231.027 54.9789 230.483 57.5717Z",
    "M252.115 72.502C250.192 72.502 248.268 72.0838 246.93 71.3728V65.6853C247.808 66.3126 248.937 66.689 250.066 66.689C251.739 66.689 252.784 65.8526 252.784 64.5562C252.784 63.8452 252.492 63.0925 251.655 62.0888L249.899 59.956C248.728 58.4923 248.226 56.9031 248.226 55.2721C248.226 51.0065 251.864 48.0791 256.883 48.0791C258.723 48.0791 260.438 48.4555 261.65 49.0828V54.7703C260.898 54.2266 259.768 53.8503 258.723 53.8503C257.092 53.8503 256.046 54.6867 256.046 55.8994C256.046 56.6522 256.423 57.405 257.259 58.4086L258.974 60.4996C260.187 62.047 260.73 63.5943 260.73 65.2671C260.73 69.5746 257.05 72.502 252.115 72.502Z",
  ];
  function wordmark(host, tl, o) {
    o = o || {};
    const x = o.x == null ? 460 : o.x,
      y = o.y == null ? 470 : o.y,
      W = o.width || 1000,
      H = (W * 37) / 263;
    const STEP = 0.0334,
      IN = 0.16,
      n = WM.length;
    const at = o.landAt != null ? o.landAt - ((n - 1) * STEP + IN) : o.at || 0,
      doneAt = at + (n - 1) * STEP + IN;
    host.style.position = "absolute";
    host.style.left = "0px";
    host.style.top = "0px";
    host.style.width = "1920px";
    host.style.height = "1080px";
    let fan = null,
      ribbons = [];
    if (o.fan !== false) {
      const ox = o.fan && o.fan.ox != null ? o.fan.ox : x - 110,
        oy = o.fan && o.fan.oy != null ? o.fan.oy : y + H / 2;
      fan = document.createElement("div");
      fan.id = (host.id || "wm") + "-fan";
      fan.style.cssText = "position:absolute;left:0;top:0;width:1920px;height:1080px;opacity:0";
      host.appendChild(fan);
      const ray = function (deg) {
        const r = (deg * Math.PI) / 180;
        return (
          "M " +
          ox +
          " " +
          oy +
          " L " +
          (ox + 2000 * Math.cos(r)).toFixed(1) +
          " " +
          (oy + 2000 * Math.sin(r)).toFixed(1)
        );
      };
      ribbons = streaks(
        fan,
        [
          {
            d: ray(-15.9),
            n: [-0.274, -0.962],
            gap: 13,
            sw: 20,
            blur: 17,
            op: 1,
            coreOp: 0.3,
            fringeOp: 0.75,
          },
          {
            d: ray(-2.2),
            n: [0.038, 0.999],
            gap: 11,
            sw: 18,
            blur: 15,
            op: 1,
            coreOp: 0.34,
            fringeOp: 0.75,
          },
          {
            d: ray(15.9),
            n: [-0.274, 0.962],
            gap: 13,
            sw: 20,
            blur: 17,
            op: 1,
            coreOp: 0.3,
            fringeOp: 0.75,
          },
        ],
        1920,
        1080,
      );
      const f0 = at - 0.12;
      tl.set(fan, { opacity: 1 }, f0);
      tl.fromTo(
        fan,
        { clipPath: "inset(0px " + (1920 - ox) + "px 0px 0px)" },
        { clipPath: "inset(0px 0px 0px 0px)", duration: 0.32, ease: "expo.out" },
        f0,
      );
      tl.fromTo(
        ribbons[1],
        { opacity: 1 },
        { opacity: 0, duration: 0.3, ease: "power2.out" },
        at + 0.16,
      ); // the middle one goes out: a dark lane for the word
      tl.fromTo(
        ribbons[0],
        { opacity: 1 },
        { opacity: 0.6, duration: 0.5, ease: "power2.out" },
        doneAt,
      );
      tl.fromTo(
        ribbons[2],
        { opacity: 1 },
        { opacity: 0.6, duration: 0.5, ease: "power2.out" },
        doneAt,
      );
      if (o.fanFade !== false)
        tl.fromTo(
          fan,
          { opacity: 1 },
          { opacity: 0, duration: 0.6, ease: "power2.inOut", immediateRender: false },
          doneAt + 0.55,
        );
    }
    const A = "blur(12px) brightness(1.6) drop-shadow(0px 0px 18px rgba(255,170,70,0.9))";
    const Bf = "blur(0px) brightness(1.6) drop-shadow(0px 0px 18px rgba(255,170,70,0.9))";
    const C = "blur(0px) brightness(1) drop-shadow(0px 0px 18px rgba(255,170,70,0))";
    const letters = WM.map(function (d, i) {
      const el = document.createElement("div");
      el.style.cssText =
        "position:absolute;left:" +
        x +
        "px;top:" +
        y +
        "px;width:" +
        W +
        "px;height:" +
        H +
        "px;opacity:0";
      el.innerHTML =
        '<svg viewBox="0 42.2 263 37" width="' +
        W +
        '" height="' +
        H +
        '" style="display:block;overflow:visible"' +
        (i === 0 ? ' role="img" aria-label="HyperFrames"' : ' aria-hidden="true"') +
        '><path d="' +
        d +
        '" fill="#f4efe6"/></svg>';
      host.appendChild(el);
      const t = at + i * STEP;
      tl.fromTo(
        el,
        { opacity: 0, x: -22, filter: A },
        { opacity: 1, x: 0, filter: Bf, duration: IN, ease: "power3.out" },
        t,
      );
      tl.to(el, { filter: C, duration: 0.45, ease: "power2.out" }, t + IN);
      return el;
    });
    return { letters: letters, fan: fan, ribbons: ribbons, at: at, doneAt: doneAt, height: H };
  }
  root.Prism = {
    streaks: streaks,
    darkStage: darkStage,
    halftone: halftone,
    wordmark: wordmark,
    SPEC: SPEC,
  };
})(window);
