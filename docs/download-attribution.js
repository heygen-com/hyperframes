// Studio download links name this visitor's PostHog id (`ph_id`), so hyperframes.studio counts the download under the
// same person as these docs' pageviews. Both sites send to one PostHog project, but each domain has its own cookie,
// so the download site cannot read this one. Mintlify runs every .js file in docs/ on every page
// (mintlify.com/docs/customize/custom-scripts). The id is added at click time only, so a copied link never carries it,
// and only when PostHog is running here and the visitor has not opted out of it.
(function () {
  var TOKEN = "phc_zjjbX0PnWxERXrMHhkEJWj9A9BhGVLRReICgsfTMmpx";
  var STATE = "ph_" + TOKEN + "_posthog";
  // posthog-js keeps a visitor's opt-out under this key: "0" opted out, "1" opted in. It lives in localStorage by
  // default, in a cookie when a site configures that, so both are read.
  var OPT_OUT = "__ph_opt_in_out_" + TOKEN;
  // The one download address the docs link to (docs.json navbar and footer, quickstart.mdx).
  var DOWNLOAD = { protocol: "https:", hostname: "hyperframes.studio", pathname: "/studio/download" };
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function cookie(name) {
    var prefix = name + "=";
    var raw = document.cookie.split("; ").find(function (c) {
      return c.indexOf(prefix) === 0;
    });
    return raw ? decodeURIComponent(raw.slice(prefix.length)) : null;
  }

  function stored(name) {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  }

  // Mintlify loads posthog-js for this token from its own proxy (ph.mintlify.com/array/<token>/...). Without that
  // script on the page PostHog is not running here, so nothing is forwarded.
  function posthogLoaded() {
    return Array.prototype.some.call(document.scripts, function (s) {
      return s.src.indexOf("/array/" + TOKEN + "/") !== -1;
    });
  }

  function optedOut() {
    var choice = stored(OPT_OUT) || cookie(OPT_OUT);
    if (choice !== null && String(choice).replace(/"/g, "") !== "1") return true;
    // A browser-wide "do not track" or Global Privacy Control signal counts as no consent.
    return navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
  }

  function posthogId() {
    var raw = cookie(STATE) || stored(STATE);
    if (!raw) return null;
    try {
      var id = JSON.parse(raw).distinct_id;
      return typeof id === "string" && UUID.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  function tag(event) {
    var link = event.target instanceof Element && event.target.closest("a[href]");
    if (!link) return;
    var url;
    try {
      url = new URL(link.href);
    } catch {
      return;
    }
    if (
      url.protocol !== DOWNLOAD.protocol ||
      url.hostname !== DOWNLOAD.hostname ||
      url.port !== "" ||
      url.pathname !== DOWNLOAD.pathname
    ) {
      return;
    }
    if (!posthogLoaded() || optedOut()) return;
    var id = posthogId();
    if (!id) return;
    var original = link.getAttribute("href");
    url.searchParams.set("ph_id", id);
    link.href = url.toString();
    // Put the link back once the browser has followed it, so copying it later still leaves the id out.
    setTimeout(function () {
      link.setAttribute("href", original);
    }, 0);
  }

  // Capture phase, before the browser follows the link; auxclick covers a middle-click into a new tab.
  document.addEventListener("click", tag, true);
  document.addEventListener("auxclick", tag, true);
})();
