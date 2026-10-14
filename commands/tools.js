"use strict";

async function get(u, timeout=15000) {
  const c = new AbortController(); const t = setTimeout(()=>c.abort(), timeout);
  try { const r = await fetch(u, {signal:c.signal, headers:{"User-Agent":"Mozilla/5.0"}}); return await r.text(); }
  finally { clearTimeout(t); }
}
function safeCalc(expr) {
  if (!/^[0-9+\-*/().%\s^]*$/.test(expr)) throw new Error("ekspresi tidak valid");
  expr = expr.replace(/\^/g, "**");
  const v = Function('"use strict";return (' + expr + ')')();
  if (typeof v !== "number" || !isFinite(v)) throw new Error("hasil tidak valid");
  return Math.round(v*1e8)/1e8;
}
async function handle(ctx) {
  const { text, reply } = ctx;
  const [raw, ...rest] = text.trim().split(/\s+/);
  const cmd = (raw||"").toLowerCase();
  const arg = rest.join(" ").trim();
  if (cmd === "/kalk" || cmd === "/calc") {
    if (!arg) return reply("Contoh: /kalk 12*8+5");
    try { return reply("= " + safeCalc(arg)); } catch(e){ return reply("Gagal: "+e.message); }
  }
  if (cmd === "/cuaca") {
    const kota = arg || "Jakarta";
    try {
      const c = new AbortController(); const to = setTimeout(()=>c.abort(), 15000);
      try {
        const r = await fetch("https://wttr.in/"+encodeURIComponent(kota)+"?format=3", {signal:c.signal, headers:{"User-Agent":"curl/8.0"}});
        const t = (await r.text()).trim();
        if (t.startsWith("<")) return reply("wttr.in lagi ngaco, coba lagi nanti.");
        return reply(t || "Tidak ketemu.");
      } finally { clearTimeout(to); }
    } catch(e){ return reply("Cuaca gagal: "+e.message); }
  }
  if (cmd === "/tr") {
    const m = arg.match(/^(\w{2})\s+([\s\S]+)/);
    if (!m) return reply("Contoh: /tr en halo apa kabar");
    try {
      const j = JSON.parse(await get("https://api.mymemory.translated.net/get?q="+encodeURIComponent(m[2])+"&langpair=id|"+m[1]));
      return reply(j?.responseData?.translatedText || "Gagal translate.");
    } catch(e){ return reply("Translate gagal: "+e.message); }
  }
  if (cmd === "/wiki") {
    if (!arg) return reply("Contoh: /wiki Soekarno");
    try {
      const j = JSON.parse(await get("https://id.wikipedia.org/api/rest_v1/page/summary/"+encodeURIComponent(arg.replace(/\s+/g,"_"))));
      if (j.extract) return reply(j.title+"\n\n"+j.extract.slice(0,1500));
      return reply("Tidak ketemu di Wikipedia.");
    } catch(e){ return reply("Wiki gagal: "+e.message); }
  }
  if (cmd === "/qr") {
    if (!arg) return reply("Contoh: /qr https://tvtest.work.gd");
    return reply("QR untuk: "+arg+"\nBuka: https://api.qrserver.com/v1/create-qr-code/?size=400x400&data="+encodeURIComponent(arg));
  }
  if (cmd === "/short") {
    if (!arg) return reply("Contoh: /short https://youtube.com/...");
    try {
      const t = await get("https://tinyurl.com/api-create.php?url="+encodeURIComponent(arg));
      return reply(t.startsWith("http") ? "Link pendek: "+t : "Gagal: "+t.slice(0,200));
    } catch(e){ return reply("Shortlink gagal: "+e.message); }
  }
  if (cmd === "/jam") {
    const zones = {wib:"Asia/Jakarta", wita:"Asia/Makassar", wit:"Asia/Jayapura", london:"Europe/London", tokyo:"Asia/Tokyo", mekah:"Asia/Riyadh"};
    const z = zones[(arg||"").toLowerCase()] || "Asia/Jakarta";
    const s = new Date().toLocaleString("id-ID",{timeZone:z, weekday:"long", day:"numeric", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit"});
    return reply(s+" ("+z+")");
  }
  if (cmd === "/sholat") {
    const kota = arg || "Jakarta";
    try {
      const j = JSON.parse(await get("https://api.aladhan.com/v1/timingsByCity?city="+encodeURIComponent(kota)+"&country=Indonesia&method=20"));
      const t = j?.data?.timings;
      if (!t) return reply("Kota tidak ketemu.");
      return reply("Jadwal sholat "+kota+" ("+(j?.data?.date?.readable||"")+"):\nSubuh "+t.Fajr+"\nDzuhur "+t.Dhuhr+"\nAshar "+t.Asr+"\nMaghrib "+t.Maghrib+"\nIsya "+t.Isha);
    } catch(e){ return reply("Sholat gagal: "+e.message); }
  }
  return null;
}
module.exports = { handle };