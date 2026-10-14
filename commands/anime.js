"use strict";

const https = require("https");

const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const HOME = "https://samehadaku.li/";

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": UA }, timeout: 25000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchHtml(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      let d = "";
      res.on("data", (c) => { d += c; if (d.length > 2e6) res.destroy(); });
      res.on("end", () => resolve(d));
    }).on("error", reject).on("timeout", function () { this.destroy(new Error("timeout")); });
  });
}

function parseList(html, limit) {
  const main = html.split("Recommendation")[0];
  const out = [];
  const arts = main.match(/<article class="bs"[\s\S]*?<\/article>/g) || [];
  for (const a of arts) {
    if (out.length >= limit) break;
    if (/<span class="epx">Completed<\/span>/i.test(a)) continue;
    const lm = a.match(/<a href="([^"]+)"[^>]*title="([^"]+)"/);
    const im = a.match(/data-src="(https?:[^"]+)"/) || a.match(/src="(https?:[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
    if (!lm || !im) continue;
    const judul = lm[2].replace(/&amp;/g, "&").replace(/ Subtitle Indonesia/i, "").trim();
    out.push({ judul, link: lm[1], img: im[1].replace(/&amp;/g, "&") });
  }
  return out;
}

async function handle(ctx) {
  const text = (ctx.text || "").trim();
  if (!/^\/anime(\s|$)/i.test(text)) return null;
  const { reply } = ctx;
  const n = Math.min(Math.max(parseInt(text.split(/\s+/)[1]) || 8, 1), 10);
  await reply("Mengambil rilisan ongoing terbaru...");
  let html;
  try { html = await fetchHtml(HOME); }
  catch (e) { await reply("Gagal buka Samehadaku: " + e.message); return true; }
  const list = parseList(html, n);
  if (!list.length) { await reply("Tidak ada rilisan ongoing ditemukan."); return true; }

  
  const fs = require("fs"), os = require("os"), path = require("path");
  const items = [];
  for (const a of list) {
    const cap = `${a.judul}\n${a.link}`;
    try {
      const buf = await new Promise((res, rej) => {
        https.get(a.img, { headers: { "User-Agent": UA }, timeout: 20000 }, (r) => {
          if (r.statusCode !== 200) return rej(new Error("HTTP " + r.statusCode));
          const ch = []; r.on("data", (c) => ch.push(c)); r.on("end", () => res(Buffer.concat(ch)));
        }).on("error", rej).on("timeout", function () { this.destroy(new Error("timeout")); });
      });
      if (buf.length < 2000) throw new Error("gambar kosong");
      const fp = path.join(os.tmpdir(), "anime-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".jpg");
      fs.writeFileSync(fp, buf);
      items.push({ img: fp, caption: cap, local: true });
    } catch { items.push({ img: a.img, caption: cap, local: false }); }
  }

  try {
    if (typeof ctx.sendAlbum === "function") {
      
      await ctx.sendAlbum(items.map((it) => ({ img: it.local ? it.img : it.img, caption: it.caption, _local: it.local })));
    }
    else throw new Error("no-album");
  } catch (e) {
    for (const it of items) {
      try { await ctx.replyFile(it.img, it.caption); }
      catch { await reply(it.caption); }
    }
  }
  for (const it of items) { if (it.local) { try { fs.unlinkSync(it.img); } catch {} } }
  
  const daftar = list.map((a, i) => `${i + 1}. ${a.judul}\n${a.link}`).join("\n\n").slice(0, 3800);
  await reply(daftar);
  return true;
}

module.exports = { handle };