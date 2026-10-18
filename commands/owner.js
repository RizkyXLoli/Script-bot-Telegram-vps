"use strict";

// Perintah owner: /broadcast /chats /stats /backup /restart

const path = require("path");

const store = require("../db/store");
const scheduler = require("../core/scheduler");

const CMDS = ["/broadcast", "/bc", "/chats", "/stats", "/backup", "/restart"];

function cmdName(text) {
  const m = String(text || "").trim().match(/^\/[^@\s]+/);
  return (m ? m[0] : "").toLowerCase();
}

function uptime(sec) {
  const s = Math.floor(sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d ? d + " hari" : "", (d || h) ? h + " jam" : "", m + " mnt"].filter(Boolean).join(" ");
}

async function handle(ctx) {
  const { text, reply, isOwner, platform, chatId } = ctx;
  const cmd = cmdName(text);
  if (!CMDS.includes(cmd)) return null;
  if (!isOwner) return reply("Khusus owner.");

  const arg = String(text || "").trim().split(/\s+/).slice(1).join(" ").trim();

  if (cmd === "/broadcast" || cmd === "/bc") {
    const chats = store.listChats(500);
    if (!arg) {
      return reply("Broadcast ke " + chats.length + " chat terdaftar.\nPakai: /broadcast teks pesan");
    }
    if (arg.length > 3000) return reply("Pesan terlalu panjang (maks 3000 karakter).");
    await reply("📤 Mengirim broadcast ke " + chats.length + " chat...");
    let ok = 0, fail = 0;
    for (const c of chats) {
      try {
        await scheduler.sender(c.platform, c.chat_id, "📢 " + arg);
        ok++;
      } catch { fail++; }
      await new Promise((r) => setTimeout(r, 150));
    }
    return reply("Broadcast selesai.\nTerkirim: " + ok + "\nGagal: " + fail + "\nTotal chat: " + chats.length);
  }

  if (cmd === "/chats") {
    const chats = store.listChats(20);
    if (!chats.length) return reply("Belum ada chat terdaftar.");
    const lines = chats.map((c, i) => (i + 1) + ". " + c.platform + " · " + (c.title || c.chat_id) + "\n    " + c.chat_id + " · " + c.last_seen);
    return reply("CHAT TERDAFTAR (total " + store.countChats() + ", tampil 20 terbaru)\n\n" + lines.join("\n"));
  }

  if (cmd === "/stats") {
    const s = store.statsDetail();
    const mem = process.memoryUsage();
    return reply(
      "STATISTIK BOT\n" +
      "Uptime: " + uptime(process.uptime()) + "\n" +
      "RAM: " + (mem.rss / 1048576).toFixed(0) + " MB\n" +
      "Node: " + process.version + "\n\n" +
      "User total: " + s.users + "\n" +
      "User setup AI: " + s.usersSetup + "\n" +
      "Balasan AI: " + s.aiReplies + "\n" +
      "Chat terdaftar: " + s.chats + "\n" +
      "Pengingat aktif: " + s.reminders + "\n" +
      "Jadwal promo: " + s.schedules + "\n" +
      "File pending: " + s.pending
    );
  }

  if (cmd === "/backup") {
    const fp = path.resolve(process.env.DB_PATH || path.join(__dirname, "..", "db", "bot.sqlite3"));
    const fs = require("fs");
    if (!fs.existsSync(fp)) return reply("Database tidak ditemukan di " + fp);
    if (typeof ctx.sendDoc !== "function") return reply("Platform ini belum bisa kirim dokumen.");
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
    await ctx.sendDoc(fp, "Backup database " + stamp + " UTC (" + (fs.statSync(fp).size / 1024).toFixed(0) + " KB)");
    return "sent";
  }

  if (cmd === "/restart") {
    await reply("🔄 Restart bot... (kembali online dalam beberapa detik)");
    // Restart=always aktif: cukup bunuh diri, systemd menyalakan ulang —
    // tanpa jendela dua instance (pemicu error Conflict getUpdates).
    setTimeout(() => process.exit(0), 1000);
    return "sent";
  }

  return null;
}

module.exports = { handle };
