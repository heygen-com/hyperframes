// bake-basemap.mjs — canonical basemap-lane helper for the `maps` skill.
//
// WHAT IT DOES (and why baking at all): drives MapLibre in headless Chrome to record ONLY the
// real-imagery basemap as an MP4 (camera zoom→hold), and projects each requested country's border
// to SCREEN coordinates at the held view. The HF composition then plays the MP4 on track 0 and
// animates a *live* SVG overlay (border draw-on, colour-block / flag fills, labels, pins) from the
// exported `coords.json`. Borders/fills are NOT baked into the video — they stay editable in HF.
//
// Why bake the imagery at all (this is the real reason, not "smoothness"): HF forbids render-time
// network and requires deterministic output. Live raster tiles re-fetch every render and can change
// → non-deterministic. Baking FREEZES the imagery into pixels = deterministic + offline-reproducible.
// (Exposing the engine's per-frame `onBeforeCapture` hook would let MapLibre run live and smooth, but
// it would NOT remove the need to freeze tiles for determinism — so this bake step stays relevant.)
//
// PARAMETRIC — drive everything by env. Example (Brazil + Argentina on satellite):
//   NAME=br-ar STYLE=satellite COUNTRIES="Brazil:#22d3ee,Argentina:#f59e0b" \
//   CENTER="-60,-25" ZSTART=2.4 ZEND=3.4 FPS=30 DUR=5 node bake-basemap.mjs
// Then encode frames-<NAME>/f%04d.png → <NAME>.mp4 (all-intra: -g 1) and feed <NAME>-coords.json
// to the HF composition.
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- resolve Chrome dynamically (no hardcoded machine path) ---
// Never the installed Google Chrome app: on macOS a killed Chrome.app leaves a ~1.4 GB code_sign_clone behind;
// chrome-headless-shell is a plain binary that leaves none.
function resolveChrome() {
  for (const p of [process.env.CHROME, process.env.HYPERFRAMES_BROWSER_PATH])
    if (p && existsSync(p)) return p;
  const exe = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  const ver = (dir) => (dir.split("-").pop() || "").split(".").map((n) => parseInt(n, 10) || 0);
  const byNewest = (a, b) => {
    const x = ver(a),
      y = ver(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++)
      if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0);
    return 0;
  };
  for (const base of [
    join(homedir(), ".cache", "hyperframes", "chrome", "chrome-headless-shell"),
    join(homedir(), ".cache", "puppeteer", "chrome-headless-shell"),
  ]) {
    if (!existsSync(base)) continue;
    for (const v of readdirSync(base).sort(byNewest)) {
      try {
        for (const inner of readdirSync(join(base, v))) {
          const bin = join(base, v, inner, exe);
          if (existsSync(bin)) return bin;
        }
      } catch {
        /* skip */
      }
    }
  }
  for (const c of ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"])
    if (existsSync(c)) return c;
  throw new Error(
    "Chrome not found. Set CHROME=/path/to/chrome-headless-shell, or install one:\n" +
      "  npx puppeteer browsers install chrome-headless-shell",
  );
}

// --- params (all overridable by env) ---
const NAME = process.env.NAME || "basemap";
const STYLE = process.env.STYLE || "satellite"; // satellite | dark | light | raw {z}/{x}/{y} template
const CENTER = (process.env.CENTER || "2.6,46.6").split(",").map(Number);
const ZSTART = +(process.env.ZSTART || 4.2);
const ZEND = +(process.env.ZEND || 5.4);
const PITCH = +(process.env.PITCH || 0);
const BEARING = +(process.env.BEARING || 0);
const FPS = +(process.env.FPS || 30),
  DUR = +(process.env.DUR || 5),
  N = Math.max(1, Math.round(FPS * DUR));
const HOLD = +(process.env.HOLD || 0.5); // p∈[0,1] at which the zoom finishes; camera holds after
const MARGIN = (process.env.KEEPMARGIN || "16,13").split(",").map(Number); // [lon°,lat°] keep-box around each country's mainland
// COUNTRIES="Name:#hex,Name:#hex" — borders to project (optional; omit for a pure zoom-to / pin shot)
const COUNTRIES = (process.env.COUNTRIES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [name, color] = s.split(":");
    return { name, color: color || "#38bdf8" };
  });

