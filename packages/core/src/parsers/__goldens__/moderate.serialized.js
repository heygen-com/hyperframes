
    window.__timelines = window.__timelines || {};
var tl = gsap.timeline({ paused: true });
    tl.to("#card", { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 0.1);
    tl.to("#subscribe-btn", { scale: 0.92, duration: 0.15, ease: "power2.out" }, 1);
    tl.to("#subscribe-btn", { scale: 1, duration: 0.4, ease: "elastic.out(1, 0.4)" }, 1.15);
    tl.to("#btn-subscribe", { opacity: 0, duration: 0.08, ease: "none" }, 1.15);
    tl.to("#btn-subscribed", { opacity: 1, duration: 0.08, ease: "none" }, 1.18);
    tl.to("#card", { y: 300, opacity: 0, duration: 0.25, ease: "power3.in" }, 3.8);
    window.__timelines["yt-lower-third"] = tl;
  