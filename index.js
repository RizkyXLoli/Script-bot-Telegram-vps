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

const HELP = `MENU ELAINA BOT

[1] AI dan File
1. Kirim file (.log .txt .docx .pdf .csv .json / gambar) untuk diringkas AI
2. Kirim file (maks 150 MB, selain APK) lalu /tanya pertanyaan dalam 3 menit
3. /tanya pertanyaan untuk tanya soal file yang baru dikirim

[2] Download dan Musik
4. /dl link untuk download video (atau kirim link langsung)
5. Kirim link YouTube + tulis "jadi mp3", atau /mp3 link

[3] Tools
6. /kalk 12*8+5 untuk kalkulator
7. /cuaca Jakarta untuk info cuaca terkini
8. /tr en halo apa kabar untuk translate ke Inggris
9. /wiki Soekarno untuk ringkasan Wikipedia
10. /qr teks untuk buat gambar kode QR
11. /short link untuk perpendek URL
12. /jam wib untuk jam dunia (wib/wita/wit/london/tokyo/mekah)
13. /sholat Jakarta untuk jadwal sholat hari ini

[4] Fun dan Anime
14. /quote /joke /fakta /pantun untuk hiburan teks
15. /dadu /koin /suit batu untuk permainan
16. /ramal /tebak /jawab /nama Budi untuk ramalan dan kuis
17. /anime jumlah untuk rilisan ongoing (contoh: /anime 5)
18. /anime musim tahun untuk list anime per musim + link tonton (contoh: /anime summer 2019)
    musim: winter = Musim Dingin, spring = Musim Semi, summer = Musim Panas, fall = Musim Gugur
19. /anime tanggal bulan tahun untuk anime yang rilis di tanggal itu (contoh: /anime 12 juni 2025)
    /anime bulan tahun untuk sebulan penuh (contoh: /anime juli 2025), juga bisa 12/6/2025
    link tonton dicari di 6 situs: Samehadaku, Otakudesu, Oploverz, Anoboy, Nimegami, Mirainime
20. /wallpaper 1-5 untuk wallpaper anime random (alias /wp)
21. Kirim gambar + caption /stiker atas bawah untuk jadi stiker meme

[5] Lainnya
22. /ping untuk cek bot hidup
23. /id untuk lihat ID kamu
24. /menu untuk tampilkan menu ini

Khusus owner: ketik /owner`;

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