// fail fast on bad numeric env — otherwise NaN silently bakes zero/garbage frames and still prints "done"
for (const [k, v] of Object.entries({
  "CENTER.lng": CENTER[0],
  "CENTER.lat": CENTER[1],
  ZSTART,
  ZEND,
  PITCH,
  BEARING,
  FPS,
  DUR,
  HOLD,
}))
  if (!Number.isFinite(v))
    throw new Error(
      `bad numeric env: ${k}=${v} — check CENTER="lng,lat" / ZSTART / ZEND / FPS / DUR`,
    );

// IMPORTANT: tileSize:256 matches Esri/CARTO raster endpoints. MapLibre's INTERNAL world width is
// 512·2^zoom regardless — a 512px (@2x/retina/vector) tile source needs tileSize:512 or every zoom
// level is off by one. Keep 256 for these raster sources.
const TILES =
  {
    satellite:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    dark: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    light: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  }[STYLE] || STYLE; // STYLE may also be a raw {z}/{x}/{y} template

const OUT = process.env.OUT || process.cwd(); // artifacts → workspace (cwd), NOT the installed skill dir
const framesDir = join(OUT, "frames-" + NAME);
mkdirSync(framesDir, { recursive: true });

// Deps PINNED exact (mutable @5/@2 majors would drift the bake over time).
const PAGE = `<!doctype html><html><head>
<link href="https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>
<script src="https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js"></script>
<style>*{margin:0}html,body{width:1920px;height:1080px;overflow:hidden;background:#05070d}#map{width:1920px;height:1080px}.maplibregl-control-container{display:none!important}</style>
</head><body><div id="map"></div><script>
var CENTER=${JSON.stringify(CENTER)}, ZSTART=${ZSTART}, ZEND=${ZEND}, PITCH=${PITCH}, BEARING=${BEARING}, HOLD=${HOLD};
var MARGIN=${JSON.stringify(MARGIN)}, WANT=${JSON.stringify(COUNTRIES)};
var map=new maplibregl.Map({container:"map",style:{version:8,projection:{type:"mercator"},
  sources:{s:{type:"raster",tiles:[${JSON.stringify(TILES)}],tileSize:256,maxzoom:19}},
  layers:[{id:"bg",type:"background",paint:{"background-color":"#05070d"}},{id:"s",type:"raster",source:"s"}]},
  center:CENTER,zoom:ZSTART,pitch:0,bearing:0,interactive:false,attributionControl:false,fadeDuration:0,preserveDrawingBuffer:true,maxTileCacheSize:6000});
function ease(x){return x<0.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;} // easeInOutCubic (= Remotion interpolate+Easing)
function camAt(p){ var t=ease(Math.min(1,p/HOLD)); return {center:CENTER, zoom:ZSTART+(ZEND-ZSTART)*t, pitch:PITCH*t, bearing:BEARING*t}; }
function ringCentroid(r){ var sx=0,sy=0; for(var k=0;k<r.length;k++){sx+=r[k][0];sy+=r[k][1];} return [sx/r.length, sy/r.length]; }
// Keep the polygons in a lon/lat box around the country's MAINLAND (the vertex-richest polygon),
// dropping far-flung overseas territories that would blow up the bbox. Generalizes per subject —
// no continent-specific constant. Keeps near islands (Corsica, Sicily); drops Guiana, Alaska, Hawaii.
function mainland(f){
  if(!f) return f;
  if(f.geometry.type!=="MultiPolygon"){ f.__anchorRing=f.geometry.coordinates[0]; return f; } // Polygon: outer ring
  var polys=f.geometry.coordinates, anchor=polys[0], amax=-1;
  polys.forEach(function(poly){ if(poly[0].length>amax){amax=poly[0].length;anchor=poly;} });
  var ac=ringCentroid(anchor[0]);
  var kept=polys.filter(function(poly){ var c=ringCentroid(poly[0]); return Math.abs(c[0]-ac[0])<=MARGIN[0] && Math.abs(c[1]-ac[1])<=MARGIN[1]; });
  var nf={type:"Feature",properties:f.properties,geometry:{type:"MultiPolygon",coordinates:kept}}; nf.__anchorRing=anchor[0]; return nf;
}
function lonSpan(f){ var mn=1e9,mx=-1e9; (f.geometry.type==="Polygon"?[f.geometry.coordinates]:f.geometry.coordinates).forEach(function(poly){poly[0].forEach(function(c){if(c[0]<mn)mn=c[0];if(c[0]>mx)mx=c[0];});}); return mx-mn; }
// ANTIMERIDIAN unwrap (Russia/Fiji/NZ): make all lon contiguous around the camera-center ref so a
// feature touching ±180° doesn't smear when map.project() runs per-vertex (mercatorX is linear and
// accepts out-of-range lon, so 181 sits just east of center, not far-west at -179). Mutates in place;
// __anchorRing shares the same arrays so it's covered.
function unwrapLon(f, ref){ if(!f) return; function fix(r){ for(var i=0;i<r.length;i++){ var lon=r[i][0]; while(lon-ref>180)lon-=360; while(lon-ref<-180)lon+=360; r[i][0]=lon; } }
  var g=f.geometry; if(g.type==="Polygon") g.coordinates.forEach(fix); else g.coordinates.forEach(function(poly){ poly.forEach(fix); }); }
var FEATS=[]; window.__warn=[];
window.__ready=new Promise(function(res){ map.on("load", function(){
  if(!WANT.length){ res(); return; }
  fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json").then(function(r){return r.json();}).then(function(w){
    var fc=topojson.feature(w,w.objects.countries);
    WANT.forEach(function(want){
      var f=fc.features.filter(function(x){return x.properties.name===want.name;})[0];
      if(!f){ window.__warn.push("country not found in world-atlas: "+want.name); return; }
      f=mainland(f);
      unwrapLon(f, CENTER[0]); // antimeridian: unwrap lons around the camera ref (CENTER must be near the subject) before projecting
      if(lonSpan(f)>180) window.__warn.push(want.name+" spans >180° lon even after unwrap — projection may still smear.");
      FEATS.push({name:want.name, color:want.color, f:f});
    });
    res();
  });
});});
window.__setCam=function(p){ map.jumpTo(camAt(p)); };
// returns true if the idle event did NOT fire within ms (i.e. tiles may be incomplete)
// returns true only if tiles are GENUINELY not loaded at timeout — CARTO/Esri idle is flaky and
// often never fires even when every tile is painted, so check areTilesLoaded() before crying timeout.
window.__waitIdle=function(ms){ return new Promise(function(res){ var done=false; function fin(t){if(done)return;done=true;res(t);} map.once("idle",function(){fin(false);}); setTimeout(function(){ fin(!map.areTilesLoaded()); }, ms||9000); }); };
function featurePath(f){ function ring(r){ return r.map(function(c,i){ var p=map.project(c); return (i?"L":"M")+p.x.toFixed(1)+" "+p.y.toFixed(1); }).join(" ")+"Z"; }
  var g=f.geometry,d=""; if(g.type==="Polygon") g.coordinates.forEach(function(r){d+=ring(r);}); else g.coordinates.forEach(function(poly){poly.forEach(function(r){d+=ring(r);});}); return d; }
function bboxOf(f){ var mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
  function eat(r){ r.forEach(function(c){ var p=map.project(c); if(p.x<mnx)mnx=p.x; if(p.y<mny)mny=p.y; if(p.x>mxx)mxx=p.x; if(p.y>mxy)mxy=p.y; }); }
  var g=f.geometry; if(g.type==="Polygon")g.coordinates.forEach(eat); else g.coordinates.forEach(function(poly){poly.forEach(eat);});
  return {x:+mnx.toFixed(1),y:+mny.toFixed(1),w:+(mxx-mnx).toFixed(1),h:+(mxy-mny).toFixed(1)}; }
window.__project=function(){ return {
  view:{center:CENTER, zoom:ZEND, pitch:PITCH, bearing:BEARING},
  countries: FEATS.map(function(e){ var lc=ringCentroid(e.f.__anchorRing); var lp=map.project(lc);
    return { name:e.name, color:e.color, d:featurePath(e.f), bbox:bboxOf(e.f), label:{x:+lp.x.toFixed(1),y:+lp.y.toFixed(1)} }; }),
}; };
</script></body></html>`;

