// QA gallery only: per-card 0-10 taste rating with localStorage persistence and
// a one-click export of all decisions (top 20 computed from the scores).
// Not shipped; QA surface only.
(function () {
  var KEY = "hfqa-ratings-v1";

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}");
    } catch {
      return {};
    }
  }
  function save(ratings) {
    localStorage.setItem(KEY, JSON.stringify(ratings));
  }

  var css = [
    ".rate-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-top: 1px solid #26262b; background: #101013; }",
    ".rate-row input[type=range] { flex: 1; accent-color: #e5484d; }",
    ".rate-val { min-width: 30px; text-align: center; font: 700 13px ui-monospace, monospace; color: #8a8a92; border: 1px solid #26262b; border-radius: 6px; padding: 3px 0; }",
    ".card.rated-hi { border-color: #2f9e44; box-shadow: 0 0 0 1px #2f9e44; }",
    ".card.rated-hi .rate-val { color: #51cf66; border-color: #2f9e44; }",
    "#rate-bar { position: fixed; right: 18px; bottom: 18px; z-index: 999; display: flex; gap: 10px; align-items: center; padding: 10px 14px; background: #17171a; border: 1px solid #34343a; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.5); font: 13px ui-monospace, monospace; color: #c9c9cf; }",
    "#rate-bar button { cursor: pointer; padding: 6px 12px; border: 1px solid #e5484d; border-radius: 8px; background: #e5484d; color: #fff; font: 600 13px ui-monospace, monospace; }",
    "#rate-bar button.ok { background: #2f9e44; border-color: #2f9e44; }",
    "#rate-bar .clear { background: transparent; border-color: #34343a; color: #8a8a92; }",
  ].join("\n");
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var ratings = load();

  function groupOf(card) {
    var section = card.closest("section");
    var h2 = section && section.querySelector("h2");
    return h2 ? h2.textContent.trim() : "";
  }

  function applyCardState(card, value) {
    card.classList.toggle("rated-hi", typeof value === "number" && value >= 8);
  }

  function wire(card) {
    if (card.__hfRateWired) return;
    card.__hfRateWired = true;
    var name = card.getAttribute("data-candidate");
    if (!name) return;
    var row = document.createElement("div");
    row.className = "rate-row";
    var slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "10";
    slider.step = "1";
    var val = document.createElement("div");
    val.className = "rate-val";
    var stored = ratings[name];
    slider.value = typeof stored === "number" ? String(stored) : "5";
    val.textContent = typeof stored === "number" ? String(stored) : "-";
    applyCardState(card, stored);
    slider.addEventListener("input", function () {
      var v = Number(slider.value);
      ratings[name] = v;
      val.textContent = String(v);
      applyCardState(card, v);
      save(ratings);
      updateBar();
    });
    row.appendChild(slider);
    row.appendChild(val);
    card.appendChild(row);
  }

  function exportText() {
    var cards = Array.prototype.slice.call(document.querySelectorAll(".card[data-candidate]"));
    var byName = {};
    cards.forEach(function (card) {
      byName[card.getAttribute("data-candidate")] = groupOf(card);
    });
    var rated = Object.keys(ratings)
      .filter(function (n) {
        return typeof ratings[n] === "number";
      })
      .sort(function (a, b) {
        return ratings[b] - ratings[a] || a.localeCompare(b);
      });
    var unrated = Object.keys(byName).filter(function (n) {
      return typeof ratings[n] !== "number";
    });
    var lines = [];
    lines.push("# Primitive taste ratings (" + rated.length + " rated, " + unrated.length + " unrated)");
    lines.push("");
    lines.push("## Top 20");
    rated.slice(0, 20).forEach(function (n, i) {
      lines.push(i + 1 + ". " + n + " (" + ratings[n] + "/10, " + (byName[n] || "?") + ")");
    });
    lines.push("");
    lines.push("## All ratings");
    rated.forEach(function (n) {
      lines.push(ratings[n] + "/10  " + n + "  [" + (byName[n] || "?") + "]");
    });
    if (unrated.length) {
      lines.push("");
      lines.push("## Unrated");
      unrated.sort().forEach(function (n) {
        lines.push("-  " + n);
      });
    }
    return lines.join("\n");
  }
  window.__hfqaExport = exportText;

  var bar, count, copyBtn;
  function updateBar() {
    var rated = Object.keys(ratings).filter(function (n) {
      return typeof ratings[n] === "number";
    });
    var hi = rated.filter(function (n) {
      return ratings[n] >= 8;
    });
    var total = document.querySelectorAll(".card[data-candidate]").length;
    count.textContent = rated.length + "/" + total + " rated · " + hi.length + " at 8+";
  }

  function buildBar() {
    bar = document.createElement("div");
    bar.id = "rate-bar";
    count = document.createElement("span");
    copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy decisions";
    copyBtn.addEventListener("click", function () {
      var text = exportText();
      var done = function () {
        copyBtn.textContent = "Copied!";
        copyBtn.classList.add("ok");
        setTimeout(function () {
          copyBtn.textContent = "Copy decisions";
          copyBtn.classList.remove("ok");
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {
          window.prompt("Copy manually:", text);
        });
      } else {
        window.prompt("Copy manually:", text);
      }
    });
    var clearBtn = document.createElement("button");
    clearBtn.className = "clear";
    clearBtn.textContent = "Reset";
    clearBtn.addEventListener("click", function () {
      if (!window.confirm("Clear all " + Object.keys(ratings).length + " ratings?")) return;
      ratings = {};
      save(ratings);
      location.reload();
    });
    bar.appendChild(count);
    bar.appendChild(copyBtn);
    bar.appendChild(clearBtn);
    document.body.appendChild(bar);
    updateBar();
  }

  function scan() {
    document.querySelectorAll(".card[data-candidate]").forEach(wire);
  }
  scan();
  buildBar();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
})();
