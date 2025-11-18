
  {;

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
