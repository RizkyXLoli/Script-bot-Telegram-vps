"use strict";

// /anime — murni dari situs sumber (Samehadaku, Oploverz, Anoboy).
// Tanpa AniList/API metadata apa pun:
//   - tanggal rilis  -> arsip tanggal WordPress situs sumber (/YYYY/MM/DD/)
//   - sebulan        -> arsip bulanan (/YYYY/MM/)
//   - musim          -> 3 bulan musim itu, diverifikasi lewat "Season:" halaman seri
//   - cover          -> og:image halaman episode/seri
//
//   /anime [n]                    rilisan ongoing terbaru (homepage Samehadaku)
//   /anime <tgl> <bln> <tahun>    arsip tanggal
//   /anime <bln> <tahun>          arsip sebulan
//   /anime <musim> <tahun>        3 bulan musim itu

const https = require("https");

const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const HOME = "https://samehadaku.li/";

// Situs sumber ber-arsip tanggal (semua WordPress).
const ARCHIVE_SITES = [
  { name: "Samehadaku", base: "https://samehadaku.li/" },
  { name: "Oploverz", base: "https://oploverz.ch/" },
  { name: "Anoboy", base: "https://anoboy.be/" },
];

// ---------- cache ----------
const TTL = 15 * 60 * 1000;
const cache = new Map();
function cacheGet(k) {
  const v = cache.get(k);
  if (!v) return null;
  if (Date.now() - v.t > TTL) { cache.delete(k); return null; }
  return v.v;
}
function cacheSet(k, v) {
  if (cache.size > 400) cache.clear();
  cache.set(k, { t: Date.now(), v });
}

// ---------- HTTP ----------
function fetchText(url) {
  const hit = cacheGet(url);
  if (hit !== null) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : require("http");
    lib.get(url, { headers: { "User-Agent": UA }, timeout: 25000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchText(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      let d = "";
      res.on("data", (c) => { d += c; if (d.length > 3e6) res.destroy(); });
      res.on("end", () => { cacheSet(url, d); resolve(d); });
    }).on("error", reject).on("timeout", function () { this.destroy(new Error("timeout")); });
  });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; }
    }
  }));
  return out;
}

