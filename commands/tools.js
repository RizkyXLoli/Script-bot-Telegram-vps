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
// /ringkas <link artikel> — ambil teks halaman lalu rangkum 5 poin via AI owner.
async function ringkas(ctx, arg) {
  const { reply } = ctx;
  const m = String(arg || "").match(/https?:\/\/\S+/i);
  if (!m) return reply("Contoh: /ringkas https://contoh.com/berita");
  const store = require("../db/store");
  let cred = null;
  try {
    cred = store.getOwnerCreds(process.env.OWNER_IDS ? process.env.OWNER_IDS.split(/[\s,]+/) : (process.env.OWNER_ID ? [process.env.OWNER_ID] : []));
  } catch {}
  if (!cred || !cred.api_key) return reply("AI owner belum disetup. Minta owner ketik /ai setup dulu.");
  await reply("Membaca halaman, tunggu...");
  let html = "";
  try { html = await get(m[0], 20000); }
  catch (e) { return reply("Gagal buka link: " + e.message); }
  let teks = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim().slice(0, 8000);
  if (teks.length < 200) return reply("Halaman terlalu sedikit teks untuk diringkas (mungkin halaman JS/gambar).");
  const { chat } = require("../services/ai");
  try {
    const out = await chat(cred.base_url, cred.api_key, cred.model, [
      { role: "system", content: "Kamu asisten berbahasa Indonesia. ATURAN WAJIB: seluruh jawaban HANYA Bahasa Indonesia. FORMAT: teks chat biasa tanpa markdown — dilarang memakai **tebal**, # judul, ```blok kode```, atau backtick." },
      { role: "user", content: "Ringkas artikel berikut jadi maksimal 5 poin penting, tiap poin 1-2 kalimat:\n\n" + teks },
    ]);
    return reply(out.slice(0, 4000));
  } catch (e) {
    return reply("AI error: " + String(e.message || e).slice(0, 300));
  }
}
async function handle(ctx) {
  const { text, reply, replyFile } = ctx;
  const [raw, ...rest] = text.trim().split(/\s+/);
  const cmd = (raw||"").toLowerCase();
  const arg = rest.join(" ").trim();
  if (cmd === "/ringkas") return ringkas(ctx, arg);
  if (cmd === "/kalk" || cmd === "/calc") {
    if (!arg) return reply("Contoh: /kalk 12*8+5");
    try { return reply("= " + safeCalc(arg)); } catch(e){ return reply("Gagal: "+e.message); }
  }
  if (cmd === "/cuaca") {
    const parts = (arg || "").split(/\s+/).filter(Boolean);
    const dayTok = parts.find((p) => /^\d$/.test(p));
    const kota = parts.filter((p) => !/^\d$/.test(p)).join(" ") || "Jakarta";
    try {
      const c = new AbortController(); const to = setTimeout(()=>c.abort(), 15000);
      try {
        if (dayTok && Number(dayTok) >= 2) {
          const r = await fetch("https://wttr.in/"+encodeURIComponent(kota)+"?format=j1", {signal:c.signal, headers:{"User-Agent":"curl/8.0"}});
          const j = await r.json();
          const days = (j.weather || []).slice(0, Math.min(3, Number(dayTok)));
          if (!days.length) return reply("Prakiraan cuaca tidak tersedia.");
          const nama = (j.nearest_area && j.nearest_area[0] && j.nearest_area[0].areaName[0].value) || kota;
          const lines = days.map((w) => {
            const jam12 = (w.hourly || [])[4] || (w.hourly || [])[0] || {};
            const desc = (jam12.weatherDesc && jam12.weatherDesc[0] && jam12.weatherDesc[0].value) || "-";
            return w.date + ": " + w.mintempC + "-" + w.maxtempC + "C, " + desc + ", hujan " + (jam12.chanceofrain || "?") + "%";
          });
          return reply("PRAKIRAAN " + nama.toUpperCase() + " (" + days.length + " hari)\n" + lines.join("\n"));
        }
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
    try {
      const QR = require("qrcode");
      const buf = await QR.toBuffer(arg.slice(0, 1000), { width: 600, margin: 1 });
      const fs = require("fs"), os = require("os"), path = require("path");
      const fp = path.join(os.tmpdir(), "qr-" + Date.now() + ".png");
      fs.writeFileSync(fp, buf);
      if (typeof replyFile === "function") {
        await replyFile(fp, "QR: " + arg.slice(0, 200));
        setTimeout(() => { try { fs.unlinkSync(fp); } catch {} }, 60000);
        return "sent";
      }
      try { fs.unlinkSync(fp); } catch {}
      return reply("QR untuk: " + arg + "\nBuka: https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=" + encodeURIComponent(arg));
    } catch (e) { return reply("QR gagal: " + e.message); }
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