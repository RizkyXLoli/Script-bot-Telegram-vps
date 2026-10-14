"use strict";

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const MAX_BYTES = 150 * 1024 * 1024;
const TMP = process.env.DL_TMP || path.join(os.tmpdir(), "wa-tg-dl");

function haveBin(bin) {
  return new Promise((resolve) => {
    execFile("which", [bin], (err) => resolve(!err));
  });
}

async function downloaderReady() {
  return (await haveBin("yt-dlp")) && (await haveBin("ffmpeg"));
}

function run(cmd, args, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const lines = String(stderr || err.message || "").split("\n");
        const useful = lines.filter((l) => /^(ERROR|WARNING)/.test(l.trim())).join(" ").slice(0, 250)
          || lines.filter((l) => l.trim() && !/^\s*(File |Traceback)/.test(l)).slice(-2).join(" ").slice(0, 250)
          || err.message.slice(0, 250);
        return reject(new Error(useful));
      }
      resolve(stdout);
    });
  });
}

async function tiktokFallback(url) {
  const api = "https://www.tikwm.com/api/?url=" + encodeURIComponent(url);
  const json = await new Promise((resolve, reject) => {
    const h = url.startsWith("https") ? require("https") : require("http");
    h.get(api, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(d));
    }).on("error", reject).setTimeout(30000, function () { this.destroy(new Error("tikwm timeout")); });
  });
  let j;
  try { j = JSON.parse(json); } catch { throw new Error("tikwm respon rusak"); }
  const play = j?.data?.play || j?.data?.wmplay;
  if (!play) throw new Error("tikwm: video tidak ketemu");
  const dest = path.join(TMP, "tiktok-" + Date.now() + ".mp4");
  await new Promise((resolve, reject) => {
    const h = play.startsWith("https") ? require("https") : require("http");
    h.get(play, { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.tikwm.com/" } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error("tikwm unduh gagal (" + res.statusCode + ")"));
      const ws = fs.createWriteStream(dest);
      res.pipe(ws).on("finish", resolve).on("error", reject);
    }).on("error", reject).setTimeout(240000, function () { this.destroy(new Error("unduh timeout")); });
  });
  if (fs.statSync(dest).size > MAX_BYTES) {
    safeUnlink(dest);
    throw new Error("hasil 150 MB ke atas, dikirim sebagai link saja");
  }
  return dest;
}

async function download(url, asMp3) {
  fs.mkdirSync(TMP, { recursive: true });
  const tpl = path.join(TMP, "%(id)s.%(ext)s");
  const base = [
    "--no-playlist",
    "--retries", "3",
    "--impersonate", "chrome",
    "--js-runtimes", "deno",
    "--user-agent", "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "--extractor-args", "youtube:player_client=android,web",
    "--max-filesize", "150m",
    "-o", tpl,
  ];
  const args = asMp3
    ? [...base, "-x", "--audio-format", "mp3", "--audio-quality", "0", url]
    : [...base, "-f", "bv*[filesize<150M]+ba/b[filesize<150M]/b", url];
  try {
    await run("yt-dlp", args);
  } catch (e) {
    if (/tiktok\.com|vt\.tiktok|vm\.tiktok/i.test(url)) {
      try { return await tiktokFallback(url); }
      catch (e2) { throw new Error(e.message + " | cadangan: " + e2.message); }
    }
    throw e;
  }
  const files = fs.readdirSync(TMP).map((f) => path.join(TMP, f));
  if (!files.length) throw new Error("file tidak ketemu setelah download");
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const file = files[0];
  if (fs.statSync(file).size > MAX_BYTES) {
    safeUnlink(file);
    throw new Error("hasil 150 MB ke atas, dikirim sebagai link saja");
  }
  return file;
}

function safeUnlink(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}

async function videoToMp3(srcPath) {
  if (!(await haveBin("ffmpeg"))) throw new Error("ffmpeg belum terpasang di VPS");
  if (!fs.existsSync(srcPath)) throw new Error("file video tidak ketemu");
  if (fs.statSync(srcPath).size > MAX_BYTES) throw new Error("video di atas 150 MB");
  const out = srcPath.replace(/\.[a-z0-9]+$/i, "") + "-" + Date.now() + ".mp3";
  await run("ffmpeg", ["-y", "-i", srcPath, "-vn", "-b:a", "192k", out], 300000);
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error("konversi gagal");
  return out;
}

function cleanupTmp() {
  try {
    for (const f of fs.readdirSync(TMP)) safeUnlink(path.join(TMP, f));
  } catch {}
}

module.exports = { downloaderReady, download, videoToMp3, safeUnlink, cleanupTmp, MAX_BYTES };