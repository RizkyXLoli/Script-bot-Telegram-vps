"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(stdout));
  });
}

function esc(t) {
  return String(t).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/\n/g, " ");
}

// Gambar + teks atas/bawah -> webp sticker 512x512
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

// /stiker [atas|bawah] — dipakai dengan kirim gambar + caption, atau reply gambar.
// Format teks: "atas | bawah" (satu bagian = teks bawah saja).
async function handle(ctx) {
  const { text, reply, replyFile, platform } = ctx;
  if (!/^\/(stiker|sticker|smeme)(\s|$)/i.test(text || "")) return null;
  const raw = text.replace(/^\/(stiker|sticker|smeme)\s*/i, "").trim().slice(0, 200);
  let top = "", bottom = "";
  if (raw.includes("|")) { const p = raw.split("|"); top = p[0].trim(); bottom = p.slice(1).join("|").trim(); }
  else bottom = raw;

  const src = ctx.filePath; // diset core/* saat pesan membawa gambar
  if (!src || !/\.(jpe?g|png|webp)$/i.test(ctx.fileName || src)) {
    return reply("Kirim gambar dengan caption /stiker [teks atas | teks bawah], atau reply gambar lalu ketik /stiker teksnya.\nContoh: kirim foto + caption \"/stiker halo | apa kabar\"");
  }
  let webp = null;
  try {
    await reply("Bikin stiker...");
    webp = await makeSticker(src, top, bottom);
    if (platform === "wa" && ctx.sendSticker) await ctx.sendSticker(webp);
    else if (platform === "wa") await replyFile(webp);
    else await ctx.sendSticker(webp);
  } catch (e) {
    await reply("Gagal bikin stiker: " + e.message);
  } finally {
    if (webp) try { fs.unlinkSync(webp); } catch {}
  }
}

module.exports = { handle, makeSticker };
