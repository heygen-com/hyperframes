
    var tl = gsap.timeline({ paused: true });
    tl.to("#notification", { x: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 0.2);
    tl.to("#notification", { x: 420, opacity: 0, duration: 0.3, ease: "power3.in" }, 4.2);
    window.__timelines["macos-notification"] = tl;
  