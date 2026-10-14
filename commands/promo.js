"use strict";

const store = require("../db/store");

function fmtNext(ts) {
  const d = new Date(ts);
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

async function handle(ctx) {
  const { text, reply, platform, chatId, userId } = ctx;
  const cmd = text.trim().split(/\s+/)[0].toLowerCase();
  if (cmd !== "/promo") return null;
  if (!ctx.isOwner) return reply("Khusus owner.");

  const rest = text.replace(/^\/promo\s*/i, "").trim();
  const sub = (rest.split(/\s+/)[0] || "").toLowerCase();

  if (sub === "list" || sub === "") {
    const rows = store.listSchedules();
    if (!rows.length) return reply("Belum ada promo terjadwal.\nContoh: /promo 60 Halo guys, promo hari ini!");
    const lines = rows.map((r) => `#${r.id} tiap ${r.interval_min} mnt -> [${r.platform}] ${r.chat_id}\n"${r.text.slice(0, 80)}"\nberikutnya: ${fmtNext(r.next_run)}`);
    return reply(lines.join("\n\n").slice(0, 3500));
  }
  if (sub === "hapus" || sub === "del") {
    const id = parseInt(rest.split(/\s+/)[1], 10);
    if (!id) return reply("Contoh: /promo hapus 2");
    return reply(store.deleteSchedule(id) ? "Jadwal #" + id + " dihapus." : "Jadwal #" + id + " tidak ketemu.");
  }
  if (sub === "clear") {
    const n = store.clearSchedules();
    return reply(n + " jadwal promo dihapus semua.");
  }
  const m = rest.match(/^(\d+)\s+([\s\S]+)/);
  if (!m) return reply("Contoh: /promo 60 Halo guys, jangan lupa mampir!\n(promo dikirim tiap 60 menit ke chat ini)");
  const mins = parseInt(m[1], 10);
  if (mins < 1 || mins > 10080) return reply("Interval 1-10080 menit (max 7 hari).");
  if (!chatId) return reply("Chat ini tidak dikenali, coba kirim perintah dari chat/grup target.");
  if (m[2].length > 3000) return reply("Teks kepanjangan (max 3000 karakter).");
  const s = store.addSchedule(platform, chatId, mins, m[2], userId);
  return reply(`Promo #${s.id} aktif: tiap ${mins} menit ke chat ini.\nBerikutnya: ${fmtNext(s.nextRun)}\nLihat: /promo list`);
}

module.exports = { handle };