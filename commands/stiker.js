"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const MAX_TEXT = 200;
const MAX_CHARS = 14;
const MAX_LINES = 8;
const SAFE_W = 396;
const SAFE_H = 420;
const TG_LIMIT = 500 * 1024;
const WA_LIMIT = 600 * 1024;
const DUR = 2.6;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).slice(0, 400))) : resolve(stdout));
  });
}

function esc(t) {
  return String(t).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/\n/g, " ");
}

const PALETTES = [
  ["0x0b1020", "0x7c3aed"],
  ["0x052e2b", "0x10b981"],
  ["0x1e1b4b", "0xec4899"],
  ["0x111827", "0x3b82f6"],
  ["0x3b0764", "0xf59e0b"],
  ["0x0f172a", "0xef4444"],
  ["0x0c4a6e", "0x22d3ee"],
];
function paletteFor(t) {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

function resolveStyle(text, bg) {
  const b = String(bg || "auto").toLowerCase();
  if (b === "putih" || b === "white" || b === "#ffffff" || b === "0xffffff") {
    return { kind: "solid", color: "white", fontcolor: "0x111111", borderw: 0, bordercolor: "white" };
  }
  if (/^(#|0x)[0-9a-f]{6}$/.test(b)) {
    return { kind: "solid", color: "0x" + b.replace(/^(#|0x)/, ""), fontcolor: "white", borderw: 6, bordercolor: "black@0.85" };
  }
  const [c0, c1] = paletteFor(text);
  return { kind: "gradient", c0, c1, fontcolor: "white", borderw: 6, bordercolor: "black@0.85" };
}

function clean(t) {
  return String(t || "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
}

function sentenceCase(t) {
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function greedyWrap(words, max) {
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= max) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function wrapText(t, max) {
  const words = String(t).split(" ").filter(Boolean);
  if (!words.length) return [];
  const hard = Math.min(34, Math.max(max, Math.ceil(String(t).length / 2)));
  let best = null;
  for (let m = 1; m <= hard; m++) {
    const lines = greedyWrap(words, m);
    if (!best || lines.length < best.length) best = lines;
    if (best.length === 1) break;
  }
  const out = [];
  for (const l of best) {
    if (l.length <= hard) out.push(l);
    else for (let i = 0; i < l.length; i += hard) out.push(l.slice(i, i + hard));
  }
  return out.slice(0, MAX_LINES);
}

function layout(text) {
  const lines = wrapText(text, MAX_CHARS);
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const byWidth = Math.floor(SAFE_W / (longest * 0.62));
  const byHeight = Math.floor(SAFE_H / (Math.max(1, lines.length) * 1.22));
  const fontsize = Math.max(18, Math.min(80, Math.min(byWidth, byHeight)));
  const lineHeight = Math.round(fontsize * 1.22);
  return { lines, fontsize, lineHeight, blockH: lineHeight * Math.max(1, lines.length) };
}

const by = (L, i) => `(h-${L.blockH})/2+${i * L.lineHeight}`;
const fade = (d, dur = 0.3) => `if(lt(t,${d}),0,if(lt(t,${d + dur}),(t-${d})/${dur},1))`;
const rise = (d, dur, dist) => `${dist}*(1-min(max(t-${d},0)/${dur},1))`;
const delay = (i, step) => +(i * step).toFixed(2);

const ANIMS = {
  "slide-up": (i, n, L) => ({
    y: `${by(L, i)}+${rise(0, 0.5, 340)}+9*sin(2*PI*t/1.6)`,
    alpha: fade(0),
  }),
  "slide-down": (i, n, L) => ({
    y: `${by(L, i)}-${rise(0, 0.5, 340)}+9*sin(2*PI*t/1.7)`,
    alpha: fade(0),
  }),
  "slide-left": (i, n, L) => ({
    x: `(w-text_w)/2-540*(1-min(t/0.55,1))`,
    y: `${by(L, i)}+6*sin(2*PI*t/1.5)`,
    alpha: fade(0),
  }),
  "slide-right": (i, n, L) => ({
    x: `(w-text_w)/2+540*(1-min(t/0.55,1))`,
    y: `${by(L, i)}+6*sin(2*PI*t/1.5)`,
    alpha: fade(0),
  }),
  "zoom-in": (i, n, L) => ({
    y: `${by(L, i)}+5*sin(2*PI*t/1.3)`,
    alpha: fade(0),
    fontsize: `if(lt(t,0.5),${Math.round(L.fontsize * 0.3)}+${Math.round(L.fontsize * 0.7)}*(t/0.5),${L.fontsize}+4*sin(2*PI*(t-0.5)/1.2))`,
  }),
  "zoom-out": (i, n, L) => ({
    y: `${by(L, i)}+5*sin(2*PI*t/1.4)`,
    alpha: fade(0),
    fontsize: `if(lt(t,0.5),${Math.round(L.fontsize * 1.5)}-${Math.round(L.fontsize * 0.5)}*(t/0.5),${L.fontsize}-4*sin(2*PI*(t-0.5)/1.2))`,
  }),
  "pop-lines": (i, n, L) => {
    const d = delay(i, 0.16);
    return {
      y: `${by(L, i)}+${rise(d, 0.4, 260)}+7*sin(2*PI*t/1.4-${(i * 0.5).toFixed(2)})`,
      alpha: fade(d),
    };
  },
  "bounce": (i, n, L) => ({
    y: `${by(L, i)}+${rise(0, 0.4, 300)}-${Math.round(46 + i * 4)}*abs(sin(PI*max(t-0.4,0)*1.15))`,
    alpha: fade(0),
  }),
  "wave": (i, n, L) => {
    const d = delay(i, 0.1);
    return {
      y: `${by(L, i)}+${rise(0, 0.45, 300)}+${Math.round(12 + i * 3)}*sin(2*PI*max(t-0.45,0)/1.1-${(i * 0.7).toFixed(2)})`,
      alpha: fade(d),
    };
  },
  "pulse": (i, n, L) => ({
    y: `${by(L, i)}+${rise(0, 0.45, 260)}+4*sin(2*PI*t/1.2)`,
    alpha: `if(lt(t,0.3),t/0.3,0.55+0.45*abs(sin(PI*max(t-0.3,0)*1.25)))`,
  }),
  "shake": (i, n, L) => ({
    x: `(w-text_w)/2+${Math.round(9 + i * 2)}*sin(2*PI*t*4.2)`,
    y: `${by(L, i)}+${rise(0, 0.45, 300)}`,
    alpha: fade(0),
  }),
  "drift": (i, n, L) => ({
    x: `(w-text_w)/2+${Math.round(16 + i * 4)}*sin(2*PI*t/2.2)`,
    y: `${by(L, i)}+${rise(0, 0.45, 300)}+${Math.round(14 + i * 3)}*cos(2*PI*t/2.2)`,
    alpha: fade(0),
  }),
  "spin-lines": (i, n, L) => {
    const d = delay(i, 0.14);
    const dist = 210 + i * 30;
    const ang = (i * 1.4).toFixed(2);
    return {
      x: `(w-text_w)/2+${dist}*(1-min(max(t-${d},0)/0.5,1))*cos(${ang})`,
      y: `${by(L, i)}+${dist}*(1-min(max(t-${d},0)/0.5,1))*sin(${ang})+6*sin(2*PI*t/1.5)`,
      alpha: fade(d),
    };
  },
};

const BY_WORDS = [
  { max: 2, list: ["zoom-in", "zoom-out", "bounce", "pulse", "shake", "slide-up", "slide-down"] },
  { max: 5, list: ["slide-up", "slide-down", "slide-left", "slide-right", "pop-lines", "wave", "spin-lines"] },
  { max: Infinity, list: ["wave", "pop-lines", "drift", "slide-up", "pulse", "spin-lines"] },
];

function pickAnim(text, forced) {
  if (forced && ANIMS[forced]) return { name: forced, fn: ANIMS[forced] };
  const n = String(text).split(/\s+/).filter(Boolean).length;
  const bucket = BY_WORDS.find((b) => n <= b.max) || BY_WORDS[BY_WORDS.length - 1];
  const name = bucket.list[Math.floor(Math.random() * bucket.list.length)];
  return { name, fn: ANIMS[name] };
}

function writeLines(lines) {
  const base = path.join(os.tmpdir(), "stiker-txt-" + process.pid + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7));
  return lines.map((l, i) => {
    const p = base + "-" + i + ".txt";
    fs.writeFileSync(p, l);
    return p;
  });
}

function drawFilters(L, style, animName) {
  const files = writeLines(L.lines);
  const anim = animName ? pickAnim(L.lines.join(" "), animName) : null;
  const filters = files.map((f, i) => {
    let x = `(w-text_w)/2`, y = by(L, i), alpha = "", fsExpr = `${L.fontsize}`;
    if (anim) {
      const a = anim.fn(i, files.length, L);
      if (a.x) x = a.x;
      if (a.y) y = a.y;
      if (a.alpha) alpha = `:alpha='${a.alpha}'`;
      if (a.fontsize) fsExpr = `'${a.fontsize}'`;
    }
    return `drawtext=fontfile='${FONT}':textfile='${f}':expansion=none:fontsize=${fsExpr}` +
      `:fontcolor=${style.fontcolor}:borderw=${style.borderw}:bordercolor=${style.bordercolor}` +
      `:x='${x}':y='${y}'${alpha}`;
  });
  return { filters, files, anim };
}

function bgInput(style, fps) {
  if (style.kind === "solid") {
    return { args: ["-f", "lavfi", "-i", `color=c=${style.color}:s=512x512:r=${fps}:d=${DUR}`], chain: [] };
  }
  return {
    args: ["-f", "lavfi", "-i", `gradients=s=512x512:c0=${style.c0}:c1=${style.c1}:x0=0:y0=512:x1=512:y1=0:r=1:d=1`],
    chain: [`loop=loop=-1:size=1:start=0`, `fps=${fps}`],
  };
}

function cleanup(files) {
  for (const f of files || []) try { fs.unlinkSync(f); } catch {}
}

async function makeSticker(src, top, bottom) {
  const out = path.join(os.tmpdir(), "stiker-" + Date.now() + ".webp");
  const filters = ["scale=512:512:force_original_aspect_ratio=decrease",
    "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000", "format=rgba"];
  if (top) filters.push(`drawtext=fontfile='${FONT}':text='${esc(top)}':fontsize=44:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=20`);
  if (bottom) filters.push(`drawtext=fontfile='${FONT}':text='${esc(bottom)}':fontsize=44:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-text_h-20`);
  await run(FFMPEG, ["-y", "-i", src, "-vf", filters.join(","), "-vcodec", "libwebp",
    "-lossless", "0", "-qscale", "75", "-preset", "picture", "-an", out]);
  return out;
}

async function makeTextSticker(text, opts = {}) {
  const style = resolveStyle(text, opts.bg);
  const L = layout(text);
  const { filters, files } = drawFilters(L, style, null);
  const out = path.join(os.tmpdir(), "stiker-teks-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7) + ".webp");
  const bg = bgInput(style, 1);
  const chain = [...bg.chain, ...filters].join(",");
  try {
    await run(FFMPEG, ["-y", ...bg.args, "-vf", chain, "-frames:v", "1",
      "-c:v", "libwebp", "-qscale", "88", "-preset", "picture", "-an", out]);
  } finally { cleanup(files); }
  return out;
}

async function makeTextGif(text, target = "wa", opts = {}) {
  const style = resolveStyle(text, opts.bg);
  const L = layout(text);
  const fps = target === "tg" ? 15 : 10;
  const { filters, files, anim } = drawFilters(L, style, opts.anim || true);
  const bg = bgInput(style, fps);
  const ext = target === "tg" ? ".webm" : ".webp";
  const out = path.join(os.tmpdir(), "stiker-gif-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7) + ext);
  const chain = [...bg.chain, ...filters].join(",");
  const encode = (q, crf) => {
    const a = ["-y", ...bg.args, "-vf", chain, "-t", String(DUR), "-an"];
    if (target === "tg") {
      a.push("-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", String(crf),
        "-deadline", "good", "-cpu-used", "4", "-row-mt", "1");
    } else {
      a.push("-c:v", "libwebp_anim", "-loop", "0", "-qscale", String(q), "-preset", "picture");
    }
    a.push(out);
    return run(FFMPEG, a);
  };
  try {
    await encode(45, 34);
    const limit = target === "tg" ? TG_LIMIT : WA_LIMIT;
    if (fs.statSync(out).size > limit) await encode(26, 44);
  } finally { cleanup(files); }
  return { file: out, anim: anim ? anim.name : null };
}

async function kirimStiker(ctx, file) {
  if (ctx.sendSticker) return ctx.sendSticker(file);
  if (ctx.replyFile) return ctx.replyFile(file);
  throw new Error("platform tidak mendukung kirim stiker");
}

function parseOpts(raw) {
  let text = raw, bg = "auto";
  const mBg = text.match(/\s--?bg\s+(putih|white|#?[0-9a-fA-F]{6}|0x[0-9a-fA-F]{6})\s*$/i);
  if (mBg) { bg = mBg[1].toLowerCase(); text = text.replace(mBg[0], "").trim(); }
  const mP = text.match(/\s(--?putih|--?white|-p)\s*$/i);
  if (mP) { bg = "putih"; text = text.replace(mP[0], "").trim(); }
  return { text, bg };
}

async function handle(ctx) {
  const { text, reply, platform } = ctx;
  if (!/^\/(stiker|sticker|smeme|svgif|sgif)(\s|$)/i.test(text || "")) return null;

  const isGif = /^\/(svgif|sgif)(\s|$)/i.test(text);
  const cmd = isGif ? /^\/(svgif|sgif)\s*/i : /^\/(stiker|sticker|smeme)\s*/i;
  const raw0 = String(text).replace(cmd, "").trim().slice(0, MAX_TEXT);
  const { text: raw, bg } = parseOpts(raw0);

  const src = ctx.filePath;
  const adaGambar = src && /\.(jpe?g|png|webp)$/i.test(ctx.fileName || src);

  if (adaGambar && !isGif) {
    let top = "", bottom = "";
    if (raw.includes("|")) { const p = raw.split("|"); top = p[0].trim(); bottom = p.slice(1).join("|").trim(); }
    else bottom = raw;
    let webp = null;
    try {
      await reply("Bikin stiker...");
      webp = await makeSticker(src, top, bottom);
      await kirimStiker(ctx, webp);
    } catch (e) {
      await reply("Gagal bikin stiker: " + e.message);
    } finally {
      if (webp) try { fs.unlinkSync(webp); } catch {}
    }
    return {};
  }

  const isi = sentenceCase(clean(raw));
  if (!isi) {
    const c = isGif ? "/svgif" : "/smeme";
    return reply(`Format: ${c} <teks> [--putih]\n` +
      `Contoh: ${c} halo sayang\n` +
      `Latar putih: ${c} halo sayang --putih\n` +
      `Warna lain: ${c} halo sayang --bg #ffcc00`);
  }

  let out = null;
  try {
    if (isGif) {
      await reply("Bikin stiker bergerak...");
      out = (await makeTextGif(isi, platform === "tg" ? "tg" : "wa", { bg })).file;
    } else {
      out = await makeTextSticker(isi, { bg });
    }
    await kirimStiker(ctx, out);
    return {};
  } catch (e) {
    await reply("Gagal bikin stiker: " + e.message);
    return {};
  } finally {
    if (out) try { fs.unlinkSync(out); } catch {}
  }
}

module.exports = {
  handle, makeSticker, makeTextSticker, makeTextGif,
  wrapText, clean, sentenceCase, layout, resolveStyle, pickAnim, ANIMS, parseOpts,
};