// --no-sandbox is intentional: trusted Source-time bake, headless, often root/CI; deps are version-pinned above.
const browser = await puppeteer.launch({
  executablePath: resolveChrome(),
  headless: true,
  args: [
    "--no-sandbox",
    "--hide-scrollbars",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--enable-webgl",
    "--window-size=1920,1080",
  ],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.setContent(PAGE, { waitUntil: "load" });
  await page.evaluate(() => window.__ready);
  for (const w of await page.evaluate(() => window.__warn)) console.warn(`[${NAME}] WARN: ${w}`);
  console.log(
    `[${NAME}] ready (${STYLE}); baking ${N} frames, zoom ${ZSTART}→${ZEND} hold@p=${HOLD}, ${COUNTRIES.length} border(s)`,
  );
  let coords = null;
  const timeouts = [];
  for (let i = 0; i < N; i++) {
    const p = N === 1 ? 1 : i / (N - 1);
    await page.evaluate((pp) => window.__setCam(pp), p);
    const timedOut = await page.evaluate((ms) => window.__waitIdle(ms), 9000);
    if (timedOut) {
      timeouts.push(i);
      console.warn(`[${NAME}] idle TIMEOUT at frame ${i} — tiles may be incomplete`);
    }
    await page.screenshot({
      path: join(framesDir, `f${String(i).padStart(4, "0")}.png`),
      clip: { x: 0, y: 0, width: 1920, height: 1080 },
      optimizeForSpeed: true,
    });
    if (p >= HOLD && !coords && COUNTRIES.length)
      coords = await page.evaluate(() => window.__project()); // capture at first hold frame
    if (i % 20 === 0 || i === N - 1) console.log(`  [${NAME}] ${i + 1}/${N}`);
  }
  // encode frames → all-intra MP4 (every frame seekable for HF); fall back to printing the command if ffmpeg is absent
  const mp4 = join(OUT, NAME + ".mp4"),
    pat = join(framesDir, "f%04d.png");
  const ff = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      String(FPS),
      "-i",
      pat,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "1",
      "-crf",
      "16",
      "-movflags",
      "+faststart",
      mp4,
    ],
    { stdio: "ignore" },
  );
  if (ff.status === 0) console.log(`[${NAME}] encoded → ${mp4}`);
  else
    console.warn(
      `[${NAME}] ffmpeg unavailable (status ${ff.status}) — encode manually:\n  ffmpeg -y -framerate ${FPS} -i ${pat} -c:v libx264 -pix_fmt yuv420p -g 1 -crf 16 -movflags +faststart ${mp4}`,
    );
  if (coords) {
    writeFileSync(join(OUT, NAME + "-coords.json"), JSON.stringify(coords));
    console.log(
      `[${NAME}] coords written: ${coords.countries.map((c) => c.name + "(" + c.d.length + "ch)").join(", ")}`,
    );
  }
  if (timeouts.length) {
    // FAIL LOUD: the asset exists but is suspect — don't let a half-loaded bake pass silently
    console.error(
      `[${NAME}] ${timeouts.length}/${N} frame(s) hit the idle timeout (frames ${timeouts.slice(0, 8).join(",")}${timeouts.length > 8 ? "…" : ""}). The basemap MP4 may have INCOMPLETE tiles. Re-run with a slower zoom / larger timeout / check the tile server.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`[${NAME}] done — all ${N} frames reached map idle (complete tiles).`);
  }
} finally {
  // close politely for 5 s, then SIGKILL, so a hung close can neither wedge the bake nor leave Chrome running
  const proc = browser.process();
  let timer;
  const closed = await Promise.race([
    browser.close().then(
      () => true,
      () => false,
    ),
    new Promise((r) => (timer = setTimeout(() => r(false), 5000))),
  ]);
  clearTimeout(timer);
  if (!closed && proc && proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
}
