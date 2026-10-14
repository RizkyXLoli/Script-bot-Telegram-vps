"use strict";

require("dotenv").config?.() || (() => { try { require("fs").readFileSync(".env", "utf8").split("\n").forEach((l) => { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }); } catch {} })();

const store = require("./db/store");
const ai = require("./commands/ai");
const dlCmd = require("./commands/dl");
const toolsCmd = require("./commands/tools");
const funCmd = require("./commands/fun");
const animeCmd = require("./commands/anime");
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
  if (/^[!.\/]/.test(text)) return "/" + text.slice(1);
  return text;
}

async function onMessage(ctx) {
  const text = normalize(ctx.text || "");
  const { userId, platform, reply } = ctx;
  store.getUser(userId, platform);
  try { store.sweepExpired(); } catch {}

  if (text.startsWith("/owner")) {
    if (OWNERS.length && !isOwner(ctx)) return reply("Khusus owner.");
    const sub = text.split(/\s+/)[1] || "";
    if (sub === "stats") {
      const s = store.getStats();
      return reply(`User setup AI: ${s.usersSetup}\nBalasan AI: ${s.aiReplies}`);
    }
    return reply("Pakai: /owner stats");
  }

  if (/^\/sh(\s|$)/.test(text)) {
    if (!OWNERS.length || !isOwner(ctx)) return reply("Khusus owner.");
    const cmd = text.replace(/^\/sh\s*/i, "").trim();
    if (!cmd) return reply("Pakai: /sh <perintah>  contoh: /sh df -h");
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
  if (text === "/help" || text === "/menu") return reply(HELP);
  if (text === "/start") return reply("Halo! Ketik /ai setup untuk hubungkan AI-mu, atau /help untuk daftar perintah.");

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
  r = await dlCmd.handle({ ...ctx, text });
  if (r !== null && r !== undefined) return;
  r = await toolsCmd.handle({ ...ctx, text });
  if (r !== null && r !== undefined) return;
  r = await funCmd.handle({ ...ctx, text }, store);
  if (r !== null && r !== undefined) return;
  r = await animeCmd.handle({ ...ctx, text });
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
  await reply(`File "${name}" tersimpan (${(size / 1048576).toFixed(1)} MB). Gunakan /tanya >pertanyaan< untuk analisis file.`);
}

const HELP = `MENU ANGGOTA (semua bisa pakai)
1. kirim file (.log .txt .docx .pdf .csv .json gambar) — langsung diringkas
2. kirim file (max 150 MB, selain APK) lalu /tanya >soal< dalam 3 menit — file+soal dikirim ke AI bersamaan, file dihapus sesudahnya
3. kirim video (.mp4 .mov .mkv .webm) — otomatis dikonversi ke MP3 di VPS, dikirim balik, video+mp3 langsung dihapus
4. /tanya >soal< — tanya soal file yang baru dikirim
5. /dl <link> — download video (bisa juga kirim link langsung, otomatis)
6. YT ke MP3: kirim link youtube + tulis "jadi mp3" — atau /mp3 <link>
7. /ping — cek hidup
8. /help — pesan ini

Tools:
9. /kalk 12*8+5 — kalkulator
10. /cuaca Jakarta — info cuaca
11. /tr en halo — translate
12. /wiki Soekarno — Wikipedia
13. /qr <teks> — link gambar QR
14. /short <link> — perpendek link
15. /jam wib — jam dunia
16. /sholat Jakarta — jadwal sholat

Fun:
17. /quote /joke /fakta /pantun
18. /dadu /koin /suit batu
19. /ramal /tebak /jawab /nama Budi
20. /anime [jumlah] — rilisan ongoing terbaru Samehadaku (gambar+judul+link)

MENU OWNER (khusus owner)
20. /ai setup — hubungkan AI (pilih provider, model, API key)
21. /ai status — lihat AI aktifmu
22. /ai ganti — ganti model
23. /ai reset — hapus key + riwayat
24. /model — sama dengan /ai ganti
25. /lupa — hapus riwayat chat
26. /sh <perintah> — remote VPS (contoh: /sh df -h)
27. /promo <menit> <pesan> — promo terjadwal ke chat ini (contoh: /promo 60 Halo guys!)
28. /promo list/hapus/clear — kelola jadwal promo
29. /auto — status pesan otomatis grup ini (sholat + libur)
30. /auto sholat on|off — aktif/matikan pengingat tiap waktu sholat
31. /auto zona wib|wita|wit — pilih zona (Jakarta/Makassar/Jayapura)
32. /auto libur on|off — aktif/matikan ucapan libur nasional
33. /owner stats — statistik pemakaian AI`;

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