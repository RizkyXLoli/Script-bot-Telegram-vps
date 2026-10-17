"use strict";

require("dotenv").config?.() || (() => { try { require("fs").readFileSync(".env", "utf8").split("\n").forEach((l) => { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }); } catch {} })();

const store = require("./db/store");
const ai = require("./commands/ai");
const dlCmd = require("./commands/dl");
const toolsCmd = require("./commands/tools");
const funCmd = require("./commands/fun");
const animeCmd = require("./commands/anime");
const wpCmd = require("./commands/wallpaper");
const { chatReply } = ai;

const PREFIX = process.env.PREFIX || "/";
const OWNER = process.env.OWNER_ID || ""; 
const OWNERS = (process.env.OWNER_IDS || OWNER).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
function isOwner(ctx) {
  if (ctx.senderUser && OWNERS.some((o) => o.replace(/^@/,"").toLowerCase() === ctx.senderUser)) return true;
  if (!OWNERS.length) return true; 
  if (OWNERS.includes(ctx.userId)) return true;
  if (ctx.platform === "wa" && OWNERS.some((o) => o.startsWith("wa:") && ctx.userId.includes(o.slice(3)))) return true;
  return false;
}

function normalize(text) {
  let t = (text || "").trim();
  t = t.replace(/^([!./]\w+)@\S+/i, "$1"); // /menu@namabot -> /menu
  if (/^[!./]/.test(t)) return "/" + t.slice(1);
  return t;
}

