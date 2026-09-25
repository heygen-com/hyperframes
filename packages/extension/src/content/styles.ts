export const PICKER_STYLES = `
:host{all:initial;color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}
.layer{position:fixed;inset:0;z-index:2147483647;pointer-events:none;color:#f8fafc}
.frame{position:fixed;transition:left 80ms cubic-bezier(.2,0,0,1),top 80ms cubic-bezier(.2,0,0,1),width 80ms cubic-bezier(.2,0,0,1),height 80ms cubic-bezier(.2,0,0,1);filter:drop-shadow(0 0 8px rgba(59,230,171,.35))}
.frame::before{content:"";position:absolute;inset:0;background:rgba(59,230,171,.06);box-shadow:inset 0 0 0 1px rgba(59,230,171,.22)}
.corner{position:absolute;width:18px;height:18px;border:2px solid #3be6ab}
.tl{left:-2px;top:-2px;border-right:0;border-bottom:0;border-radius:5px 0 0}.tr{right:-2px;top:-2px;border-left:0;border-bottom:0;border-radius:0 5px 0 0}.bl{left:-2px;bottom:-2px;border-right:0;border-top:0;border-radius:0 0 0 5px}.br{right:-2px;bottom:-2px;border-left:0;border-top:0;border-radius:0 0 5px}
.tag{position:fixed;display:flex;align-items:center;gap:8px;max-width:min(420px,calc(100vw - 24px));padding:6px 9px;border:1px solid #272a31;border-radius:8px;background:rgba(10,11,14,.94);box-shadow:0 12px 34px rgba(0,0,0,.38);backdrop-filter:blur(16px);font-size:11px;line-height:1;white-space:nowrap}
.tag strong{overflow:hidden;color:#3be6ab;text-overflow:ellipsis}.tag span{color:#8f95a3;font-variant-numeric:tabular-nums}
.bar{position:fixed;left:50%;bottom:22px;display:flex;align-items:center;gap:12px;transform:translateX(-50%);padding:10px 13px;border:1px solid #252830;border-radius:12px;background:rgba(9,10,13,.94);box-shadow:0 16px 50px rgba(0,0,0,.42);backdrop-filter:blur(18px);font-size:12px;white-space:nowrap}
.mark{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;background:linear-gradient(135deg,#0de4f5,#4ddb60);color:#031b17;font-size:11px;font-weight:900}
.bar b{font-weight:650}.hints{display:flex;gap:9px;color:#9297a3}.hints i{font-style:normal}.hints kbd{padding:2px 5px;border:1px solid #30333b;border-radius:5px;background:#17191e;color:#d2d5dc;font:10px ui-monospace,SFMono-Regular,Menlo,monospace}
.capsule{position:fixed;right:18px;bottom:18px;width:min(360px,calc(100vw - 36px));overflow:hidden;border:1px solid #282b33;border-radius:18px;background:#0b0c0f;box-shadow:0 24px 80px rgba(0,0,0,.56);pointer-events:auto}
.preview{position:relative;height:174px;background:repeating-conic-gradient(#17191e 0 25%,#111216 0 50%) 50%/18px 18px;overflow:hidden}
.preview img{width:100%;height:100%;object-fit:contain;display:block}.preview::after{content:"LOCKED FRAME";position:absolute;left:10px;top:10px;padding:4px 7px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(7,8,10,.74);color:#d6dae2;font-size:9px;font-weight:800;letter-spacing:.11em}
.body{padding:15px}.eyebrow{margin:0 0 5px;color:#3be6ab;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.body h2{margin:0;color:#f8fafc;font-size:16px;letter-spacing:-.02em}.meta{display:flex;gap:8px;margin:9px 0 12px;color:#989eaa;font-size:11px}.meta span{padding:4px 7px;border:1px solid #252830;border-radius:7px;background:#14161a}.note{margin:0 0 13px;color:#b4bac5;font-size:12px;line-height:1.45}.actions{display:flex;gap:8px}.actions button{min-height:44px;padding:0 14px;border-radius:10px;font:inherit;font-size:12px;font-weight:750;cursor:pointer}.primary{flex:1;border:0;background:#3be6ab;color:#042019}.secondary{border:1px solid #30333b;background:#17191e;color:#eff1f5}.actions button:focus-visible{outline:3px solid rgba(59,230,171,.35);outline-offset:2px}.actions button:disabled{cursor:wait;opacity:.65}
.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:620px){.hints i:nth-child(-n+2){display:none}.capsule{right:10px;bottom:10px;width:calc(100vw - 20px)}}
@media(prefers-reduced-motion:reduce){.frame{transition:none}}
`;
