"use strict";

// /wallpaper [jumlah 1-5] — kirim wallpaper anime random (tiap request gambar beda).
// Sumber: nekos.best (gambar dari Pixiv, tanpa key) + pic.re (wallpaper anime langsung).

const https = require("https");
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": UA }, timeout: 25000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(getJson(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      let d = "";
      res.on("data", (c) => { d += c; if (d.length > 2e6) res.destroy(); });
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on("error", reject).on("timeout", function () { this.destroy(new Error("timeout")); });
  });
}

function dlBuf(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": UA }, timeout: 25000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(dlBuf(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      const ch = [];
      res.on("data", (c) => ch.push(c));
      res.on("end", () => resolve(Buffer.concat(ch)));
    }).on("error", reject).on("timeout", function () { this.destroy(new Error("timeout")); });
  });
}

async function handle(ctx) {
  const text = (ctx.text || "").trim();
  if (!/^\/(wallpaper|wp|wpaper)(\s|$)/i.test(text)) return null;
  const { reply } = ctx;
  const n = Math.min(Math.max(parseInt(text.split(/\s+/)[1]) || 3, 1), 5);
  await reply("Mencari " + n + " wallpaper anime random...");

  // Ambil n gambar dari nekos.best (tiap request = hasil random baru)
  const urls = [];
  for (let i = 0; i < n; i++) {
    try {
      const j = await getJson("https://nekos.best/api/v2/neko?amount=1");
      const r = (j.results || [])[0];
      if (r && r.url) urls.push({ img: r.url, caption: "Wallpaper anime random" + (r.artist_name ? "\nArtist: " + r.artist_name : "") + (r.source_url ? "\n" + r.source_url : "") });
    } catch {}
  }
  // Fallback kalau API mati: pic.re kasih gambar anime langsung
  while (urls.length < n) {
    urls.push({ img: "https://pic.re/image?t=" + Date.now() + "-" + Math.random().toString(36).slice(2), caption: "Wallpaper anime random" });
  }

  const fs = require("fs"), os = require("os"), path = require("path");
  const items = [];
  for (const u of urls) {
    try {
      const buf = await dlBuf(u.img);
      if (buf.length < 2000) throw new Error("gambar kosong");
      const ext = u.img.includes(".png") ? ".png" : ".jpg";
      const fp = path.join(os.tmpdir(), "wp-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ext);
      fs.writeFileSync(fp, buf);
      items.push({ img: fp, caption: u.caption, local: true });
    } catch { items.push({ img: u.img, caption: u.caption, local: false }); }
  }

  try {
    if (typeof ctx.sendAlbum === "function") {
      await ctx.sendAlbum(items.map((it) => ({ img: it.img, caption: it.caption, _local: it.local })));
    } else throw new Error("no-album");
  } catch {
    for (const it of items) {
      try { await ctx.replyFile(it.img, it.caption); }
      catch { await reply(it.caption + "\n" + it.img); }
    }
  }
  for (const it of items) { if (it.local) { try { fs.unlinkSync(it.img); } catch {} } }
  return true;
}

module.exports = { handle };
