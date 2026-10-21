"use strict";


const https = require("https");

const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const HOME = "https://samehadaku.li/";
const ANILIST = "https://graphql.anilist.co";
const OTK = "https://otakudesu.blog/";

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
const STOP = new Set(["season", "part", "movie", "final", "world", "anime", "special", "episode", "the", "and", "ova", "ona", "second", "third", "fourth", "story", "series", "show", "version", "subtitle", "indonesia"]);

function properNouns(s) {
  return String(s || "").split(/[^A-Za-z0-9]+/).filter((w) => /^[A-Z]/.test(w) && w.length >= 5 && !STOP.has(w.toLowerCase())).map((w) => w.toLowerCase());
}

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
    const shared = ct.filter((t) => q.t.includes(t));
    const sequelExtras = extra.filter((t) => SEQUEL.test(t));
    if (shared.length === 1 && sequelExtras.length === 0 && ct.length <= q.t.length + 1 && shared[0].length >= 6 && q.p.includes(shared[0]) && candP.has(shared[0])) {
      best = Math.max(best, 0.62);
    }
  }
  return best;
}

function qof(s) {
  return { t: toks(s), p: properNouns(s) };
}

function bsArticles(html, pathRe) {
  const out = [];
  const arts = html.match(/<article class="bs"[\s\S]*?<\/article>/g) || [];
  for (const a of arts) {
    const m = a.match(/<a href="([^"]+)"[^>]*title="([^"]+)"/i);
    if (!m) continue;
    if (pathRe && !pathRe.test(m[1])) continue;
    out.push({ judul: m[2].replace(/&amp;/g, "&").trim(), link: m[1] });
  }
  return out;
}

function otkRows(html) {
  const out = [];
  const rows = html.match(/<h2>\s*<a href="([^"]+\/anime\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi) || [];
  for (const r of rows) {
    const m = r.match(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!m) continue;
    const judul = m[2].replace(/<[^>]+>/g, "").replace(/&#\d+;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    out.push({ judul, link: m[1] });
  }
  return out;
}

