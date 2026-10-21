"use strict";


const store = require("../db/store");

const CMDS = ["/kick", "/tendang", "/promote", "/demote", "/tutup", "/buka", "/tagall", "/admin", "/info", "/setname", "/warn"];

function cmdName(text) {
  const m = String(text || "").trim().match(/^\/[^@\s]+/);
  return (m ? m[0] : "").toLowerCase();
}

async function canModerate(ctx) {
  if (ctx.isOwner) return true;
  if (typeof ctx.checkAdmin === "function") {
    try { return await ctx.checkAdmin(); } catch { return false; }
  }
  return false;
}

function targetFrom(ctx) {
  if (ctx.targetUser && ctx.targetUser.userId) return ctx.targetUser;
  const m = String(ctx.text || "").match(/(\d{5,})/);
  if (!m) return null;
  const raw = m[1];
  const id = ctx.platform === "tg" ? raw : raw + "@s.whatsapp.net";
  return { userId: ctx.platform + ":" + raw, id, name: raw };
}

async function handle(ctx) {
  const { text, reply, platform, chatId, isGroup } = ctx;
  const cmd = cmdName(text);
  if (!CMDS.includes(cmd)) return null;
  if (!isGroup || !chatId) return reply("Perintah ini hanya bisa dipakai di dalam grup.");

  if (!(await canModerate(ctx))) return reply("Khusus owner atau admin grup.");
  const g = ctx.groupAdmin;
  if (!g) return reply("Bot belum bisa mengelola grup di platform ini.");

  const arg = String(text || "").trim().split(/\s+/).slice(1).join(" ").trim();
  const target = targetFrom(ctx);

  try {
    if (cmd === "/kick" || cmd === "/tendang") {
      if (!target) return reply("Reply pesan orangnya, atau tulis /kick 62812xxxx (nomor/ID).");
      if (target.userId === ctx.userId) return reply("Tidak bisa menendang diri sendiri.");
      await g.kick(target.id);
      return reply("✅ " + (target.name || "User") + " dikeluarkan dari grup.");
    }

    if (cmd === "/promote") {
      if (!target) return reply("Reply pesan orangnya, atau tulis /promote 62812xxxx.");
      await g.promote(target.id);
      return reply("✅ " + (target.name || "User") + " sekarang admin.");
    }

    if (cmd === "/demote") {
      if (!target) return reply("Reply pesan orangnya, atau tulis /demote 62812xxxx.");
      await g.demote(target.id);
      return reply("✅ " + (target.name || "User") + " bukan admin lagi.");
    }

    if (cmd === "/tutup") { await g.mute(); return reply("🔒 Grup ditutup. Hanya admin yang bisa kirim pesan."); }
    if (cmd === "/buka") { await g.unmute(); return reply("🔓 Grup dibuka. Semua anggota bisa kirim pesan."); }

    if (cmd === "/tagall") {
      const res = await g.tagAll(arg || "Halo semua!");
      if (res && res.note) return reply(res.note);
      return "sent";
    }

    if (cmd === "/admin") {
      const list = await g.listAdmins();
      if (!list || !list.length) return reply("Tidak bisa membaca daftar admin grup ini.");
      return reply("ADMIN GRUP (" + list.length + ")\n" + list.map((a, i) => (i + 1) + ". " + a.name).join("\n"));
    }

    if (cmd === "/info") {
      const i = await g.info();
      return reply(
        "INFO GRUP\n" +
        "Nama: " + (i.title || "-") + "\n" +
        "ID: " + (i.id || chatId) + "\n" +
        "Anggota: " + (i.count || "?") + "\n" +
        "Admin: " + (i.admins || "?") +
        (i.description ? "\nDeskripsi: " + String(i.description).slice(0, 200) : "")
      );
    }

    if (cmd === "/setname") {
      if (!arg) return reply("Pakai: /setname Nama Grup Baru");
      await g.setTitle(arg.slice(0, 100));
      return reply("✅ Nama grup diubah.");
    }

    if (cmd === "/warn") {
      if (!target) return reply("Reply pesan orangnya, atau tulis /warn 62812xxxx.");
      if (target.userId === ctx.userId) return reply("Tidak bisa memperingati diri sendiri.");
      const mod = store.getMod(platform, chatId);
      const max = (mod && mod.max_warn) || 3;
      const count = store.bumpWarn(platform, chatId, target.userId);
      if (count >= max) {
        store.resetWarn(platform, chatId, target.userId);
        await g.kick(target.id);
        return reply("⛔ " + (target.name || "User") + " mencapai " + max + " peringatan — dikeluarkan dari grup.");
      }
      return reply("⚠️ " + (target.name || "User") + " diperingati (" + count + "/" + max + ").");
    }
  } catch (e) {
    const msg = String((e && e.message) || e);
    return reply("Gagal: " + msg.slice(0, 300) + "\nPastikan bot sudah jadi admin grup dengan izin yang cukup.");
  }
  return null;
}

module.exports = { handle };
