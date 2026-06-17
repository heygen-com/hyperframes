// Does a WebGL canvas inside the captured root make drawElementImage drop
// the canvas's EARLIER DOM siblings?
import puppeteer from "puppeteer";
import { writeFileSync } from "node:fs";
const W=400,H=300;
const HTML=`<!doctype html><meta charset=utf-8>
<style>*{margin:0;padding:0}html,body{width:${W}px;height:${H}px;background:#ece8dd}
#root{position:relative;width:${W}px;height:${H}px;background:#ece8dd}
.headline{position:absolute;top:20px;left:0;width:100%;text-align:center;font:700 28px serif;color:#1a2640}
#footer{position:absolute;top:220px;left:0;width:100%;text-align:center;font:700 20px serif;color:#406080}</style>
<div id=root><div class=headline>HEADLINE</div><div id=footer>FOOTER</div></div>
<script>
const root=document.getElementById("root");
window.__addGl=(hidden)=>{
  const c=document.createElement("canvas");
  c.width=200;c.height=100;
  c.style.cssText="position:absolute;left:50px;top:10px;width:200px;height:100px;"+(hidden?"visibility:hidden;":"");
  root.appendChild(c);
  const gl=c.getContext("webgl",{alpha:true,preserveDrawingBuffer:true});
  gl.clearColor(0,0.5,0,0.5);gl.clear(gl.COLOR_BUFFER_BIT);
  return !!gl;
};
const canvas=document.createElement("canvas");
canvas.setAttribute("layoutsubtree","");canvas.width=${W};canvas.height=${H};
canvas.style.cssText="display:block;position:absolute;top:0;left:0";
root.parentNode.insertBefore(canvas,root);canvas.appendChild(root);
window.__cap=()=>{
  const ctx=canvas.getContext("2d");
  return new Promise(r=>requestAnimationFrame(()=>setTimeout(()=>{
    try{ctx.clearRect(0,0,${W},${H});ctx.drawElementImage(root,0,0);}catch(e){return r({err:String(e)});}
    const url=canvas.toDataURL("image/png");ctx.clearRect(0,0,${W},${H});r({url});
  },30)));
};
</script>`;
const b=await puppeteer.launch({headless:true,args:["--no-sandbox","--enable-features=CanvasDrawElement","--use-gl=angle",`--window-size=${W},${H}`]});
const p=await b.newPage();await p.setViewport({width:W,height:H});
await p.setContent(HTML,{waitUntil:"load"});
let r=await p.evaluate(()=>window.__cap());
writeFileSync("/tmp/cs-none.png",Buffer.from(r.url.split(",")[1],"base64"));
await p.evaluate(()=>window.__addGl(false));
r=await p.evaluate(()=>window.__cap());
writeFileSync("/tmp/cs-visible.png",Buffer.from(r.url.split(",")[1],"base64"));
await p.evaluate(()=>{document.querySelectorAll("#root canvas").forEach(c=>c.style.visibility="hidden");});
r=await p.evaluate(()=>window.__cap());
writeFileSync("/tmp/cs-hidden.png",Buffer.from(r.url.split(",")[1],"base64"));
console.log("done");
await b.close();
