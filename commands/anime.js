"use strict";

const https = require("https");

const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const HOME = "https://samehadaku.li/";
const ANILIST = "https://graphql.anilist.co";

const OTK = "https://otakudesu.blog/";

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : require("http");
    lib.get(url, { headers: { "User-Agent": UA }, timeout: 25000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchText(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      let d = "";
      res.on("data", (c) => { d += c; if (d.length > 2e6) res.destroy(); });
      res.on("end", () => resolve(d));
    }).on("error", reject).on("timeout", function () { this.destroy(new Error("timeout")); });
  });
}

function fetchHtml(url) { return fetchText(url); }

async function otkWatchLink(title) {
  try {
    const q = encodeURIComponent(title.replace(/[^a-zA-Z0-9 ]/g, " ").trim());
    const html = await fetchText(`${OTK}?s=${q}&post_type=anime`);
    const h2 = html.match(/<h2><a href="(https:\/\/otakudesu\.blog\/anime\/[^"]+)"[^>]*>([^<]+)<\/a><\/h2>/i);
    if (!h2) return null;
    const judul = h2[2].replace(/&#\d+;/g, " ").replace(/&amp;/g, "&").trim();
    return { judul, link: h2[1], src: "Otakudesu" };
  } catch { return null; }
}

async function shWatchLinkSH(title) {
  try {
    const q = encodeURIComponent(title.replace(/[^a-zA-Z0-9 ]/g, " ").trim());
    const html = await fetchHtml(`${HOME}?s=${q}&post_type=anime`);
    const art = (html.match(/<article class="bs"[\s\S]*?<\/article>/g) || [])[0];
    if (!art) return null;
    const lm = art.match(/<a href="([^"]+)"[^>]*title="([^"]+)"/);
    if (!lm) return null;
    return { judul: lm[2].replace(/&amp;/g, "&").trim(), link: lm[1], src: "Samehadaku" };
  } catch { return null; }
}

async function randomWatchLink(title) {
  const order = Math.random() < 0.5 ? [otkWatchLink, shWatchLinkSH] : [shWatchLinkSH, otkWatchLink];
  for (const fn of order) {
    try { const r = await fn(title); if (r) return r; } catch {}
  }
  return null;
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

const SEASONS = { winter: "WINTER", spring: "SPRING", summer: "SUMMER", fall: "FALL", autumn: "FALL", gugur: "FALL", panas: "SUMMER", dingin: "WINTER", semi: "SPRING" };
const SEASON_LABEL = { WINTER: "Winter (Musim Dingin)", SPRING: "Spring (Musim Semi)", SUMMER: "Summer (Musim Panas)", FALL: "Fall (Musim Gugur)" };

function postJson(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(ANILIST, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA, "Content-Length": Buffer.byteLength(body) },
      timeout: 25000,
    }, (res) => {
      let d = "";
      res.on("data", (c) => { d += c; if (d.length > 2e6) res.destroy(); });
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject).on("timeout", function () { this.destroy(new Error("timeout")); });
    req.write(body); req.end();
  });
}

async function seasonList(year, season, limit) {
  const query = `query($y:Int,$s:MediaSeason,$p:Int){ Page(perPage:$p){ media(season:$s,seasonYear:$y,type:ANIME,sort:POPULARITY_DESC){ title{romaji english} episodes averageScore genres siteUrl coverImage{large} } } }`;
  const data = await postJson({ query, variables: { y: year, s: season, p: limit } });
  return ((data.data || {}).Page || {}).media || [];
}

async function shWatchLinkSH(title) {
  try {
    const q = encodeURIComponent(title.replace(/[^a-zA-Z0-9 ]/g, " ").trim());
    const html = await fetchHtml(`${HOME}?s=${q}&post_type=anime`);
    const art = (html.match(/<article class="bs"[\s\S]*?<\/article>/g) || [])[0];
    if (!art) return null;
    const lm = art.match(/<a href="([^"]+)"[^>]*title="([^"]+)"/);
    if (!lm) return null;
    return { judul: lm[2].replace(/&amp;/g, "&").trim(), link: lm[1], src: "Samehadaku" };
  } catch { return null; }
}

