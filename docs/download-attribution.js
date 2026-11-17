// Studio download links name this visitor's PostHog id (`ph_id`), so hyperframes.studio counts the download under the
// same person as these docs' pageviews. Both sites send to one PostHog project, but each domain has its own cookie,
// so the download site cannot read this one. Mintlify runs every .js file in docs/ on every page
// (mintlify.com/docs/customize/custom-scripts). The id is added at click time only, so a copied link never carries it,
// and only when PostHog is running here and the visitor has not opted out of it.
// Every link to hyperframes.studio (download, pricing, changelog, community) also names where this visit began, as
// the homepage's links do: its utm tags, the kind of ad click id it came with (never the id) and `ref`, the site that
// sent it. hyperframes.studio keeps that as the visit's landing source for a later download or sign-in: the click's
// own Referer is these docs, or nothing at all, since Mintlify's navbar button is rel="noreferrer".
(function () {
  var TOKEN = "phc_zjjbX0PnWxERXrMHhkEJWj9A9BhGVLRReICgsfTMmpx";
  var STATE = "ph_" + TOKEN + "_posthog";
  // posthog-js keeps a visitor's opt-out under this key: "0" opted out, "1" opted in. It lives in localStorage by
  // default, in a cookie when a site configures that, so both are read.
  var OPT_OUT = "__ph_opt_in_out_" + TOKEN;
  var STUDIO = "hyperframes.studio";
  // The one address that reads `ph_id` (docs.json navbar and footer, quickstart.mdx link to it).
  var DOWNLOAD = "/studio/download";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // The campaign tags and ad click ids the download site reads, in its order.
  var CAMPAIGN = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
  var AD_CLICKS = ["gclid", "gbraid", "wbraid", "dclid", "fbclid", "msclkid", "ttclid", "twclid", "li_fat_id", "rdt_cid", "sccid", "epik"];
  // Our own sites and HeyGen's sign-in: a visit that moved between them says nothing about where it began.
  var NOT_A_SOURCE = /(^|\.)hyperframes\.(heygen\.com|studio|dev)$|^(app|accounts|api2)\.heygen\.com$/;
  // Where this visit began, shared with the homepage (web-marketing downloadUtms.ts, the same name, rules and
  // .heygen.com scope), so a visit that moves between the docs and the homepage keeps its first source either way, for
  // 30 days. A page that names no source keeps nothing; the first source is never replaced.
  var LANDING = "hf_hub_landing";
  var LANDING_DAYS = 30;
  // Longer tags than hyperframes.studio keeps (its TAG_MAX): it drops them, and the shared cookie must stay small.
  var TAG_MAX = 64;
  // The address a link had before a right-click menu put the source on it.
  var UNTAGGED = "data-hf-untagged-href";

  function rawCookie(name) {
    var prefix = name + "=";
    var raw = document.cookie.split("; ").find(function (c) {
      return c.indexOf(prefix) === 0;
    });
    return raw ? raw.slice(prefix.length) : null;
  }

  function cookie(name) {
    var raw = rawCookie(name);
    return raw === null ? null : decodeURIComponent(raw);
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

  // This visit's source as download-link params: the page's own campaign tags, the kind of ad click id and the site
  // that sent it, host alone (a path or query can name a person). Empty when the visit names none.
  function visitSource() {
    var page = new URLSearchParams(window.location.search);
    var out = new URLSearchParams();
    CAMPAIGN.forEach(function (name) {
      var value = page.get(name);
      if (value && value.length <= TAG_MAX) out.set(name, value);
    });
    var adClick = AD_CLICKS.find(function (name) {
      return (page.get(name) || "").trim();
    });
    if (adClick) out.set("ad_click", adClick);
    try {
      var ref = new URL(document.referrer);
      var host = ref.hostname.replace(/\.$/, "");
      if ((ref.protocol === "https:" || ref.protocol === "http:") && host && !NOT_A_SOURCE.test(host)) out.set("ref", host);
    } catch {
      // No Referer: a typed address, a bookmark or a link from an app.
    }
    return out.toString();
  }

  // The kept source, else this page's own (cookies blocked: this page's). URLSearchParams' encoding is already
  // cookie-safe (no space, comma or semicolon).
  var landing = visitSource();
  try {
    // Read as written: its value is already URL-encoded, and decoding would split a tag holding "&" or "=".
    var kept = rawCookie(LANDING);
    if (kept) landing = kept;
    else if (landing) {
      var heygen = /(^|\.)heygen\.com$/.test(window.location.hostname) ? "; domain=.heygen.com" : "";
      document.cookie = LANDING + "=" + landing + "; path=/" + heygen + "; max-age=" + LANDING_DAYS * 86400 + "; SameSite=Lax; Secure";
    }
  } catch {
    // keep this page's
  }

  // The link to hyperframes.studio an event is on, as a URL, or null for any other link.
  function studioLink(event) {
    var link = event.target instanceof Element && event.target.closest("a[href]");
    if (!link) return null;
    try {
      var url = new URL(link.href);
      return url.protocol === "https:" && url.hostname === STUDIO && url.port === "" ? { link: link, url: url } : null;
    } catch {
      return null;
    }
  }

  // A tag the link already names keeps its own value. Only the source's own names come back from the cookie, under the
  // same length cap as a fresh one, so a value kept there can never add any other parameter or grow a link.
  function addSource(url) {
    new URLSearchParams(landing).forEach(function (value, name) {
      var known =
        (CAMPAIGN.indexOf(name) !== -1 && value.length <= TAG_MAX) ||
        name === "ref" ||
        (name === "ad_click" && AD_CLICKS.indexOf(value) !== -1);
      if (known && !url.searchParams.has(name)) url.searchParams.set(name, value);
    });
  }

  function tag(event) {
    var found = studioLink(event);
    if (!found) return;
    var link = found.link;
    var url = found.url;
    var original = link.getAttribute("href");
    addSource(url);
    var id = url.pathname === DOWNLOAD && posthogLoaded() && !optedOut() && posthogId();
    if (id) url.searchParams.set("ph_id", id);
    // Nothing to add: the link as written (before a right-click menu tagged it) is what it already says. A Card compares
    // against that, not its current href: it follows its own href prop, which a menu-tagged href doesn't change.
    if (url.toString() === new URL(link.getAttribute(UNTAGGED) || link.href, location.href).toString()) return;
    // Mintlify's <Card> (its anchor carries data-client-link) opens its own href prop from React, never the link's current
    // href, so its click is followed here: a new tab for a middle click, Cmd/Ctrl-click or a target="_blank" link, else
    // this tab. Every other link keeps the browser's own follow of the href set below, so Mintlify's click handlers
    // (the navbar CTA's docs.navitem.cta_click) still run. Shift (new window) and Alt (save link) stay the browser's.
    var card = link.hasAttribute("data-client-link");
    var newTab = event.button === 1 || event.metaKey || event.ctrlKey || link.target === "_blank";
    if (card && (event.button === 0 || event.button === 1) && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      if (newTab) window.open(url.toString(), "_blank", /noreferrer/.test(link.rel) ? "noopener,noreferrer" : "noopener");
      else window.location.assign(url.toString());
      return;
    }
    link.href = url.toString();
    // Put the link back once the browser has followed it, so copying it later still leaves the id out.
    setTimeout(function () {
      link.setAttribute("href", original);
    }, 0);
  }

  // A right-click menu's Open in new tab or Copy link takes the href as it stands when the menu opens: the source goes on
  // and stays (it names no person); the id never does, as it is only added for a click and taken off after.
  function tagForMenu(event) {
    var found = studioLink(event);
    if (!found) return;
    addSource(found.url);
    if (found.url.toString() === found.link.href) return;
    if (!found.link.hasAttribute(UNTAGGED)) found.link.setAttribute(UNTAGGED, found.link.href);
    found.link.href = found.url.toString();
  }

  // Capture phase, before the browser follows the link; auxclick covers a middle-click into a new tab.
  document.addEventListener("click", tag, true);
  document.addEventListener("auxclick", tag, true);
  document.addEventListener("contextmenu", tagForMenu, true);
})();
