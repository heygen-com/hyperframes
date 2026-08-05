window.__timelines = window.__timelines || {};
var sceneSpecs = [
  ["open", 0],
  ["blind-spot", 8],
  ["existing-loop", 16],
  ["one-command", 24],
  ["closed-loop", 32],
  ["packet", 40],
  ["rollout", 48],
  ["volume", 56],
  ["fair-comparison", 64],
  ["two-halves", 72],
  ["experiment", 80],
  ["close", 88],
];

sceneSpecs.forEach(function (spec) {
  var id = spec[0];
  var scene = document.getElementById("scene-" + id);
  var tl = gsap.timeline({ paused: true });
  var reveals = scene.querySelectorAll("[data-reveal]");
  if (reveals.length)
    tl.fromTo(
      reveals,
      { y: 34, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.72, stagger: 0.11, ease: "power3.out" },
      0.18,
    );
  var orbit = scene.querySelectorAll("[data-orbit]");
  if (orbit.length) tl.to(orbit, { rotation: 360, duration: 7.4, ease: "none" }, 0);
  var bars = scene.querySelectorAll(".dot-fill.after");
  if (bars.length)
    tl.fromTo(
      bars,
      { scaleX: 0.02, transformOrigin: "left center" },
      { scaleX: 1, duration: 1.5, ease: "power3.out" },
      0.8,
    );
  var chartReveal = scene.querySelector(".chart-reveal");
  if (chartReveal)
    tl.fromTo(
      chartReveal,
      { attr: { width: 0 } },
      { attr: { width: 1120 }, duration: 1.8, ease: "power2.inOut" },
      0.5,
    );
  window.__timelines[id] = tl;
});

var rootTimeline = gsap.timeline({ paused: true });
rootTimeline.to({}, { duration: 96 });
rootTimeline.eventCallback("onUpdate", function () {
  var t = rootTimeline.time();
  sceneSpecs.forEach(function (spec) {
    var id = spec[0];
    var start = spec[1];
    var el = document.getElementById("scene-" + id);
    var active = t >= start && t < start + 8;
    el.style.opacity = active ? "1" : "0";
    el.style.visibility = active ? "visible" : "hidden";
    el.style.pointerEvents = active ? "auto" : "none";
    window.__timelines[id].seek(Math.max(0, Math.min(8, t - start)), false);
  });
});
window.__timelines.root = rootTimeline;
window.__hfSetTime = function (time) {
  rootTimeline.seek(time, false);
};
rootTimeline.seek(0, false);

(function () {
  var scenes = sceneSpecs.map(function (spec) {
    return { id: spec[0], start: spec[1], duration: 8 };
  });
  function postTimeline() {
    parent.postMessage(
      { source: "hf-preview", type: "timeline", durationInFrames: 2880, scenes: scenes },
      "*",
    );
  }
  if (document.readyState === "complete") setTimeout(postTimeline, 300);
  else
    window.addEventListener("load", function () {
      setTimeout(postTimeline, 300);
    });
})();