async function randomWatchLink(title) {
  const order = Math.random() < 0.5 ? [otkWatchLink, shWatchLinkSH] : [shWatchLinkSH, otkWatchLink];
  for (const fn of order) {
    try { const r = await fn(title); if (r) return r; } catch {}
  }
  return null;
}

async function sendOngoing(ctx, n) {
  const { reply } = ctx;
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
      await ctx.sendAlbum(items.map((it) => ({ img: it.img, caption: it.caption, _local: it.local })));
    }
    else throw new Error("no-album");
  } catch {
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

async function sendSeason(ctx, year, season, n) {
  const { reply } = ctx;
  await reply(`Mencari anime ${SEASON_LABEL[season]} ${year}...`);
  let media;
  try { media = await seasonList(year, season, n); }
  catch (e) { await reply("Gagal ambil data musim: " + e.message); return true; }
  if (!media.length) { await reply(`Tidak ada anime ${SEASON_LABEL[season]} ${year} ditemukan.`); return true; }
  await reply(`Mencari link tonton untuk ${media.length} anime...`);
  const watch = await Promise.all(media.map((m) => randomWatchLink(m.title.romaji || m.title.english || "")));
  const lines = media.map((m, i) => {
    const t = (m.title.english || m.title.romaji || "?").trim();
    const info = [`${m.episodes || "?"} episode`, m.averageScore ? `skor ${m.averageScore}` : null, (m.genres || []).slice(0, 3).join(", ") || null].filter(Boolean).join("\n");
    const w = watch[i] ? `\nTonton (${watch[i].src}): ${watch[i].link}` : "";
    return `${i + 1}. ${t}\n${info}\n${m.siteUrl || ""}${w}`.trim();
  }).join("\n\n").slice(0, 3800);
  const items = media.filter((m) => m.coverImage && m.coverImage.large).slice(0, 10).map((m, i) => ({
    img: m.coverImage.large,
    caption: `${(m.title.english || m.title.romaji || "?").trim()}\n${m.episodes || "?"} episode${m.averageScore ? "\nskor " + m.averageScore : ""}${watch[i] ? "\nTonton (" + watch[i].src + "): " + watch[i].link : ""}`.trim(),
    _local: false,
  }));
  try {
    if (items.length && typeof ctx.sendAlbum === "function") await ctx.sendAlbum(items);
    else throw new Error("no-album");
  } catch {
    for (const it of items.slice(0, 5)) {
      try { await ctx.replyFile(it.img, it.caption); }
      catch { /* lanjut */ }
    }
  }
  await reply(`Anime ${SEASON_LABEL[season]} ${year} (populer):\n\n${lines}`);
  return true;
}

async function handle(ctx) {
  const text = (ctx.text || "").trim();
  if (!/^\/anime(\s|$)/i.test(text)) return null;
  const args = text.split(/\s+/).slice(1);

  let season = null, year = null, n = 8;
  for (const a of args) {
    const low = a.toLowerCase();
    if (SEASONS[low]) season = SEASONS[low];
    else if (/^\d{4}$/.test(a)) year = parseInt(a);
    else if (/^\d{1,2}$/.test(a)) n = Math.min(Math.max(parseInt(a), 1), 15);
  }
  n = Math.min(Math.max(n, 1), 15);

  if (season && year) {
    if (year < 1940 || year > new Date().getFullYear() + 1) {
      await ctx.reply(`Tahun tidak valid. Contoh: /anime summer 2019`);
      return true;
    }
    return sendSeason(ctx, year, season, n);
  }
  if (season || year) {
    await ctx.reply("Format: /anime <musim> <tahun>  contoh: /anime summer 2019\nMusim: winter, spring, summer, fall");
    return true;
  }
  await ctx.reply("Mengambil rilisan ongoing terbaru...");
  return sendOngoing(ctx, Math.min(n, 10));
}

module.exports = { handle };
