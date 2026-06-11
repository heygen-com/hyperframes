
    window.__timelines = window.__timelines || {};
gsap.defaults({ force3D: true });
const tl = gsap.timeline({ paused: true, defaults: { duration: 0.45, ease: "power3.out" } });
    tl.from(".headline span", { y: 46, opacity: 0, duration: 0.38, ease: "back.out(1.35)", stagger: 0.055 }, 0.05);
    tl.from(".ambient-word", { scale: 0.92, opacity: 0, duration: 0.5, ease: "power3.out" }, 0.08);
    tl.from(".ambient-line", { scaleX: 0, opacity: 0, duration: 0.42, ease: "power3.out", stagger: 0.08 }, 0.16);
    tl.from(".headline .sub", { y: 20, opacity: 0, duration: 0.28, ease: "power3.out" }, 0.2);
    window.__timelines["vpn-youtube-spot"] = tl;
  