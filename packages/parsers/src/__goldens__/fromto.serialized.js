
    var tl = gsap.timeline({ paused: true });
    tl.fromTo("#hero", { x: -200, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, 0.1);
    tl.fromTo("#caption", { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45 }, 0.5);
    window.__timelines["hero-reveal"] = tl;
  