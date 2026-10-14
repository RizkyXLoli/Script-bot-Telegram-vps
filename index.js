"use strict";

require("dotenv").config?.() || (() => { try { require("fs").readFileSync(".env", "utf8").split("\n").forEach((l) => { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }); } catch {} })();

const store = require("./db/store");
const ai = require("./commands/ai");
const dlCmd = require("./commands/dl");
const { chatReply } = ai;

const PREFIX = process.env.PREFIX || "/";
const OWNER = process.env.OWNER_ID || ""; // id owner, mis. wa:628xx atau tg:12345
const OWNERS = (process.env.OWNER_IDS || OWNER).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
function isOwner(ctx) {
  if (ctx.senderUser && OWNERS.some((o) => o.replace(/^@/,"").toLowerCase() === ctx.senderUser)) return true;
  if (!OWNERS.length) return true; // belum diset: izinkan semua (mode setup awal)
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
    if (OWNER && userId !== OWNER) return reply("Khusus owner.");
    const sub = text.split(/\s+/)[1] || "";
    if (sub === "stats") {
      const s = store.getStats();
      return reply(`User setup AI: ${s.usersSetup}\nBalasan AI: ${s.aiReplies}`);
    }
    return reply("Pakai: .owner stats");
  }

  if (/^\/sh(\s|$)/.test(text)) {
    if (!OWNERS.length || !isOwner(ctx)) return reply("Khusus owner.");
    const cmd = text.replace(/^\/sh\s*/i, "").trim();
    if (!cmd) return reply("Pakai: .sh <perintah>  contoh: .sh df -h");
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

  if (text === ".ping") return reply("Hidup! Bot WA+Telegram AI.");
  if (text === ".help" || text === ".menu") return reply(HELP);
  if (text === ".start") return reply("Halo! Ketik .ai setup untuk hubungkan AI-mu, atau .help untuk daftar perintah.");

  const aiQ = text.replace(/^\/ai\s*/i, "");
  if (/^\/ai(\s|$)/i.test(text) && aiQ && !/^(setup|status|ganti|reset)\b/i.test(aiQ)) {
    try { await chatReply(ctx, aiQ); }
    catch (e) { await reply("AI error: " + e.message); }
    return;
  }

  let r = await ai.handle({ ...ctx, text, isOwner: isOwner(ctx) });
  if (r !== null && r !== undefined) return;
  r = await dlCmd.autoHandle({ ...ctx, text });
  if (r !== null && r !== undefined) return;

  const user = store.getUser(userId, platform);
  if (user.setup_step && user.setup_step !== "idle") {
    const done = await ai.handleSetupFlow({ ...ctx, text: ctx.text });
    if (done) return;
  }

  if (ctx.text && !text.startsWith("/")) {
    if (ctx.isGroup) return; // grup: diam kecuali ada perintah /ai
    try { await chatReply(ctx, ctx.text); }
    catch (e) { await reply("AI error: " + e.message); }
    return;
  }
  await reply("Tidak dikenal. Ketik .help.");
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
  const { userId, platform, filePath, name, reply, senderName } = ctx;
  const fs = require("fs");
  store.getUser(userId, platform);
  const user = store.getUser(userId, platform);
  if (!user.api_key) {
    try { fs.unlinkSync(filePath); } catch {}
    await reply("File diterima, tapi kamu belum .ai setup. Setup dulu ya.");
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
  const dest = pendingPath(userId, name);
  try { fs.copyFileSync(filePath, dest); } catch (e) {
    await reply("Gagal simpan file: " + e.message);
    return;
  }
  try { fs.unlinkSync(filePath); } catch {}
  store.clearPendingExcept(userId, dest);
  store.setPending(userId, dest, name, senderName, Date.now() + FILE_TTL_MS);
  const menit = Math.round(FILE_TTL_MS / 60000);
  await reply(`File "${name}" tersimpan (${(size / 1048576).toFixed(1)} MB). Gunakan .tanya >pertanyaan< untuk analisis file.`);
}

const HELP = `Perintah bot:

.ai setup — hubungkan AI (pilih provider, model, API key)
.ai status — lihat AI aktifmu
.ai ganti — ganti model
.ai reset — hapus key + riwayat
.model — sama dengan .ai ganti
.lupa — hapus riwayat chat
kirim file (max 150 MB, selain APK) lalu .tanya >soal< dalam 3 menit — file+soal dikirim ke AI bersamaan, file dihapus sesudahnya
.tanya >soal< — tanya soal file yang baru dikirim
.dl <link> — download video (bisa juga kirim link langsung, otomatis)
YT → MP3: kirim link youtube + tulis "jadi mp3" — atau .mp3 <link>
kirim file (.log .txt .docx .pdf .csv .json gambar) — langsung diringkas
.ping — cek hidup
.sh <perintah> — remote VPS (khusus owner)
.help — pesan ini`;

async function main() {
  const { startTG } = require("./core/tg");
  await startTG(onMessage, onFile);
  setInterval(() => { try { store.sweepExpired(); } catch {} }, 60 * 1000);
  console.log("Bot jalan (Telegram). Prefix: " + PREFIX);
}

main().catch((e) => { console.error(e); process.exit(1); });
