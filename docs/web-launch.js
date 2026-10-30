// The "Web Studio" tab and the "Sign up" button (docs.json) stay hidden until web Studio launches. Launch is one switch:
// the homepage's `hyperframes-signup-cta` PostHog flag, which already shows Sign up on hyperframes.heygen.com. When it
// puts this visitor in `signup`, the page gets `hf-web-launch` and custom.css shows both. Mintlify's own PostHog is a
// different project and isn't reachable from here, so this asks HeyGen's PostHog proxy for that one flag directly.
// The visitor id sent is a random one kept for these docs only, so no docs or HeyGen identity leaves the page.
// Anything that fails (blocked, offline, flag off) leaves the items hidden, which is today's bar.
(function () {
  var FLAG = "hyperframes-signup-cta";
  var ON = "signup";
  var CLASS = "hf-web-launch";
  var CACHE = "hf_web_launch"; // per tab session, so client-side page changes don't ask again
  // HeyGen's public PostHog key and proxy, the same ones the homepage ships to every browser.
  var ENDPOINT = "https://data.heygen.com/flags/?v=2";
  var KEY = "phc_bcoaBa4uZdMp0CzXr7QhZRRpnNGgBRRZ1GStvuJVAgJ";

  function store(kind, name, value) {
    try {
      var s = window[kind];
      return value === undefined ? s.getItem(name) : s.setItem(name, value);
    } catch {
      return null;
    }
  }

  function apply(on) {
    document.documentElement.classList.toggle(CLASS, on);
  }

  // QA: ?variant=signup shows both, like the homepage's override.
  if (new URLSearchParams(location.search).get("variant") === ON) return apply(true);

  var cached = store("sessionStorage", CACHE);
  if (cached !== null) return apply(cached === "1");

  // A stable random id, so a 50/50 rollout keeps showing a visitor the same bar.
  var id = store("localStorage", "hf_flag_id");
  if (!id) {
    id = crypto.randomUUID();
    store("localStorage", "hf_flag_id", id);
  }

  fetch(ENDPOINT, {
    // A plain-text body, as posthog-js sends it: a JSON content type would need a CORS preflight, which HeyGen's
    // proxy refuses.
    method: "POST",
    body: JSON.stringify({ api_key: KEY, distinct_id: id, flag_keys_to_evaluate: [FLAG] }),
  })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (data) {
      var flag = data && data.flags && data.flags[FLAG];
      var on = !!flag && flag.enabled === true && flag.variant === ON;
      store("sessionStorage", CACHE, on ? "1" : "0");
      apply(on);
    })
    .catch(function () {});
})();