async function onMessage(ctx) {
  const text = normalize(ctx.text || "");
  const { userId, platform, reply } = ctx;
  store.getUser(userId, platform);
  try { store.sweepExpired(); } catch {}

  // Filter kata berbahaya otomatis (grup). Perintah /mod tetap lolos ke handler.
  if (ctx.isGroup && !/^\/(mod|owner|sh)(\s|$)/i.test(text)) {
    try {
      const modHit = require("./commands/mod").check({ ...ctx, text, isOwner: isOwner(ctx) });
      if (modHit) {
        if (modHit.action === "kick" && typeof ctx.kickUser === "function") {
          try { await ctx.kickUser(); }
          catch (e) { await reply(modHit.msg + "\n(kick gagal, jadikan bot admin: " + e.message + ")"); return; }
          await reply(modHit.msg);
          return;
        }
        await reply(modHit.msg);
        if (modHit.action === "kick") return;
        return;
      }
    } catch {}
  }

  if (text.startsWith("/owner")) {
    if (OWNERS.length && !isOwner(ctx)) return reply("Khusus owner.");
    const sub = text.split(/\s+/)[1] || "";
    if (sub === "stats") {
      const s = store.getStats();
      return reply(`User setup AI: ${s.usersSetup}\nBalasan AI: ${s.aiReplies}`);
    }
    return reply(OWNER_MENU);
  }

  if (/^\/sh(\s|$)/.test(text)) {
    if (!OWNERS.length || !isOwner(ctx)) return reply("Khusus owner.");
    const cmd = text.replace(/^\/sh\s*/i, "").trim();
    if (!cmd) return reply("Pakai: /sh perintah  contoh: /sh df -h");
    const { execFile } = require("child_process");
    const out = await new Promise((resolve) => {
      execFile("bash", ["-c", cmd], { timeout: 30000, maxBuffer: 64 * 1024, cwd: "/root" }, (err, stdout, stderr) => {
        resolve({ err, stdout: String(stdout || ""), stderr: String(stderr || "") });
      });
    });
    let res = (out.stdout + (out.stderr ? "\n[stderr]\n" + out.stderr : "")).trim() || "(tanpa output)";
    if (out.err && out.err.killed) res = "Timeout 30 detik, proses dihentikan.\n" + res;
    else if (out.err && out.err.code) res = "[exit " + out.err.code + "]\n" + res;
    if (res.length > 3500) res = res.slice(0, 3500) + "\n... (dipotong)";
    return reply(res);
  }

  if (text === "/ping") return reply("Hidup! Bot WA+Telegram AI.");
  if (text === "/id") return reply("ID kamu: " + userId);
  if (/^\/(help|menu)(\s|$)/i.test(text)) return reply(HELP);
  if (/^\/panduan(\s|$)/i.test(text)) {
    const arg = text.split(/\s+/)[1] || "";
    const key = (arg.match(/^(\d)$/) || [])[1];
    const body = key && GUIDE[key] ? GUIDE[key] : GUIDE_ALL;
    return reply("```" + body + "```");
  }
  if (/^\/start(\s|$)/i.test(text)) return reply(`👋 *Halo, selamat datang di Elaina Bot!*\n━━━━━━━━━━━━━━━\n🤖 Asisten AI + downloader + tools serba bisa.\n\n📖 Ketik /menu untuk daftar perintah lengkap.\n⚙️ Owner: ketik /ai setup untuk hubungkan AI-mu.`);

  const aiQ = text.replace(/^\/ai\s*/i, "");
  if (/^\/ai(\s|$)/i.test(text) && aiQ && !/^(setup|status|ganti|reset)\b/i.test(aiQ)) {
    try { await chatReply(ctx, aiQ); }
    catch (e) { await reply("AI error: " + e.message); }
    return;
  }

  let r = await ai.handle({ ...ctx, text, isOwner: isOwner(ctx) });
  if (r !== null && r !== undefined) return;
  r = await require("./commands/promo").handle({ ...ctx, text, isOwner: isOwner(ctx) });
  if (r !== null && r !== undefined) return;
  r = await require("./commands/auto").handle({ ...ctx, text, isOwner: isOwner(ctx) });
  if (r !== null && r !== undefined) return;
  r = await require("./commands/mod").handle({ ...ctx, text, isOwner: isOwner(ctx) });
  if (r !== null && r !== undefined) return;
  r = await dlCmd.handle({ ...ctx, text });
  if (r !== null && r !== undefined) return;
  r = await toolsCmd.handle({ ...ctx, text });
  if (r !== null && r !== undefined) return;
  r = await funCmd.handle({ ...ctx, text }, store);
  if (r !== null && r !== undefined) return;
  r = await animeCmd.handle({ ...ctx, text });
  if (r !== null && r !== undefined) return;
  r = await wpCmd.handle({ ...ctx, text });
  if (r !== null && r !== undefined) return;
  r = await require("./commands/stiker").handle({ ...ctx, text });
  if (r !== null && r !== undefined) return;

  const user = store.getUser(userId, platform);
  if (user.setup_step && user.setup_step !== "idle") {
    const done = await ai.handleSetupFlow({ ...ctx, text: ctx.text });
    if (done) return;
  }

  if (ctx.text && !text.startsWith("/")) {
    if (ctx.isGroup) return; 
    try { await chatReply(ctx, ctx.text); }
    catch (e) { await reply("AI error: " + e.message); }
    return;
  }
  await reply("Tidak dikenal. Ketik /help.");
}

const FILE_TTL_MS = parseInt(process.env.FILE_TTL_MIN || "3", 10) * 60 * 1000;
const MAX_FILE_BYTES = 150 * 1024 * 1024;
const PENDING_DIR = process.env.PENDING_DIR || "/tmp/wa-tg-pending";

function pendingPath(userId, name) {
  const fs = require("fs");
  fs.mkdirSync(PENDING_DIR, { recursive: true });
  const safe = String(userId).replace(/[^a-zA-Z0-9_-]/g, "_") + "__" + Date.now() + "__" + String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  return require("path").join(PENDING_DIR, safe);
}

