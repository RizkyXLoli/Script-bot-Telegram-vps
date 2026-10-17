"use strict";

// /anime — rilisan ongoing (Samehadaku), per musim & per tanggal/bulan (AniList) + link tonton.
// Sumber: samehadaku.li, otakudesu.blog, graphql.anilist.co. Tanpa dependency eksternal.

const https = require("https");

const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const HOME = "https://samehadaku.li/";
const ANILIST = "https://graphql.anilist.co";
const OTK = "https://otakudesu.blog/";

// ---------- cache sederhana (hindari request berulang) ----------
const TTL = 10 * 60 * 1000;
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
      res.on("data", (c) => { d += c; if (d.length > 2e6) res.destroy(); });
      res.on("end", () => { cacheSet(url, d); resolve(d); });
    }).on("error", reject).on("timeout", function () { this.destroy(new Error("timeout")); });
  });
}

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

// ---------- pencocokan judul + link tonton ----------
function toks(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/subtitle indonesia/g, "")
    .replace(/\(episode[^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
function dice(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let ov = 0;
  for (const t of A) if (B.has(t)) ov++;
  return (2 * ov) / (A.size + B.size);
}
const SEQUEL = /^(part|season|movie|final|new|world|future|the|and|s\d|\d+(st|nd|rd|th)|ii|iii|iv|v)$/;
// kata umum yang tidak boleh dianggap penanda judul khas
const STOP = new Set(["season", "part", "movie", "final", "world", "anime", "special", "episode", "the", "and", "ova", "ona", "second", "third", "fourth", "story", "series", "show", "version", "subtitle", "indonesia"]);

// Nama khas (kata berhuruf kapital, mis. "Mynoghra") yang muncul di dua judul
// adalah bukti kuat kecocokan, walaupun sisanya beda bahasa.
function properNouns(s) {
  return String(s || "").split(/[^A-Za-z0-9]+/).filter((w) => /^[A-Z]/.test(w) && w.length >= 5 && !STOP.has(w.toLowerCase())).map((w) => w.toLowerCase());
}

// Skor kecocokan judul: makin mirip makin tinggi, judul yang punya tambahan
// "Part N / Season N / Movie" dihukum supaya season yang diminta yang menang.
function scoreCand(queries, judul) {
  const ct = toks(judul);
  const candP = new Set(properNouns(judul));
  let best = 0;
  for (const q of queries) {
    let s = dice(q.t, ct);
    if (q.t.join(" ") === ct.join(" ")) s += 0.25;
    const extra = ct.filter((t) => !q.t.includes(t));
    s -= 0.06 * extra.length + 0.08 * extra.filter((t) => SEQUEL.test(t)).length;
    if (s > best) best = s;
    // Nama khas yang sama = bukti kuat, TAPI hanya kalau judulnya beda bahasa:
    // tepat satu token yang sama, token itu nama khas >=6 huruf, dan kandidat
    // tidak menambah penanda sekuel (Part/Season/Film). Tanpa syarat ini,
    // "Dr. STONE" akan dianggap cocok dengan "Science Future Part 3".
    const shared = ct.filter((t) => q.t.includes(t));
    const sequelExtras = extra.filter((t) => SEQUEL.test(t));
    if (shared.length === 1 && sequelExtras.length === 0 && shared[0].length >= 6 && q.p.includes(shared[0]) && candP.has(shared[0])) {
      best = Math.max(best, 0.62);
    }
  }
  return best;
}

function qof(s) {
  return { t: toks(s), p: properNouns(s) };
}

async function shSearch(title) {
  try {
    const q = encodeURIComponent(title.replace(/[^a-zA-Z0-9 ]/g, " ").trim());
    const html = await fetchText(`${HOME}?s=${q}&post_type=anime`);
    const out = [];
    const arts = html.match(/<article class="bs"[\s\S]*?<\/article>/g) || [];
    for (const a of arts) {
      const m = a.match(/<a href="(https?:\/\/samehadaku\.[^"]+\/anime\/[^"]+)"[^>]*title="([^"]+)"/i)
        || a.match(/<a href="([^"]+)"[^>]*title="([^"]+)"/i);
      if (m) out.push({ judul: m[2].replace(/&amp;/g, "&").trim(), link: m[1], src: "Samehadaku" });
    }
    return out;
  } catch { return []; }
}

async function otkSearch(title) {
  try {
    const q = encodeURIComponent(title.replace(/[^a-zA-Z0-9 ]/g, " ").trim());
    const html = await fetchText(`${OTK}?s=${q}&post_type=anime`);
    const out = [];
    const rows = html.match(/<h2>\s*<a href="(https?:\/\/otakudesu\.[^"]+\/anime\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi) || [];
    for (const r of rows) {
      const m = r.match(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!m) continue;
      const judul = m[2].replace(/<[^>]+>/g, "").replace(/&#\d+;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
      out.push({ judul, link: m[1], src: "Otakudesu" });
    }
    return out;
  } catch { return []; }
}

const MIN_SCORE = 0.55;

// Cari link tonton di Samehadaku & Otakudesu, ambil kandidat dengan judul paling cocok.
// Judul yang dicoba: romaji, english, dan sinonim (judul alternatif sering dipakai situs ID).
async function resolveWatch(m) {
  const t = m.title || {};
  const titles = [...new Set([t.romaji, t.english, ...(m.synonyms || [])].filter((s) => typeof s === "string" && s.trim().length > 2))];
  if (!titles.length) return null;
  const queries = titles.map(qof).filter((q) => q.t.length);
  const key = "watch:" + titles.join("|").toLowerCase().slice(0, 300);
  const hit = cacheGet(key);
  if (hit !== null) return hit;

  const seen = new Set();
  const cands = [];
  for (const title of titles.slice(0, 3)) {
    let [a, b] = await Promise.all([shSearch(title), otkSearch(title)]);
    // judul panjang sering tidak ketemu; coba versi pendek (3 kata pertama)
    if (!a.length && !b.length) {
      const short = toks(title).slice(0, 3).join(" ");
      if (short && short !== title.toLowerCase()) [a, b] = await Promise.all([shSearch(short), otkSearch(short)]);
    }
    for (const c of a.concat(b)) {
      if (seen.has(c.link)) continue;
      seen.add(c.link);
      c.score = scoreCand(queries, c.judul);
      cands.push(c);
    }
  }
  cands.sort((x, y) => (y.score - x.score) || (toks(x.judul).length - toks(y.judul).length));
  const best = cands[0] && cands[0].score >= MIN_SCORE ? cands[0] : null;
  cacheSet(key, best);
  return best;
}

// Kalau judulnya tidak ada di kedua situs, jangan biarkan kosong: kasih link
// pencarian supaya user tetap punya jalan.
function searchLinks(m) {
  const t = String((m.title && (m.title.english || m.title.romaji)) || "").replace(/[^a-zA-Z0-9 ]/g, " ").trim();
  if (!t) return null;
  const q = encodeURIComponent(t);
  return { sh: `${HOME}?s=${q}&post_type=anime`, otk: `${OTK}?s=${q}&post_type=anime` };
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

// ---------- Samehadaku: rilisan ongoing ----------
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

async function sendOngoing(ctx, n) {
  const { reply } = ctx;
  let html;
  try { html = await fetchText(HOME); }
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
    if (typeof ctx.sendAlbum === "function") await ctx.sendAlbum(items.map((it) => ({ img: it.img, caption: it.caption, _local: it.local })));
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

// ---------- AniList ----------
const SEASONS = { winter: "WINTER", spring: "SPRING", summer: "SUMMER", fall: "FALL", autumn: "FALL", gugur: "FALL", panas: "SUMMER", dingin: "WINTER", semi: "SPRING" };
const SEASON_LABEL = { WINTER: "Winter (Musim Dingin)", SPRING: "Spring (Musim Semi)", SUMMER: "Summer (Musim Panas)", FALL: "Fall (Musim Gugur)" };
const MONTHS = {
  januari: 1, january: 1, jan: 1, februari: 2, february: 2, feb: 2, maret: 3, march: 3, mar: 3,
  april: 4, apr: 4, mei: 5, may: 5, juni: 6, june: 6, jun: 6, juli: 7, july: 7, jul: 7,
  agustus: 8, august: 8, agu: 8, ags: 8, aug: 8, september: 9, sep: 9, sept: 9,
  oktober: 10, october: 10, okt: 10, oct: 10, november: 11, nov: 11, desember: 12, december: 12, des: 12, dec: 12,
};
const MONTH_NAME = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const FORMAT_LABEL = { TV: "TV", TV_SHORT: "TV pendek", MOVIE: "Film", SPECIAL: "Special", OVA: "OVA", ONA: "ONA", MUSIC: "Musik" };

const MEDIA_FIELDS = "title{romaji english} synonyms episodes averageScore genres siteUrl coverImage{large} format startDate{year month day}";

async function seasonList(year, season, limit) {
  const query = `query($y:Int,$s:MediaSeason,$p:Int){ Page(perPage:$p){ media(season:$s,seasonYear:$y,type:ANIME,sort:POPULARITY_DESC,isAdult:false){ ${MEDIA_FIELDS} } } }`;
  const data = await postJson({ query, variables: { y: year, s: season, p: limit } });
  return ((data.data || {}).Page || {}).media || [];
}

// AniList: filter `startDate` (FuzzyDateInt YYYYMMDD) mencocokkan tanggal PERSIS,
// jadi satu hari tidak perlu rentang dan tidak ada hasil yang terpotong.
async function dayList(date, limit) {
  const query = `query($d:FuzzyDateInt,$p:Int){ Page(perPage:$p){ media(startDate:$d,type:ANIME,sort:POPULARITY_DESC,isAdult:false){ ${MEDIA_FIELDS} } } }`;
  const data = await postJson({ query, variables: { d: date, p: limit } });
  return ((data.data || {}).Page || {}).media || [];
}

// `startDate_greater`/`lesser` eksklusif -> rentang sebulan dilebarkan 1 hari di
// tiap ujung supaya tanggal 1 dan tanggal terakhir tidak hilang. Dipaginasi
// (perPage 50, maks 4 halaman) karena satu bulan jauh lebih dari 50 judul.
async function monthList(from, to, want) {
  const query = `query($a:FuzzyDateInt,$b:FuzzyDateInt,$pg:Int){ Page(page:$pg,perPage:50){ media(startDate_greater:$a,startDate_lesser:$b,type:ANIME,sort:POPULARITY_DESC,isAdult:false){ ${MEDIA_FIELDS} } } }`;
  const out = [];
  for (let pg = 1; pg <= 4 && out.length < want; pg++) {
    let data;
    try { data = await postJson({ query, variables: { a: from, b: to, pg } }); } catch { break; }
    const media = ((data.data || {}).Page || {}).media || [];
    if (!media.length) break;
    out.push(...media);
  }
  return out;
}

// ---------- tampilan daftar ----------
function mediaTitle(m) {
  return String((m.title && (m.title.english || m.title.romaji)) || "?").trim();
}
function mediaInfo(m, withFormat) {
  const sd = m.startDate || {};
  const bits = [];
  if (withFormat && m.format) bits.push(FORMAT_LABEL[m.format] || m.format);
  if (sd.day && sd.month && sd.year) bits.push(`${sd.day} ${MONTH_NAME[sd.month]} ${sd.year}`);
  const lines = [];
  if (bits.length) lines.push(bits.join(" · "));
  lines.push(`${m.episodes || "?"} episode`);
  if (m.averageScore) lines.push("skor " + m.averageScore);
  if ((m.genres || []).length) lines.push(m.genres.slice(0, 3).join(", "));
  return lines.join("\n");
}

async function sendMediaList(ctx, media, opts) {
  const { reply } = ctx;
  const albumMax = Math.min(opts.albumMax || 10, 10);
  const watches = await mapLimit(media, 4, (m) => resolveWatch(m));
  const searches = media.map((m, i) => (watches[i] ? null : searchLinks(m)));

  const album = [];
  for (let i = 0; i < media.length && album.length < albumMax; i++) {
    const m = media[i];
    const img = m.coverImage && m.coverImage.large;
    if (!img) continue;
    const w = watches[i];
    const s = searches[i];
    const linkLine = w ? `\nTonton (${w.src}): ${w.link}` : s ? `\nCari: ${s.sh}` : "";
    album.push({
      img,
      caption: `${mediaTitle(m)}\n${mediaInfo(m, opts.withFormat)}${linkLine}`.slice(0, 1000),
      _local: false,
    });
  }
  try {
    if (album.length && typeof ctx.sendAlbum === "function") await ctx.sendAlbum(album);
    else throw new Error("no-album");
  } catch {
    for (const it of album.slice(0, 5)) {
      try { await ctx.replyFile(it.img, it.caption); } catch { /* lanjut */ }
    }
  }

  const lines = media.map((m, i) => {
    const w = watches[i];
    const s = searches[i];
    let tail = "";
    if (w) tail = `\nTonton (${w.src}): ${w.link}`;
    else if (s) tail = `\nBelum ada di Samehadaku/Otakudesu. Cari:\n${s.sh}\n${s.otk}`;
    return `${i + 1}. ${mediaTitle(m)}\n${mediaInfo(m, opts.withFormat)}\n${m.siteUrl || ""}${tail}`.trim();
  }).join("\n\n").slice(0, 3800);
  await reply(`${opts.header}\n\n${lines}${opts.tip || ""}`);
  return true;
}

// ---------- mode: musim ----------
async function sendSeason(ctx, year, season, n) {
  await ctx.reply(`Mencari anime ${SEASON_LABEL[season]} ${year}...`);
  let media;
  try { media = await seasonList(year, season, Math.min(n + 5, 30)); }
  catch (e) { await ctx.reply("Gagal ambil data musim: " + e.message); return true; }
  // film / special tidak dihitung sebagai daftar serial musim; ambil ekstra
  // supaya jumlah yang diminta tetap terpenuhi setelah difilter
  media = media.filter((m) => !["MUSIC", "MOVIE", "SPECIAL"].includes(m.format)).slice(0, n);
  if (!media.length) { await ctx.reply(`Tidak ada anime ${SEASON_LABEL[season]} ${year} ditemukan.`); return true; }
  await ctx.reply(`Mencari link tonton untuk ${media.length} anime...`);
  return sendMediaList(ctx, media, { header: `Anime ${SEASON_LABEL[season]} ${year} (populer):`, withFormat: false });
}

// ---------- mode: tanggal / bulan ----------
function ymd(y, m, d) { return y * 10000 + m * 100 + d; }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function shiftDay(y, m, d, delta) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

async function sendRange(ctx, p, n, nGiven) {
  const isMonth = !p.day;
  const label = isMonth ? `${MONTH_NAME[p.month]} ${p.year}` : `${p.day} ${MONTH_NAME[p.month]} ${p.year}`;

  await ctx.reply(`Mencari anime yang rilis ${label}...`);
  let media, total;
  try {
    if (isMonth) {
      // ujung rentang dilebarkan 1 hari karena greater/lesser eksklusif
      media = await monthList(shiftDay(p.year, p.month, 1, -1), shiftDay(p.year, p.month, daysInMonth(p.year, p.month), 1), 200);
    } else {
      media = await dayList(ymd(p.year, p.month, p.day), 50);
    }
  } catch (e) { await ctx.reply("Gagal ambil data tanggal: " + e.message); return true; }

  // saring ulang di sisi bot: tanggal harus persis, musik dibuang
  media = media.filter((m) => {
    const sd = m.startDate || {};
    if (sd.year !== p.year || sd.month !== p.month) return false;
    if (!isMonth && sd.day !== p.day) return false;
    return m.format !== "MUSIC";
  });
  // bulan: tetap urut popularitas (seperti mode musim), tanggal tetap tampil per judul
  total = media.length;
  // satu tanggal: tampilkan semua yang ada (maks 15); sebulan: 10 teratas per tanggal
  const cap = nGiven ? n : isMonth ? 10 : Math.min(total, 15);
  media = media.slice(0, cap);

  if (!media.length) {
    await ctx.reply(isMonth
      ? `Tidak ada anime yang tercatat rilis ${label}.`
      : `Tidak ada anime yang tercatat rilis ${label}.\nCoba /anime ${MONTH_NAME[p.month].toLowerCase()} ${p.year} untuk lihat sebulan penuh.`);
    return true;
  }
  const shown = media.length < total ? ` — menampilkan ${media.length} dari ${total}` : ` — ${total} judul`;
  const tip = !isMonth && total <= 2 ? `\n\nCatatan: AniList cuma mencatat ${total} judul untuk tanggal ini. Coba /anime ${MONTH_NAME[p.month].toLowerCase()} ${p.year} untuk lihat sebulan penuh.` : "";
  return sendMediaList(ctx, media, { header: `Anime rilis ${label} (populer)${shown}:`, withFormat: true, tip });
}

// ---------- parsing argumen ----------
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
  if (!(p.year >= 1940 && p.year <= new Date().getFullYear() + 1)) return false;
  if (!(p.month >= 1 && p.month <= 12)) return false;
  if (p.day && !(p.day >= 1 && p.day <= daysInMonth(p.year, p.month))) return false;
  return true;
}

const HINT = "Format:\n/anime jumlah — rilisan ongoing terbaru (contoh: /anime 5)\n/anime musim tahun — contoh: /anime summer 2019\n/anime tanggal bulan tahun — contoh: /anime 12 juni 2025\n/anime bulan tahun — contoh: /anime juni 2025";

async function handle(ctx) {
  const text = (ctx.text || "").trim();
  if (!/^\/anime(\s|$)/i.test(text)) return null;
  const args = text.split(/\s+/).slice(1);

  let season = null, year = null, n = 8;
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
    // angka 1-2 digit yang sama dengan tanggal bukan "jumlah" — hanya angka
    // tambahan (mis. /anime 12 juni 2025 5) yang dianggap permintaan jumlah
    let nGiven = false, nn = 8;
    for (const a of args) {
      if (!/^\d{1,2}$/.test(a)) continue;
      const v = +a;
      if (d.day && v === d.day) continue;
      nn = v; nGiven = true;
    }
    return sendRange(ctx, d, Math.min(Math.max(nn, 1), 15), nGiven);
  }

  if (season && year) {
    if (year < 1940 || year > new Date().getFullYear() + 1) { await ctx.reply("Tahun tidak valid. Contoh: /anime summer 2019"); return true; }
    return sendSeason(ctx, year, season, n);
  }
  if (season || year) { await ctx.reply(HINT); return true; }

  await ctx.reply("Mengambil rilisan ongoing terbaru...");
  return sendOngoing(ctx, Math.min(n, 10));
}

module.exports = { handle, _internals: { toks, properNouns, qof, scoreCand, resolveWatch, searchLinks, parseDateArgs, validDate, daysInMonth } };
