"use strict";
// Menu owner /auto: pesan otomatis jadwal sholat + libur nasional per chat (grup TG/WA).
//   /auto                      -> status chat ini
//   /auto sholat on|off        -> aktif/matikan pengingat tiap waktu sholat
//   /auto zona wib|wita|wit    -> pilih zona (kota: Jakarta/Makassar/Jayapura)
//   /auto libur on|off         -> aktif/matikan ucapan libur nasional (API hari-libur nasional)
// Zona->kota: wib=Jakarta, wita=Makassar, wit=Jayapura.
const store = require("../db/store");
const ZONES = { wib: "Jakarta", wita: "Makassar", wit: "Jayapura" };

async function handle(ctx) {
  const { text, reply, platform, chatId } = ctx;
  const parts = text.trim().split(/\s+/);
  if ((parts[0] || "").toLowerCase() !== "/auto") return null;
  if (!ctx.isOwner) return reply("Khusus owner.");
  if (!chatId) return reply("Kirim perintah ini dari grup/chat target.");
  const a = (parts[1] || "").toLowerCase();
  const b = (parts[2] || "").toLowerCase();
  const cur = store.getAuto(platform, chatId);

  if (!a || a === "status") {
    return reply(
      "AUTO PESAN GRUP INI\n" +
      "Sholat: " + (cur.sholat ? "ON (" + cur.zona.toUpperCase() + "/" + (ZONES[cur.zona] || "Jakarta") + ")" : "OFF") + "\n" +
      "Libur nasional: " + (cur.libur ? "ON" : "OFF") + "\n\n" +
      "/auto sholat on|off\n/auto zona wib|wita|wit\n/auto libur on|off"
    );
  }
  if (a === "sholat" && (b === "on" || b === "off")) {
    store.setAuto(platform, chatId, { sholat: b === "on" ? 1 : 0 });
    return reply(b === "on" ? "Pengingat sholat AKTIF untuk grup ini (" + cur.zona.toUpperCase() + ")." : "Pengingat sholat MATI untuk grup ini.");
  }
  if (a === "zona" && ZONES[b]) {
    store.setAuto(platform, chatId, { zona: b, last_sent: "" });
    return reply("Zona grup ini: " + b.toUpperCase() + " (" + ZONES[b] + ").");
  }
  if (a === "libur" && (b === "on" || b === "off")) {
    store.setAuto(platform, chatId, { libur: b === "on" ? 1 : 0 });
    return reply(b === "on" ? "Ucapan libur nasional AKTIF untuk grup ini." : "Ucapan libur nasional MATI untuk grup ini.");
  }
  return reply("Pakai:\n/auto\n/auto sholat on|off\n/auto zona wib|wita|wit\n/auto libur on|off");
}

module.exports = { handle, ZONES };
