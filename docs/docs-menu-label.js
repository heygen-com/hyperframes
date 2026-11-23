// The top bar's "Docs" menu holds three sections with their own sidebars (docs.json, navigation.tabs[0].menu). Once a
// visitor is inside one, the bar still says "Docs" and two of the sidebars both start with "Start here", so nothing on
// the page says which section this is. This names the open section in the menu's own button ("Studio app ▾"), the way
// a picker shows what is picked. Mintlify runs every .js file in docs/ on every page
// (mintlify.com/docs/customize/custom-scripts). A section is known by its first page, which only its sidebar links to;
// keep these in step with docs.json. Anywhere else (Catalog, a page in no section) the button keeps "Docs".
(function () {
  var MENU = "Docs";
  var SECTIONS = [
    { name: "Studio app", firstPage: "/studio-app" },
    { name: "Developers", firstPage: "/developers/overview" },
    { name: "Make a video", firstPage: "/introduction" },
  ];

  var NAMES = [MENU].concat(
    SECTIONS.map(function (section) {
      return section.name;
    }),
  );

  // The button's own text node, renamed in place: React keeps its node, so its next update of the bar still works.
  function menuLabel() {
    var buttons = document.querySelectorAll("#navbar button.nav-tabs-item[aria-haspopup=menu]");
    for (var i = 0; i < buttons.length; i++) {
      var walker = document.createTreeWalker(buttons[i], NodeFilter.SHOW_TEXT);
      for (var node = walker.nextNode(); node; node = walker.nextNode()) {
        if (NAMES.indexOf(node.nodeValue.trim()) !== -1) return node;
      }
    }
    return null;
  }

  function openSection() {
    var sidebar = document.getElementById("sidebar-content");
    if (!sidebar) return null;
    for (var i = 0; i < SECTIONS.length; i++) {
      if (sidebar.querySelector('a[href="' + SECTIONS[i].firstPage + '"]')) return SECTIONS[i].name;
    }
    return null;
  }

  function update() {
    var label = menuLabel();
    if (!label) return;
    var text = openSection() || MENU;
    if (label.nodeValue !== text) label.nodeValue = text;
  }

  // Mintlify swaps pages without a reload and redraws the bar, so the label is set again after the page changes, at
  // most once a frame.
  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      update();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
  update();
})();
