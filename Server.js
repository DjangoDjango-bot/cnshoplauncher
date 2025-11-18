// File: server.js
import express from "express";
import cheerio from "cheerio";
import got from "got";

/**
 * Minimal server to proxy CN shopping sites and translate HTML text nodes.
 * No keys needed (uses public LibreTranslate; falls back to original on errors).
 */

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const LT_URL = process.env.LIBRETRANSLATE_URL || "https://libretranslate.com/translate"; // why: deploy without keys

app.get("/health", (_req, res) => res.json({ ok: true }));

// Simple mobile-friendly homepage
const HOME_HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>CN Shop Launcher (Minimal)</title>
<style>
:root{--bg:#0f1115;--panel:#151924;--muted:#aab2c0;--text:#e9eef8;--accent:#5b9cff;--border:#232836}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.4 -apple-system,system-ui,Segoe UI,Roboto,Inter}
.wrap{max-width:820px;margin:0 auto;padding:clamp(16px,4vw,28px)}
h1{margin:0 0 10px;font-size:22px}
.row{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}
.card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px}
.btn{appearance:none;border:1px solid var(--border);background:#0c0f16;color:var(--text);border-radius:10px;padding:10px 12px;cursor:pointer}
.btn:active{transform:translateY(1px)}
.site{display:flex;align-items:center;gap:10px;min-width:45%;justify-content:space-between}
.muted{color:var(--muted);font-size:13px}
.toggle{display:inline-block;border-radius:999px;padding:4px;background:#0c0f16;border:1px solid var(--border)}
.toggle button{border:0;background:transparent;color:var(--text);padding:6px 10px;border-radius:999px}
.toggle button.active{background:#10182a}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media(max-width:560px){ .grid{grid-template-columns:1fr} .site{min-width:100%} }
</style>
</head><body>
<div class="wrap">
  <h1>CN Shop Launcher (Minimal)</h1>
  <div class="muted">Translate toggle affects the links below. If a site blocks it, open Original.</div>
  <div class="row">
    <div class="toggle" role="tablist" aria-label="Translate">
      <button id="orig" class="active" aria-selected="true">Original</button>
      <button id="tran">English</button>
    </div>
    <button id="reload" class="btn">Reload</button>
  </div>

  <div class="card"><div class="grid" id="sites"></div></div>
  <p class="muted" style="margin-top:12px">On iPhone: Share → <b>Add to Home Screen</b> for full-screen.</p>
</div>
<script>
const sites = [
  { id:'taobao', name:'Taobao', url:'https://www.taobao.com' },
  { id:'tmall',  name:'Tmall',  url:'https://www.tmall.com' },
  { id:'jd',     name:'JD.com', url:'https://www.jd.com' },
  { id:'pdd',    name:'Pinduoduo', url:'https://www.pinduoduo.com' },
  { id:'xhs',    name:'Xiaohongshu (RED)', url:'https://www.xiaohongshu.com' },
  { id:'dewu',   name:'Dewu (Poizon)', url:'https://www.poizon.com' },
  { id:'1688',   name:'1688', url:'https://www.1688.com' }
];
const grid = document.getElementById('sites');
let translated = false;
const prox = (u)=> '/proxy?u='+encodeURIComponent(u)+'&tl=en';
function row(s){
  const a = document.createElement('div'); a.className='site';
  const left = document.createElement('div'); left.innerHTML = '<b>'+s.name+'</b><div class="muted">'+(new URL(s.url)).hostname+'</div>';
  const right = document.createElement('div');
  const open = document.createElement('button'); open.className='btn'; open.textContent='Open';
  const openOrig = document.createElement('button'); openOrig.className='btn'; openOrig.textContent='Original';
  open.onclick = ()=> window.open(translated?prox(s.url):s.url, '_blank');
  openOrig.onclick = ()=> window.open(s.url, '_blank');
  right.appendChild(open); right.appendChild(openOrig);
  a.appendChild(left); a.appendChild(right); return a;
}
function render(){ grid.innerHTML=''; sites.forEach(s=> grid.appendChild(row(s))); }
render();
document.getElementById('orig').onclick = (e)=>{ translated=false; e.target.classList.add('active'); document.getElementById('tran').classList.remove('active'); };
document.getElementById('tran').onclick  = (e)=>{ translated=true;  e.target.classList.add('active'); document.getElementById('orig').classList.remove('active'); };
document.getElementById('reload').onclick = ()=> location.reload();
</script>
</body></html>`;

// Translate an array of texts with LibreTranslate; fallback to original on error
async function translateTexts(texts, target="en"){
  if (!texts.length) return [];
  try{
    const r = await fetch(LT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: texts, source: "auto", target, format: "text" })
    });
    if (!r.ok) throw new Error("tl http "+r.status);
    const data = await r.json();
    const arr = Array.isArray(data) ? data.map(d => d.translatedText) : [data.translatedText];
    return texts.map((t,i)=> arr[i] ?? t);
  }catch{ return texts; } // why: never crash; show Chinese if rate-limited
}

app.get("/", (_req, res) => res.type("text/html; charset=utf-8").send(HOME_HTML));

app.get("/proxy", async (req, res) => {
  try{
    const raw = String(req.query.u || "");
    const tl  = String(req.query.tl || "en");
    if (!raw) return res.status(400).send("Missing u");
    const targetUrl = new URL(raw).toString();

    const r = await got(targetUrl, {
      timeout: { request: 15000 },
      followRedirect: true,
      headers: {
        "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
      },
      retry: { limit: 1 }
    });

    const ct = (r.headers["content-type"] || "").toLowerCase();
    if (!ct.includes("text/html")) return res.redirect(targetUrl);

    const $ = cheerio.load(r.body, { decodeEntities:false });
    $('meta[http-equiv="Content-Security-Policy"]').remove(); // why: allow base/links we inject

    const blocked = new Set(["script","style","pre","code","textarea","noscript"]);
    const nodes = [];
    $("*").each((_, el) => {
      const tag = el.tagName?.toLowerCase(); if (blocked.has(tag)) return;
      for (const c of el.childNodes || []){
        if (c.type === "text" && /\S/.test(c.data || "")) {
          const trimmed = c.data.trim(); if (trimmed.length < 2) continue;
          nodes.push({ node:c, original:c.data, trimmed });
        }
      }
    });

    const out = await translateTexts(nodes.map(n => n.trimmed), tl);
    nodes.forEach((n,i)=>{
      const m=(n.original||"").match(/^(\s*)(.*?)(\s*)$/s);
      n.node.data = (m?.[1]||"") + (out[i] ?? n.trimmed) + (m?.[3]||"");
    });

    const baseTag = `<base href="${targetUrl}">`;
    if ($("head").length) $("head").prepend(baseTag); else $.root().prepend(`<head>${baseTag}</head>`);
    $("a[href]").each((_, a)=>{
      const href = String($(a).attr("href")||"").trim(); if (!href) return;
      try{
        const abs = new URL(href, targetUrl).toString();
        const prox = `/proxy?u=${encodeURIComponent(abs)}&tl=${encodeURIComponent(tl)}`;
        $(a).attr("href", prox).attr("rel","noopener noreferrer");
      }catch{}
    });

    res.type("text/html; charset=utf-8").send($.html());
  }catch{
    res.status(500).send("Proxy/translate failed.");
  }
});

app.listen(PORT, () => console.log(`CN Shop (minimal) running on :${PORT}`));