// ---------- util teks ----------
function toks(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/subtitle indonesia/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim().split(/\s+/).filter(Boolean);
}
function dice(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let ov = 0;
  for (const t of A) if (B.has(t)) ov++;
  return (2 * ov) / (A.size + B.size);
}
function unesc(s) {
  return String(s || "").replace(/&#8211;/g, "-").replace(/&#8217;/g, "'").replace(/&#8216;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

// "Anne Shirley Episode 12 Subtitle Indonesia" -> "Anne Shirley"
function stripEpisode(t) {
  return unesc(t)
    .replace(/\s*[-–:]?\s*Episode\s+\d+(?:\.\d+)?\s*/i, " ")
    .replace(/\s*[-–:]?\s*Movie\s*$/i, " ")
    .replace(/\s*Subtitle Indonesia\s*/i, " ")
    .replace(/\s*Sub\s*Indo\s*/i, " ")
    // og:title halaman sumber berakhiran " - Samehadaku" / " - Oploverz" dst.
    .replace(/\s*[-–|]\s*(Samehadaku|Oploverz|Anoboy|Otakudesu|Nimegami|Mirainime)\s*$/i, "")
    .replace(/\s+/g, " ").trim();
}
function epNumber(t) {
  const m = String(t || "").match(/Episode\s+(\d+(?:\.\d+)?)/i);
  return m ? m[1] : null;
}

// ---------- parser kartu artikel (tema animestream) ----------
function bsArticles(html) {
  const out = [];
  for (const a of html.match(/<article class="bs"[\s\S]*?<\/article>/g) || []) {
    const m = a.match(/<a href="([^"]+)"[^>]*title="([^"]+)"/i);
    if (!m) continue;
    const im = a.match(/data-src="(https?:[^"]+)"/i) || a.match(/src="(https?:[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
    out.push({ judul: unesc(m[2]).trim(), link: m[1], img: im && !/noimg/.test(im[1]) ? im[1] : null });
  }
  return out;
}

// ---------- arsip tanggal / bulan ----------
const pad = (n) => String(n).padStart(2, "0");

async function archivePosts(site, path, maxPages) {
  const out = [];
  for (let pg = 1; pg <= maxPages; pg++) {
    const url = site.base + path + (pg > 1 ? `page/${pg}/` : "");
    let html;
    try { html = await fetchText(url); } catch { break; }
    const arts = bsArticles(html);
    if (!arts.length) break;
    for (const a of arts) out.push({ ...a, src: site.name });
    if (arts.length < 10) break;
  }
  return out;
}

// Post episode digabung jadi daftar SERI: satu judul = satu entri.
// Urut: paling banyak di-upload lalu paling banyak muncul di situs.
function groupSeries(posts) {
  const map = new Map();
  for (const p of posts) {
    const series = stripEpisode(p.judul);
    if (!series || series.length < 3) continue;
    const k = toks(series).join(" ");
    if (!k) continue;
    const ep = epNumber(p.judul);
    if (!map.has(k)) map.set(k, { series, ep, link: p.link, srcs: [p.src], count: 1, img: p.img });
    else {
      const cur = map.get(k);
      cur.count++;
      if (!cur.srcs.includes(p.src)) cur.srcs.push(p.src);
      if (!cur.ep && ep) cur.ep = ep;
      if (!cur.img && p.img) cur.img = p.img;
    }
  }
  return [...map.values()].sort((a, b) => (b.count - a.count) || (b.srcs.length - a.srcs.length));
}

async function dayArchive(y, m, d) {
  const path = `${y}/${pad(m)}/${pad(d)}/`;
  const lists = await Promise.all(ARCHIVE_SITES.map((s) => archivePosts(s, path, 1)));
  return groupSeries(lists.flat());
}

async function monthArchive(y, m, maxPages) {
  const path = `${y}/${pad(m)}/`;
  const lists = await Promise.all(ARCHIVE_SITES.map((s) => archivePosts(s, path, maxPages || 4)));
  return groupSeries(lists.flat());
}

// ---------- metadata dari halaman sumber ----------
// Halaman episode: og:image = poster seri, dan berisi link ke halaman seri.
async function episodeMeta(url) {
  const html = await fetchText(url);
  const cover = (html.match(/property="og:image" content="([^"]+)"/i) || [])[1] || null;
  const ogTitle = unesc((html.match(/property="og:title" content="([^"]+)"/i) || [])[1] || "");
  const series = stripEpisode(ogTitle);
  const links = [...new Set(html.match(/https:\/\/samehadaku\.li\/anime\/[a-z0-9\-]+\//g) || [])];
  const q = toks(series);
  let best = null, bestScore = 0;
  for (const l of links) {
    const slug = l.split("/anime/")[1].replace(/\/$/, "");
    const s = dice(q, toks(slug));
    if (s > bestScore) { bestScore = s; best = l; }
  }
  return { cover, series, seriesLink: bestScore >= 0.3 ? best : null };
}

// Halaman seri: Season: Summer 2019, Type, Episodes, Studio, Status.
function parseSeriesInfo(html) {
  const info = (html.match(/<div class="info-content">([\s\S]*?)<\/div>/) || [])[1] || "";
  const txt = info.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const grab = (k) => {
    const m = txt.match(new RegExp(k + "\\s*:\\s*(.+?)(?=\\s+(?:Status|Studio|Released|Duration|Season|Type|Episodes|Censor|Director|Producers)\\s*:|$)", "i"));
    return m ? m[1].trim() : null;
  };
  return {
    cover: (html.match(/property="og:image" content="([^"]+)"/i) || [])[1] || null,
    season: grab("Season"),
    type: grab("Type"),
    episodes: grab("Episodes"),
    status: grab("Status"),
    studio: grab("Studio"),
  };
}

async function seriesMeta(url) {
  const html = await fetchText(url);
  return parseSeriesInfo(html);
}

// Lengkapi entri: cover + halaman seri + info musim.
// Hanya kandidat yang mungkin tampil (maks 2x limit) yang diambil detailnya.
async function enrich(items, limit, wantSeason) {
  const pool = items.slice(0, Math.min(items.length, Math.max(limit * 2, limit + 2)));
  const metas = await mapLimit(pool, 4, async (it) => {
    const ep = await episodeMeta(it.link).catch(() => null);
    const link = (ep && ep.seriesLink) || it.link;
    const sm = ep && ep.seriesLink ? await seriesMeta(link).catch(() => null) : null;
    return {
      cover: (sm && sm.cover) || (ep && ep.cover) || it.img || null,
      seriesLink: link,
      meta: sm,
      series: (ep && ep.series) || it.series,
    };
  });
  const out = [];
  for (let i = 0; i < pool.length; i++) {
    const m = metas[i] || {};
    if (wantSeason && m.meta && m.meta.season) {
      if (String(m.meta.season).toLowerCase() !== String(wantSeason).toLowerCase()) continue;
    }
    out.push({ ...pool[i], ...m });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- tampilan ----------
function sendChunked(reply, header, entries, tip) {
  const LIMIT = 3400;
  let buf = "", first = true;
  const flush = async () => {
    if (!buf.trim()) return;
    await reply((first ? header + "\n\n" : "") + buf.trimEnd());
    first = false; buf = "";
  };
  return (async () => {
    for (const e of entries) {
      const add = (buf ? "\n\n" : "") + e;
      if (buf && buf.length + add.length > LIMIT) await flush();
      buf += (buf ? "\n\n" : "") + e;
    }
    if (tip) buf += tip;
    await flush();
  })();
}

async function sendList(ctx, items, opts) {
  const { reply } = ctx;
  if (!items.length) { await reply(opts.emptyMsg || "Tidak ada judul ditemukan."); return true; }

  const album = [];
  const entries = [];
  items.forEach((it, i) => {
    const bits = [];
    if (it.ep) bits.push(`Episode ${it.ep}`);
    if (it.meta && it.meta.episodes) bits.push(`${it.meta.episodes} ep`);
    if (it.meta && it.meta.season) bits.push(it.meta.season);
    if (it.meta && it.meta.studio) bits.push(it.meta.studio);
    if (!it.meta || !it.meta.season) bits.push(it.srcs.join("/"));
    const cap = `${it.series}\n${bits.filter(Boolean).join(" · ")}\n▶ ${it.seriesLink || it.link}`;
    entries.push(`${i + 1}. ${cap}`);
    if (it.cover) album.push({ img: it.cover, caption: cap.slice(0, 1000), _local: false });
  });

  if (album.length) {
    try {
      if (typeof ctx.sendAlbum === "function") await ctx.sendAlbum(album);
      else throw new Error("no-album");
    } catch {
      for (const a of album) { try { await ctx.replyFile(a.img, a.caption); } catch { /* lanjut */ } }
    }
  }
  await sendChunked(reply, opts.header(items.length), entries, opts.tip || "");
  return true;
}

// ---------- mode: ongoing ----------
function parseHome(html, limit) {
  const main = html.split("Recommendation")[0];
  const out = [];
  for (const a of main.match(/<article class="bs"[\s\S]*?<\/article>/g) || []) {
    if (out.length >= limit) break;
    if (/<span class="epx">Completed<\/span>/i.test(a)) continue;
    const lm = a.match(/<a href="([^"]+)"[^>]*title="([^"]+)"/);
    const im = a.match(/data-src="(https?:[^"]+)"/) || a.match(/src="(https?[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
    if (!lm || !im || /noimg/.test(im[1])) continue;
    out.push({
      series: stripEpisode(lm[2]),
      link: lm[1],
      img: unesc(im[1]),
      srcs: ["Samehadaku"],
      ep: epNumber(lm[2]),
    });
  }
  return out;
}

async function sendOngoing(ctx, n) {
  const { reply } = ctx;
  let html;
  try { html = await fetchText(HOME); }
  catch (e) { await reply("Gagal buka Samehadaku: " + e.message); return true; }
  const list = parseHome(html, n);
  if (!list.length) { await reply("Tidak ada rilisan ongoing ditemukan."); return true; }

  const album = [];
  const entries = [];
  list.forEach((a, i) => {
    const cap = `${a.series}\nEpisode ${a.ep || "baru"} · Samehadaku\n▶ ${a.link}`;
    entries.push(`${i + 1}. ${cap}`);
    album.push({ img: a.img, caption: cap.slice(0, 1000), _local: false });
  });
  try {
    if (typeof ctx.sendAlbum === "function") await ctx.sendAlbum(album);
    else throw new Error("no-album");
  } catch {
    for (const it of album) { try { await ctx.replyFile(it.img, it.caption); } catch { /* lanjut */ } }
  }
  await sendChunked(reply, `Rilisan ongoing terbaru — ${list.length} judul:`, entries, "");
  return true;
}

// ---------- mode: tanggal ----------
async function sendDay(ctx, p, n) {
  const { reply } = ctx;
  const label = `${p.day} ${MONTH_NAME[p.month]} ${p.year}`;
  await reply(`Cek arsip tanggal ${label} di Samehadaku/Oploverz/Anoboy...`);
  let items = [];
  try { items = await dayArchive(p.year, p.month, p.day); } catch { items = []; }
  if (!items.length) {
    await reply(`Tidak ada upload anime di tanggal ${label} pada situs sumber.\nArsip tanggal situs sumber tersedia mulai awal 2024.\nCoba /anime ${MONTH_NAME[p.month].toLowerCase()} ${p.year} untuk lihat sebulan penuh.`);
    return true;
  }
  const picked = await enrich(items, n);
  return sendList(ctx, picked, {
    header: (shown) => `Anime rilis ${label} — ${shown} judul (arsip Samehadaku/Oploverz/Anoboy):`,
    emptyMsg: `Tidak ada judul di arsip ${label} yang bisa diambil detailnya.`,
  });
}

// ---------- mode: sebulan ----------
async function sendMonth(ctx, p, n) {
  const { reply } = ctx;
  const label = `${MONTH_NAME[p.month]} ${p.year}`;
  await reply(`Sisir arsip ${label} di Samehadaku/Oploverz/Anoboy...`);
  let items = [];
  try { items = await monthArchive(p.year, p.month, 4); } catch { items = []; }
  if (!items.length) { await reply(`Tidak ada upload anime di ${label} pada situs sumber.\nArsip bulanan situs sumber tersedia mulai awal 2024.`); return true; }
  const picked = await enrich(items, n);
  return sendList(ctx, picked, {
    header: (shown) => `Anime ${label} — ${shown} judul teratas (dari ${items.length} seri di arsip):`,
    emptyMsg: `Tidak ada judul di arsip ${label} yang bisa diambil detailnya.`,
  });
}

// ---------- mode: musim ----------
const SEASON_MONTHS = { WINTER: [1, 2, 3], SPRING: [4, 5, 6], SUMMER: [7, 8, 9], FALL: [10, 11, 12] };
const SEASON_EN = { WINTER: "Winter", SPRING: "Spring", SUMMER: "Summer", FALL: "Fall" };

async function sendSeason(ctx, year, season, n) {
  const { reply } = ctx;
  const months = SEASON_MONTHS[season];
  const label = `${SEASON_LABEL[season]} ${year}`;
  await reply(`Sisir arsip ${label} (${months.map((m) => MONTH_NAME[m]).join(", ")} ${year})...`);
  const lists = await Promise.all(months.map((m) => monthArchive(year, m, 3).catch(() => [])));
  const items = groupSeries(lists.flat());
  if (!items.length) { await reply(`Tidak ada upload anime untuk ${label} di situs sumber.\nArsip situs sumber tersedia mulai awal 2024, jadi musim sebelum itu tidak bisa disisir.`); return true; }

  let picked = await enrich(items, n, `${SEASON_EN[season]} ${year}`);
  let note = "";
  if (!picked.length) {
    picked = await enrich(items, n, null);
    note = `\n\nCatatan: halaman sumber tidak mencantumkan musim untuk judul-judul ini, jadi yang ditampilkan adalah yang paling banyak di-upload di 3 bulan tersebut.`;
  }
  return sendList(ctx, picked, {
    header: (shown) => `Anime ${label} — ${shown} judul (arsip ${months.map((m) => MONTH_NAME[m]).join("/")} ${year}):`,
    tip: note,
    emptyMsg: `Tidak ada judul ${label} yang bisa diambil detailnya.`,
  });
}

// ---------- konstanta tanggal ----------
const SEASONS = { winter: "WINTER", spring: "SPRING", summer: "SUMMER", fall: "FALL", autumn: "FALL", gugur: "FALL", panas: "SUMMER", dingin: "WINTER", semi: "SPRING" };
const SEASON_LABEL = { WINTER: "Winter (Musim Dingin)", SPRING: "Spring (Musim Semi)", SUMMER: "Summer (Musim Panas)", FALL: "Fall (Musim Gugur)" };
const MONTHS = {
  januari: 1, january: 1, jan: 1, februari: 2, february: 2, feb: 2, maret: 3, march: 3, mar: 3,
  april: 4, apr: 4, mei: 5, may: 5, juni: 6, june: 6, jun: 6, juli: 7, july: 7, jul: 7,
  agustus: 8, august: 8, agu: 8, ags: 8, aug: 8, september: 9, sep: 9, sept: 9,
  oktober: 10, october: 10, okt: 10, oct: 10, november: 11, nov: 11, desember: 12, december: 12, des: 12, dec: 12,
};
const MONTH_NAME = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

function parseDateArgs(args) {
  const low = args.map((a) => a.toLowerCase());
  for (const a of low) {
    const m = a.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) return { day: +m[1], month: +m[2], year: +m[3] };
  }
  let month = null, mi = -1;
  for (let i = 0; i < low.length; i++) {
    if (MONTHS[low[i]]) { month = MONTHS[low[i]]; mi = i; break; }
  }
  if (!month) return null;
  let year = null;
  for (const a of low) if (/^\d{4}$/.test(a)) year = +a;
  if (!year) return null;
  let day = null;
  for (let i = 0; i < low.length; i++) {
    if (i === mi || !/^\d{1,2}$/.test(low[i])) continue;
    const v = +low[i];
    if (v >= 1 && v <= 31) { day = v; break; }
  }
  return { day, month, year };
}

function validDate(p) {
  if (!(p.year >= 2005 && p.year <= new Date().getFullYear() + 1)) return false;
  if (!(p.month >= 1 && p.month <= 12)) return false;
  if (p.day && !(p.day >= 1 && p.day <= daysInMonth(p.year, p.month))) return false;
  return true;
}

const HINT = "Format:\n/anime jumlah — rilisan ongoing terbaru (contoh: /anime 5)\n/anime musim tahun — contoh: /anime summer 2019\n/anime tanggal bulan tahun — contoh: /anime 12 juni 2025\n/anime bulan tahun — contoh: /anime juni 2025\nSemua data diambil langsung dari situs sumber (Samehadaku/Oploverz/Anoboy), tanpa AniList.";

async function handle(ctx) {
  const text = (ctx.text || "").trim();
  if (!/^\/anime(\s|$)/i.test(text)) return null;
  const args = text.split(/\s+/).slice(1);

  let season = null, year = null, n = 5;
  for (const a of args) {
    const low = a.toLowerCase();
    if (SEASONS[low]) season = SEASONS[low];
    else if (/^\d{4}$/.test(a)) year = parseInt(a);
    else if (/^\d{1,2}$/.test(a)) n = parseInt(a);
  }
  n = Math.min(Math.max(n, 1), 15);

  const d = parseDateArgs(args);
  if (d) {
    if (!validDate(d)) { await ctx.reply("Tanggal tidak valid. Contoh: /anime 12 juni 2025"); return true; }
    let nn = 5;
    for (const a of args) {
      if (!/^\d{1,2}$/.test(a)) continue;
      const v = +a;
      if (d.day && v === d.day) continue;
      nn = v;
    }
    const want = Math.min(Math.max(nn, 1), 15);
    return d.day ? sendDay(ctx, d, want) : sendMonth(ctx, d, want);
  }

  if (season && year) {
    if (year < 2005 || year > new Date().getFullYear() + 1) { await ctx.reply("Tahun tidak valid. Contoh: /anime summer 2019"); return true; }
    return sendSeason(ctx, year, season, n);
  }
  if (season || year) { await ctx.reply(HINT); return true; }

  await ctx.reply("Mengambil rilisan ongoing terbaru...");
  return sendOngoing(ctx, Math.min(n, 10));
}

module.exports = {
  handle,
  _internals: {
    toks, dice, unesc, stripEpisode, epNumber, bsArticles, groupSeries,
    dayArchive, monthArchive, episodeMeta, seriesMeta, parseSeriesInfo, parseHome,
    enrich, parseDateArgs, validDate, daysInMonth, ARCHIVE_SITES,
  },
};
