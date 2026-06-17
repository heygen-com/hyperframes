// crbug-compact variant: same caption-pattern trigger, but the per-frame
// fade writes go to filter:opacity() instead of opacity. If captures stop
// coming back blank, filter-based fades are a viable mitigation.
import puppeteer from "puppeteer";

const HTML = `<!doctype html><meta charset=utf-8>
<style>*{margin:0;padding:0}html,body{width:270px;height:480px;background:#000}
#frame{position:absolute;top:80px;left:70px;width:400px;height:560px;background:#fdfdfd;transform:rotate(2.5deg)}
#refbox{position:absolute;top:60px;left:60px;width:80px;height:80px;background:#ff8000}
#cap-c{position:absolute;top:440px;left:20px;width:360px;height:90px;font:bold 28px cursive;text-align:center}
.grp{position:absolute;width:100%;opacity:0;top:50%;left:50%;transform:translate(-50%,-50%)}
.wd{display:inline-block;margin:0 4px;opacity:0}</style>
<canvas id=cap width=270 height=480 layoutsubtree style="display:block;position:absolute;top:0;left:0">
<div id=root style="position:relative;width:270px;height:480px;background:#204060">
<div id=frame><div id=refbox></div><div id=cap-c></div></div></div>
<div id=tick style="position:absolute;width:1px;height:1px;background:#000"></div>
</canvas>
<script>
const G=7,DUR=8,S=[];
for(let g=0;g<G;g++){const s=0.1+g*1.05;S.push({s,x:g<G-1?0.1+(g+1)*1.05-0.1:DUR-0.2});}
const c=document.getElementById("cap-c");
for(let g=0;g<G;g++){const d=document.createElement("div");d.className="grp";d.id="g"+g;
for(let w=0;w<5;w++){const sp=document.createElement("span");sp.className="wd";sp.textContent="word"+g+w;d.appendChild(sp);}
c.appendChild(d);}
const cl=x=>Math.max(0,Math.min(1,x));
window.__seek=(t,mode)=>{for(let g=0;g<G;g++){
  const v=Math.min(cl((t-S[g].s)/0.1),1-cl((t-S[g].x)/0.2));
  const el=document.getElementById("g"+g);
  if(mode==="filter"){ el.style.opacity="1"; el.style.filter="opacity("+v+")"; }
  else { el.style.filter=""; el.style.opacity=String(v); }
}};
</script>`;

const CAP = `new Promise(done=>{
  const c=document.getElementById("cap"),r=document.getElementById("root"),x=c.getContext("2d");
  let s=false;
  const draw=()=>{if(s)return;s=true;c.removeEventListener("paint",draw);
    try{x.clearRect(0,0,270,480);x.drawElementImage(r,0,0);}catch(e){return done({err:String(e)});}
    setTimeout(()=>{try{done({url:c.toDataURL("image/png")});}catch(e){done({err:String(e)});}},0);};
  c.addEventListener("paint",draw);
  const t=document.getElementById("tick");
  t.style.backgroundColor=t.style.backgroundColor==="rgb(0, 0, 0)"?"rgb(1, 1, 1)":"rgb(0, 0, 0)";
  setTimeout(draw,250);})`;

const b = await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined,
  args:["--no-sandbox","--enable-features=CanvasDrawElement","--use-gl=angle","--window-size=270,480"]});
const p = await b.newPage();
await p.setViewport({width:270,height:480});
await p.setContent(HTML,{waitUntil:"load"});
for (const mode of ["opacity","filter"]) {
  let blank=0;
  for(let f=0;f<240;f++){
    await p.evaluate(({t,m})=>window.__seek(t,m),{t:f/30,m:mode});
    const r=await p.evaluate(CAP);
    if(r.err){console.log(mode,"f"+f,r.err);break;}
    else if(r.url.length<20000)blank++;
  }
  console.log(`${mode}: ${blank}/240 blank captures`);
}
console.log(await b.version());
await b.close();