function nimegamiCards(html) {
  const out = [];
  const arts = html.match(/<article class="anime-card[\s\S]*?<\/article>/g) || [];
  for (const a of arts) {
    const h = a.match(/<a[^>]*class="poster-link"[^>]*href="([^"]+)"/i) || a.match(/<a[^>]*href="([^"]+)"/i);
    if (!h) continue;
    const t = a.match(/aria-label="Lihat ([^"]+)"/i) || a.match(/class="card-title"[^>]*>([\s\S]*?)</i) || a.match(/alt="([^"]+)"/i);
    if (!t) continue;
    const link = /^https?:/i.test(h[1]) ? h[1] : "https://nimegami.id" + h[1];
    out.push({ judul: t[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim(), link });
  }
  return out;
}

function mirainimeJson(txt) {
  let arr;
  try { arr = JSON.parse(txt); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => x && x.url && (x.title || x.title_indonesian))
    .map((x) => ({ judul: String(x.title_indonesian || x.title).replace(/\s*Sub Indo$/i, "").trim(), link: x.url }));
}

const WATCH_SOURCES = [
  { name: "Samehadaku", url: (q) => `${HOME}?s=${q}&post_type=anime`, parse: (h) => bsArticles(h, /samehadaku\.[^/]+\/anime\//i) },
  { name: "Otakudesu", url: (q) => `${OTK}?s=${q}&post_type=anime`, parse: otkRows },
  { name: "Oploverz", url: (q) => `https://oploverz.ch/?s=${q}`, parse: (h) => bsArticles(h, /oploverz\.[^/]+\/series\//i) },
  { name: "Anoboy", url: (q) => `https://anoboy.be/?s=${q}`, parse: (h) => bsArticles(h, /anoboy\.[^/]+\/anime\//i) },
  { name: "Nimegami", url: (q) => `https://nimegami.id/anime/?q=${q}`, parse: nimegamiCards },
  { name: "Mirainime", url: (q) => `https://mirainime.com/search/live?q=${q}`, parse: mirainimeJson },
];

function encTitle(title) {
  return encodeURIComponent(String(title).replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim());
}

async function searchSource(src, title) {
  try {
    const body = await fetchText(src.url(encTitle(title)));
    return src.parse(body).map((c) => ({ ...c, src: src.name }));
  } catch { return []; }
}

const MIN_SCORE = 0.55;
const STRONG = 0.8;

async function resolveWatch(m) {
  const t = m.title || {};
  const base = [...new Set([t.romaji, t.english, ...(m.synonyms || [])].filter((s) => typeof s === "string" && s.trim().length > 2))];
  if (!base.length) return null;
  const short = toks(base[0]).slice(0, 3).join(" ");
  const titles = [...new Set(base.concat(short && short !== base[0].toLowerCase() ? [short] : []))];
  const queries = titles.map(qof).filter((q) => q.t.length);
  const key = "watch:" + titles.join("|").toLowerCase().slice(0, 300);
  const hit = cacheGet(key);
  if (hit !== null) return hit;

  const seen = new Set();
  const cands = [];
  for (const title of titles.slice(0, 4)) {
    const lists = await Promise.all(WATCH_SOURCES.map((s) => searchSource(s, title)));
    for (const list of lists) {
      for (const c of list) {
        if (seen.has(c.link)) continue;
        seen.add(c.link);
        c.score = scoreCand(queries, c.judul);
        cands.push(c);
      }
    }
    cands.sort((x, y) => (y.score - x.score) || (toks(x.judul).length - toks(y.judul).length));
    if (cands[0] && cands[0].score >= STRONG) break;
  }
  const best = cands[0] && cands[0].score >= MIN_SCORE ? cands[0] : null;
  cacheSet(key, best);
  return best;
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
  let list = parseList(html, n + 4);
  if (!list.length) { await reply("Tidak ada rilisan ongoing ditemukan."); return true; }

  const metas = await anilistByNames(list.map((a) => stripEpisode(a.judul)));
  const jp = list.filter((a, i) => metas[i] && metas[i].countryOfOrigin === "JP");
  if (jp.length) list = jp;
  list = list.slice(0, n);

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

const MEDIA_FIELDS = "title{romaji english} synonyms episodes averageScore genres siteUrl coverImage{large} format countryOfOrigin startDate{year month day}";

const JP_ONLY = true;
function isJP(m) { return !JP_ONLY || m.countryOfOrigin === "JP"; }

async function seasonList(year, season, limit) {
  const query = `query($y:Int,$s:MediaSeason,$p:Int){ Page(perPage:$p){ media(season:$s,seasonYear:$y,type:ANIME,countryOfOrigin:"JP",sort:POPULARITY_DESC,isAdult:false){ ${MEDIA_FIELDS} } } }`;
  const data = await postJson({ query, variables: { y: year, s: season, p: limit } });
  return (((data.data || {}).Page || {}).media || []).filter(isJP);
}

async function dayList(date, limit) {
  const query = `query($d:FuzzyDateInt,$p:Int){ Page(perPage:$p){ media(startDate:$d,type:ANIME,countryOfOrigin:"JP",sort:POPULARITY_DESC,isAdult:false){ ${MEDIA_FIELDS} } } }`;
  const data = await postJson({ query, variables: { d: date, p: limit } });
  return (((data.data || {}).Page || {}).media || []).filter(isJP);
}

async function monthList(from, to, want) {
  const query = `query($a:FuzzyDateInt,$b:FuzzyDateInt,$pg:Int){ Page(page:$pg,perPage:50){ media(startDate_greater:$a,startDate_lesser:$b,type:ANIME,countryOfOrigin:"JP",sort:POPULARITY_DESC,isAdult:false){ ${MEDIA_FIELDS} } } }`;
  const out = [];
  for (let pg = 1; pg <= 4 && out.length < want; pg++) {
    let data;
    try { data = await postJson({ query, variables: { a: from, b: to, pg } }); } catch { break; }
    const media = (((data.data || {}).Page || {}).media || []).filter(isJP);
    if (!media.length) break;
    out.push(...media);
  }
  return out;
}

async function anilistByNames(names) {
  const clean = names.filter((n) => n && n.trim()).slice(0, 12);
  if (!clean.length) return [];
  const one = async (n) => {
    const q = `query{ Media(search:${JSON.stringify(n)}, type:ANIME){ ${MEDIA_FIELDS} } }`;
    try { const d = await postJson({ query: q }); return (d.data || {}).Media || null; } catch { return null; }
  };
  const parts = clean.map((n, i) => `a${i}: Media(search:${JSON.stringify(n)}, type:ANIME){ ${MEDIA_FIELDS} }`).join(" ");
  let data = null;
  try { data = await postJson({ query: `query{ ${parts} }` }); } catch {  }
  if (data && !data.errors) {
    const d = data.data || {};
    return clean.map((_, i) => d["a" + i] || null);
  }
  const out = [];
  for (const n of clean) out.push(await one(n));
  return out;
}

const ARCHIVE_SOURCES = [
  { name: "Samehadaku", base: "https://samehadaku.li/" },
  { name: "Oploverz", base: "https://oploverz.ch/" },
  { name: "Anoboy", base: "https://anoboy.be/" },
];

function stripEpisode(t) {
  return String(t || "")
    .replace(/\s*[-–:]?\s*Episode\s+\d+(?:\.\d+)?\s*/i, " ")
    .replace(/\s*[-–:]?\s*Movie\s*$/i, " ")
    .replace(/\s*Subtitle Indonesia\s*/i, " ")
    .replace(/\s*Sub\s*Indo\s*/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function epNumber(t) {
  const m = String(t || "").match(/Episode\s+(\d+(?:\.\d+)?)/i);
  return m ? m[1] : null;
}

function parseSeriesInfo(html) {
  const cover = (html.match(/property="og:image" content="([^"]+)"/i) || [])[1] || null;
  const out = { cover, season: null, type: null, episodes: null, status: null, studio: null };

  const info = (html.match(/<div class="info-content">([\s\S]*?)<\/div>/) || [])[1] || "";
  if (info) {
    const txt = info.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const grab = (k) => {
      const m = txt.match(new RegExp(k + "\\s*:\\s*(.+?)(?=\\s+(?:Status|Studio|Released|Duration|Season|Type|Episodes|Censor|Director|Producers)\\s*:|$)", "i"));
      return m ? m[1].trim() : null;
    };
    out.season = grab("Season");
    out.type = grab("Type");
    out.episodes = grab("Episodes");
    out.status = grab("Status");
    out.studio = grab("Studio");
    return out;
  }

  const oz = (html.match(/<div class="infozingle">([\s\S]*?)<\/div>/) || [])[1] || "";
  if (oz) {
    const txt = oz.replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ");
    const grab = (label) => {
      const m = txt.match(new RegExp(label + "\\s*:\\s*([^\\n]+)", "i"));
      return m ? m[1].trim() : null;
    };
    out.type = grab("Tipe");
    out.episodes = grab("Total Episode");
    out.status = grab("Status");
    out.studio = grab("Studio");
    const rilis = grab("Tanggal Rilis");
    const mm = rilis && rilis.match(/([A-Za-z]{3})[a-z]*\s+\d{1,2},?\s+(\d{4})/);
    if (mm) {
      const idx = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(mm[1]);
      if (idx >= 0) {
        const s = idx <= 2 ? "Winter" : idx <= 5 ? "Spring" : idx <= 8 ? "Summer" : "Fall";
        out.season = `${s} ${mm[2]}`;
      }
    }
  }
  return out;
}

async function sourceMeta(link) {
  try {
    const html = await fetchText(link);
    return parseSeriesInfo(html);
  } catch { return null; }
}

function isRealPoster(url) {
  if (!url || !/^https?:/i.test(url)) return false;
  return !/og-[a-z]+\.(png|jpe?g)$|logo|placeholder|noimg|default[-_]?(image|cover)|favicon/i.test(url);
}

async function otherSourceMeta(m, opts) {
  const { needCover = false, needInfo = false, exclude = null } = opts || {};
  const t = m.title || {};
  const titles = [...new Set([t.romaji, t.english, ...(m.synonyms || [])].filter((s) => typeof s === "string" && s.trim().length > 2))];
  const queries = titles.map(qof);
  for (const title of titles.slice(0, 2)) {
    const lists = await Promise.all(WATCH_SOURCES.map((s) => searchSource(s, title)));
    const cands = [];
    for (const list of lists) for (const c of list) {
      if (exclude && c.link === exclude) continue;
      cands.push({ ...c, score: scoreCand(queries, c.judul) });
    }
    cands.sort((a, b) => b.score - a.score);
    for (const c of cands.slice(0, 4)) {
      if (c.score < 0.55) break;
      const meta = await sourceMeta(c.link);
      if (!meta) continue;
      const hasInfo = !!(meta.episodes || meta.season || meta.studio);
      const hasCover = isRealPoster(meta.cover);
      if ((needInfo && hasInfo) || (needCover && hasCover && !needInfo)) return meta;
    }
  }
  return null;
}

async function archiveDay(y, m, d) {
  const pad = (n) => String(n).padStart(2, "0");
  const dayPath = `${y}/${pad(m)}/${pad(d)}/`;
  const lists = await Promise.all(ARCHIVE_SOURCES.map(async (s) => {
    try {
      const html = await fetchText(s.base + dayPath);
      const out = [];
      for (const a of html.match(/<article class="bs"[\s\S]*?<\/article>/g) || []) {
        const mm = a.match(/<a href="([^"]+)"[^>]*title="([^"]+)"/i);
        if (!mm) continue;
        const raw = mm[2].replace(/&amp;/g, "&").trim();
        const series = stripEpisode(raw);
        if (!series || series.length < 3) continue;
        out.push({ series, ep: epNumber(raw), link: mm[1], src: s.name });
      }
      return out;
    } catch { return []; }
  }));
  const map = new Map();
  for (const list of lists) {
    for (const it of list) {
      const k = toks(it.series).join(" ");
      if (!k) continue;
      if (!map.has(k)) map.set(k, { ...it, srcs: [it.src] });
      else {
        const cur = map.get(k);
        if (!cur.srcs.includes(it.src)) cur.srcs.push(it.src);
        if (!cur.ep && it.ep) cur.ep = it.ep;
      }
    }
  }
  return [...map.values()].sort((a, b) => b.srcs.length - a.srcs.length);
}

async function sendArchiveList(ctx, items, label, limit) {
  const { reply } = ctx;
  const picked = items.slice(0, Math.min(limit, 10));
  const metas = await mapLimit(picked, 4, (it) => sourceMeta(it.link));

  const album = [];
  const entries = [];
  picked.forEach((it, i) => {
    const meta = metas[i];
    const bits = [];
    if (it.ep) bits.push(`Episode ${it.ep}`);
    bits.push(it.srcs.join("/"));
    if (meta && meta.episodes) bits.push(`${meta.episodes} ep`);
    if (meta && meta.season) bits.push(meta.season);
    if (meta && meta.studio) bits.push(meta.studio);
    const cap = `${it.series}\n${bits.join(" · ")}\n▶ ${it.link}`;
    entries.push(`${i + 1}. ${cap}`);
    const cover = meta && meta.cover;
    if (cover) album.push({ img: cover, caption: cap.slice(0, 1000), _local: false });
  });
  if (!entries.length) return false;
  if (album.length) {
    try {
      if (typeof ctx.sendAlbum === "function") await ctx.sendAlbum(album);
      else throw new Error("no-album");
    } catch {
      for (const a of album) { try { await ctx.replyFile(a.img, a.caption); } catch {  } }
    }
  }
  const header = `AniList tidak mencatat anime Jepang yang rilis ${label}.\nIni yang di-upload sumber di tanggal itu — ${entries.length} judul:`;
  await sendChunked(reply, header, entries, "");
  return true;
}

function mediaTitle(m) {
  return String((m.title && (m.title.english || m.title.romaji)) || "?").trim();
}
async function sendChunked(reply, header, entries, tip) {
  const LIMIT = 3400;
  let buf = "";
  let first = true;
  const flush = async () => {
    if (!buf.trim()) return;
    await reply((first ? header + "\n\n" : "") + buf.trimEnd());
    first = false;
    buf = "";
  };
  for (const e of entries) {
    const add = (buf ? "\n\n" : "") + e;
    if (buf && buf.length + add.length > LIMIT) await flush();
    buf += (buf ? "\n\n" : "") + e;
  }
  if (tip) buf += tip;
  await flush();
}

async function sendMediaList(ctx, media, opts) {
  const { reply } = ctx;
  const limit = Math.min(opts.limit || 5, 10);

  const pairs = [];
  for (let i = 0; i < media.length && pairs.length < limit; i += 3) {
    const batch = media.slice(i, i + 3);
    const res = await Promise.all(batch.map((m) => resolveWatch(m).catch(() => null)));
    for (let j = 0; j < batch.length && pairs.length < limit; j++) {
      if (res[j]) pairs.push({ m: batch[j], w: res[j] });
    }
  }
  if (!pairs.length) {
    if (typeof opts.fallback === "function" && (await opts.fallback())) return true;
    await reply(opts.emptyMsg || `Tidak ada dari ${media.length} judul itu yang punya link tonton di sumber langganan.`);
    return true;
  }

  const metas = await mapLimit(pairs, 4, ({ w }) => sourceMeta(w.link));

  const alts = await mapLimit(pairs, 4, async ({ m, w }, i) => {
    const own = metas[i] || {};
    const needCover = !isRealPoster(own.cover);
    const needInfo = !own.episodes || !own.season || !own.studio;
    if (!needCover && !needInfo) return null;
    return otherSourceMeta(m, { needCover, needInfo, exclude: w.link });
  });

  const pick = (k, i) => {
    const own = metas[i] || {};
    const alt = alts[i] || {};
    if (k === "cover") return isRealPoster(own.cover) ? own.cover : (isRealPoster(alt.cover) ? alt.cover : own.cover || null);
    return own[k] || alt[k] || null;
  };

  const infoLine = (i, withFormat) => {
    const bits = [];
    const type = pick("type", i), eps = pick("episodes", i), season = pick("season", i), studio = pick("studio", i);
    if (type && withFormat) bits.push(type);
    if (eps) bits.push(`${eps} ep`);
    if (season) bits.push(season);
    if (studio) bits.push(studio);
    return bits.join(" · ");
  };

  const album = [];
  const entries = [];
  pairs.forEach(({ m, w }, i) => {
    const info = infoLine(i, opts.withFormat);
    const cap = `${mediaTitle(m)}${info ? "\n" + info : ""}\n▶ ${w.src}: ${w.link}`;
    entries.push(`${i + 1}. ${cap}`);
    if (opts.noCover) return;
    const img = pick("cover", i);
    if (img) album.push({ img, caption: cap.slice(0, 1000), _local: false });
  });

  try {
    if (album.length && typeof ctx.sendAlbum === "function") await ctx.sendAlbum(album);
    else throw new Error("no-album");
  } catch {
    for (const it of album.slice(0, 5)) {
      try { await ctx.replyFile(it.img, it.caption); } catch {  }
    }
  }

  const header = opts.header(pairs.length, media.length);
  await sendChunked(reply, header, entries, opts.tip || "");
  return true;
}

async function sendSeason(ctx, year, season, n) {
  await ctx.reply(`Mencari anime ${SEASON_LABEL[season]} ${year}...`);
  let media;
  try { media = await seasonList(year, season, Math.min(n * 3 + 5, 50)); }
  catch (e) { await ctx.reply("Gagal ambil data musim: " + e.message); return true; }
  media = media.filter((m) => !["MUSIC", "MOVIE", "SPECIAL"].includes(m.format)).slice(0, Math.min(n * 3, 30));
  if (!media.length) { await ctx.reply(`Tidak ada anime ${SEASON_LABEL[season]} ${year} ditemukan.`); return true; }
  await ctx.reply(`Mencari link tonton untuk ${media.length} anime...`);
  return sendMediaList(ctx, media, {
    header: (shown, pool) => `Anime Jepang ${SEASON_LABEL[season]} ${year} — ${shown} judul${pool > shown ? ` (dari ${pool}, hanya yang ada link tonton)` : ""}:`,
    withFormat: false,
    limit: n,
  });
}

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
      media = await monthList(shiftDay(p.year, p.month, 1, -1), shiftDay(p.year, p.month, daysInMonth(p.year, p.month), 1), 200);
    } else {
      media = await dayList(ymd(p.year, p.month, p.day), 50);
    }
  } catch (e) { await ctx.reply("Gagal ambil data tanggal: " + e.message); return true; }

  media = media.filter((m) => {
    const sd = m.startDate || {};
    if (sd.year !== p.year || sd.month !== p.month) return false;
    if (!isMonth && sd.day !== p.day) return false;
    if (m.format === "MUSIC") return false;
    return isJP(m);
  });
  total = media.length;
  media = media.slice(0, Math.min(total, 15));
  const want = nGiven || 5;

  const archiveFallback = isMonth ? null : async () => {
    await ctx.reply(`AniList kosong untuk ${label} — cek arsip tanggal di situs sumber...`);
    let arch = [];
    try { arch = await archiveDay(p.year, p.month, p.day); } catch { arch = []; }
    if (!arch.length) return false;
    await sendArchiveList(ctx, arch, label, want);
    return true;
  };

  if (!media.length) {
    if (archiveFallback && (await archiveFallback())) return true;
    await ctx.reply(isMonth
      ? `Tidak ada anime yang tercatat rilis ${label}.`
      : `Tidak ada anime Jepang yang tercatat rilis ${label} dan arsip tanggal situs sumber juga kosong.\nCoba /anime ${MONTH_NAME[p.month].toLowerCase()} ${p.year} untuk lihat sebulan penuh.`);
    return true;
  }
  const tip = !isMonth && total <= 2 ? `\n\nCatatan: AniList cuma mencatat ${total} judul Jepang untuk tanggal ini. Coba /anime ${MONTH_NAME[p.month].toLowerCase()} ${p.year} untuk lihat sebulan penuh.` : "";
  return sendMediaList(ctx, media, {
    header: (shown, pool) => `Anime Jepang rilis ${label} — ${shown} judul${pool > shown ? ` (dari ${pool} kandidat, hanya yang ada link tonton)` : ""}:`,
    withFormat: true,
    limit: want,
    tip,
    fallback: archiveFallback,
    emptyMsg: `Tidak ada dari ${total} judul Jepang yang rilis ${label} yang punya halaman tonton di sumber langganan.`,
  });
}

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

module.exports = { handle, _internals: { toks, properNouns, qof, scoreCand, resolveWatch, dayList, archiveDay, anilistByNames, stripEpisode, sourceMeta, parseSeriesInfo, otherSourceMeta, isRealPoster, encTitle, parseDateArgs, validDate, daysInMonth, WATCH_SOURCES, bsArticles, otkRows, nimegamiCards, mirainimeJson } };