async function onFile(ctx) {
  const { userId, platform, filePath, name, reply, replyFile, senderName } = ctx;
  const fs = require("fs");
  store.getUser(userId, platform);
  const user = store.getUser(userId, platform);
  let cred = user.api_key ? user : null;
  if (!cred && typeof store.getOwnerCreds === "function") {
    try { cred = store.getOwnerCreds(process.env.OWNER_IDS ? process.env.OWNER_IDS.split(/[\s,]+/) : (process.env.OWNER_ID ? [process.env.OWNER_ID] : [])); } catch {}
  }
  if (!cred || !cred.api_key) {
    try { fs.unlinkSync(filePath); } catch {}
    await reply("AI owner belum disetup. Minta owner ketik /ai setup dulu.");
    return;
  }
  if (/\.apk$/i.test(name || "") || /vnd\.android\.package/i.test(name || "")) {
    try { fs.unlinkSync(filePath); } catch {}
    await reply("File APK tidak diterima dan tidak disimpan di VPS.");
    return;
  }
  let size = 0;
  try { size = fs.statSync(filePath).size; } catch {}
  if (size > MAX_FILE_BYTES) {
    try { fs.unlinkSync(filePath); } catch {}
    await reply("File kebesaran, maksimal 150 MB. Tidak disimpan.");
    return;
  }
  
  if (/\.(mp4|mov|mkv|webm|avi|3gp|m4v)$/i.test(name || "")) {
    const dl = require("./services/downloader");
    await reply("Video diterima, lagi dikonversi ke MP3...");
    let mp3 = null;
    try {
      mp3 = await dl.videoToMp3(filePath);
      if (replyFile) await replyFile(mp3, "Hasil konversi MP3 dari " + (name || "video") + ".");
      else await reply("Konversi selesai tapi tidak bisa kirim file di platform ini.");
    } catch (e) {
      await reply("Gagal konversi ke MP3: " + e.message);
    } finally {
      dl.safeUnlink(filePath);
      dl.safeUnlink(mp3);
    }
    return;
  }
  const dest = pendingPath(userId, name);
  try { fs.copyFileSync(filePath, dest); } catch (e) {
    await reply("Gagal simpan file: " + e.message);
    return;
  }
  try { fs.unlinkSync(filePath); } catch {}
  store.clearPendingExcept(userId, dest);
  store.setPending(userId, dest, name, senderName, Date.now() + FILE_TTL_MS);
  const menit = Math.round(FILE_TTL_MS / 60000);
  await reply(`File "${name}" tersimpan (${(size / 1048576).toFixed(1)} MB). Gunakan /tanya pertanyaan untuk analisis file.`);
}

const OWNER_MENU = `MENU OWNER

[1] Kelola AI
1. /ai setup untuk hubungkan AI (pilih provider, model, API key)
2. /ai status untuk lihat AI yang aktif
3. /ai ganti untuk ganti model AI
4. /ai reset untuk hapus API key + riwayat chat
5. /model sama dengan /ai ganti
6. /lupa untuk hapus riwayat chat

[2] VPS dan Grup
7. /sh perintah untuk jalankan perintah di VPS (contoh: /sh df -h)
8. /promo menit pesan untuk kirim promo terjadwal ke chat ini
9. /promo list hapus clear untuk kelola jadwal promo
10. /auto untuk status pengingat otomatis grup ini
11. /auto sholat on off untuk pengingat tiap waktu sholat
12. /auto zona wib wita wit untuk pilih zona waktu
13. /auto libur on off untuk ucapan libur nasional
14. /mod untuk moderasi grup (filter kata, warn 3x = kick, welcome)
15. /owner stats untuk statistik pemakaian AI`;

