"use strict";

const dl = require("../services/downloader");

const URL_RE = /https?:\/\/\S+/i;
const SOSMED_RE = /(youtube\.com|youtu\.be|tiktok\.com|vt\.tiktok|vm\.tiktok|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com|dailymotion\.com|vimeo\.com|twitch\.tv|capcut\.com|snackvideo)/i;

function findSosmedUrl(text) {
  const m = (text || "").match(URL_RE);
  if (m && SOSMED_RE.test(m[0])) return m[0];
  return null;
}

async function doDownload(ctx, url, asMp3) {
  const { reply, replyFile } = ctx;

  if (!(await dl.downloaderReady())) {
    return reply("Fitur download belum aktif di VPS ini (butuh yt-dlp + ffmpeg).\nPasang: sudo apt install ffmpeg; sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod +x /usr/local/bin/yt-dlp");
  }

  await reply("Mengunduh, tunggu...");
  let file = null;
  try {
    file = await dl.download(url, asMp3);
    await replyFile(file, asMp3 ? "Hasil konversi MP3." : "Hasil download.");
  } catch (e) {
    const raw = e.message || "";
    console.error("[dl] gagal unduh:", raw.slice(0, 500));
    let msg = raw.slice(0, 200);
    if (/login required|cookies/i.test(raw)) msg = "Video butuh login (privat/umur). Coba video publik lain.";
    else if (/unsupported url|no video|empty|nothing to download/i.test(raw)) msg = "Link tidak dikenali / video tidak ketemu. Pastikan link video langsung.";
    else if (/429|too many requests/i.test(raw)) msg = "Server sosmed batasi (rate-limit). Tunggu 1-2 menit lalu kirim ulang linknya.";
    else if (/file tidak ketemu|larger than|max-filesize/i.test(raw)) msg = "Video terlalu besar (di atas 150 MB) atau gagal diambil.";
    await reply("Gagal: " + msg);
  } finally {
    dl.safeUnlink(file); 
  }
}

async function autoHandle(ctx) {
  const link = findSosmedUrl(ctx.text);
  if (!link) return null;
  const asMp3 = /mp3|lagu|audio/i.test(ctx.text || "");
  await doDownload(ctx, link, asMp3);
  return "done";
}

async function handle(ctx) {
  const { text, reply } = ctx;
  const cmd = text.trim().split(/\s+/)[0].toLowerCase();
  if (!["/dl", "/mp3", "/potong"].includes(cmd)) {
    return autoHandle(ctx);
  }

  const m = text.match(URL_RE);
  if (!m) return reply(`Contoh: ${cmd} https://youtube.com/watch?v=xxxx`);

  if (cmd === "/potong") {
    return reply("Potong durasi: .mp3 <link> lalu tulis rentang, contoh: .potong <link> 0:30-1:30 — (tersedia setelah VPS punya ffmpeg; untuk sekarang pakai .mp3 full).");
  }
  return doDownload(ctx, m[0], cmd === "/mp3");
}

module.exports = { handle, autoHandle };