// Panduan pemakaian per fitur (dipanggil /panduan atau /panduan <nomor>).
const GUIDE = {
  1: `[1] AI dan File
Kirim file langsung ke chat (tanpa perintah):
  .log .txt .docx .pdf .csv .json / gambar
Bot merangkum isinya lalu membalas.

Kalau mau tanya lanjutan soal file itu:
  1. kirim filenya
  2. ketik /tanya apa isi kesimpulannya?
File disimpan 3 menit, maks 150 MB, APK ditolak.`,
  2: `[2] Download dan Musik
/dl <link>
  contoh: /dl https://youtu.be/xxxx
  atau cukup kirim link-nya (bot auto deteksi)
  Dukung: YouTube, TikTok, IG, FB, X.

/mp3 <link>
  atau kirim link YouTube lalu tulis: jadi mp3`,
  3: `[3] Tools
/kalk 12*8+5        kalkulator
/cuaca Jakarta      cuaca terkini
/tr en halo apa kabar   translate (en/id/jp/ar/...)
/wiki Soekarno      ringkasan Wikipedia
/qr teks            gambar QR
/short <url>        perpendek URL
/jam wib            wib/wita/wit/london/tokyo/mekah
/sholat Jakarta     jadwal sholat hari ini`,
  4: `[4] Fun dan Anime
/quote /joke /fakta /pantun    hiburan teks
/dadu /koin /suit batu         permainan
/ramal /tebak /jawab /nama Budi   ramalan & kuis

/anime 5               rilisan ongoing
/anime summer 2019     per musim
/anime 12 juni 2025    rilis di tanggal itu
/anime juli 2025       sebulan penuh
/wallpaper 1-5         wallpaper (alias /wp)
/stiker                kirim gambar + caption ini`,
  5: `[5] Lainnya
/ping     cek bot hidup
/id       lihat ID kamu
/menu     daftar perintah
/panduan  penjelasan tiap fitur

Owner saja:
/owner         menu owner
/owner stats   statistik pemakaian AI
/ai setup      hubungkan AI
/sh <perintah> jalankan perintah shell`,
};

const GUIDE_ALL = Object.keys(GUIDE).sort().map((k) => GUIDE[k]).join("\n\n");

// Menu dibungkus ``` supaya tampil monospace: di Telegram jadi <pre>,
// di WhatsApp jadi font monospace. Baris dijaga <= 42 karakter agar tidak
// wrap di layar HP (kalau wrap, kolom nomor jadi tidak rata).
const HELP = "```" + `MENU ELAINA BOT
==============================

[1] AI dan File
 1. Kirim file -> diringkas AI
 2. File + /tanya (3 menit)
 3. /tanya soal file terakhir

[2] Download dan Musik
 4. /dl link  unduh video
 5. /mp3 link  atau "jadi mp3"

[3] Tools
 6. /kalk 12*8+5
 7. /cuaca Jakarta
 8. /tr en halo apa kabar
 9. /wiki Soekarno
10. /qr teks
11. /short link
12. /jam wib
13. /sholat Jakarta

[4] Fun dan Anime
14. /quote /joke /fakta /pantun
15. /dadu /koin /suit batu
16. /ramal /tebak /jawab /nama
17. /anime 5  (ongoing)
18. /anime summer 2019  (musim)
19. /anime 12 juni 2025  (tanggal)
    /anime juli 2025  (sebulan)
    atau 12/6/2025
20. /wallpaper 1-5  (alias /wp)
21. gambar + /stiker  (meme)

[5] Lainnya
22. /ping
23. /id
24. /menu
25. /panduan  cara pakai tiap fitur

Owner: /owner` + "```";

async function main() {
  const { startTG } = require("./core/tg");
  const tgBot = await startTG(onMessage, onFile);
  const { startWA } = require("./core/wa");
  const ownerChat = (OWNERS.find((o) => o.startsWith("tg:")) || "").slice(3);
  await startWA(onMessage, onFile, { tgBot, ownerChatId: ownerChat });
  require("./core/scheduler").start();
  setInterval(() => { try { store.sweepExpired(); } catch {} }, 60 * 1000);
  console.log("Bot jalan (Telegram). Prefix: " + PREFIX);
}

main().catch((e) => { console.error(e); process.exit(1); });