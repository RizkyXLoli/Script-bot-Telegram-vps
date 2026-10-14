"use strict";

const store = require("../db/store");

// /mod — khusus owner, dijalankan dari grup target (WA). Di TG grup hanya filter+warn (tanpa kick).
async function handle(ctx) {
  const { text, reply, platform, chatId } = ctx;
  const parts = text.trim().split(/\s+/);
  if ((parts[0] || "").toLowerCase() !== "/mod") return null;
  if (!ctx.isOwner) return reply("Khusus owner.");
  if (!chatId) return reply("Kirim perintah ini dari grup target.");
  const a = (parts[1] || "").toLowerCase();
  const rest = text.trim().split(/\s+/).slice(2).join(" ");
  const cur = store.getMod(platform, chatId);

  if (!a || a === "status") {
    const words = store.listModWords(platform, chatId);
    return reply(
      "MOD GRUP INI\n" +
      "Anti-badword: " + (cur.anti_badword ? "ON" : "OFF") + "\n" +
      "Batas peringatan: " + (cur.max_warn || 3) + "x lalu kick\n" +
      "Kata berbahaya (" + words.length + "): " + (words.join(", ") || "-") + "\n" +
      "Pesan peringatan: " + (cur.warn_msg || "(default)") + "\n" +
      "Welcome: " + (cur.welcome_on ? "ON" : "OFF") + "\n" +
      "Teks welcome: " + (cur.welcome_text || "(default)") + "\n" +
      "Gambar welcome: " + (cur.welcome_img || "-") + "\n\n" +
      "/mod on|off — aktif/matikan filter\n" +
      "1. /mod tambah <kata> — tambah kata berbahaya\n" +
      "2. /mod hapus <kata> — hapus satu kata\n" +
      "3. /mod list — daftar kata\n" +
      "4. /mod clear — hapus semua kata\n" +
      "5. /mod batas <angka> — batas peringatan sblm kick (default 3)\n" +
      "6. /mod pesan <teks> — pesan peringatan (pakai @nama, @hitung, @batas)\n" +
      "7. /mod unwarn @user — reset peringatan user\n" +
      "8. /mod welcome on|off\n" +
      "9. /mod setwelcome <teks> — teks sambutan (pakai @nama)\n" +
      "10. /mod setimg <link gambar> — gambar anime welcome"
    );
  }
  if (a === "on") { store.setMod(platform, chatId, { anti_badword: 1 }); return reply("Filter kata berbahaya AKTIF."); }
  if (a === "off") { store.setMod(platform, chatId, { anti_badword: 0 }); return reply("Filter kata berbahaya MATI."); }
  if (a === "tambah" && rest) { store.addModWord(platform, chatId, rest.split(/\s+/)[0]); return reply("Kata ditambah: " + rest.split(/\s+/)[0].toLowerCase()); }
  if (a === "hapus" && rest) {
    const n = store.delModWord(platform, chatId, rest.split(/\s+/)[0]);
    return reply(n ? "Kata dihapus." : "Kata tidak ketemu.");
  }
  if (a === "list") {
    const words = store.listModWords(platform, chatId);
    return reply(words.length ? "Kata berbahaya:\n" + words.map((w, i) => (i + 1) + ". " + w).join("\n") : "Belum ada kata berbahaya.");
  }
  if (a === "clear") { store.clearModWords(platform, chatId); return reply("Semua kata berbahaya dihapus."); }
  if (a === "batas" && rest) {
    const n = parseInt(rest, 10);
    if (!n || n < 1 || n > 10) return reply("Pakai: /mod batas <1-10>");
    store.setMod(platform, chatId, { max_warn: n });
    return reply("Batas peringatan: " + n + "x lalu kick.");
  }
  if (a === "pesan" && rest) { store.setMod(platform, chatId, { warn_msg: rest.slice(0, 500) }); return reply("Pesan peringatan disimpan."); }
  if (a === "unwarn") {
    const target = (ctx.mentions && ctx.mentions[0]) || rest.replace(/[^0-9]/g, "");
    if (!target) return reply("Pakai: /mod unwarn @user (reply pesan user juga bisa).");
    const uid = String(target).includes(":") ? String(target) : platform + ":" + target;
    store.resetWarn(platform, chatId, uid);
    return reply("Peringatan direset.");
  }
  if (a === "welcome" && (rest === "on" || rest === "off")) {
    store.setMod(platform, chatId, { welcome_on: rest === "on" ? 1 : 0 });
    return reply(rest === "on" ? "Welcome member baru AKTIF." : "Welcome MATI.");
  }
  if (a === "setwelcome" && rest) { store.setMod(platform, chatId, { welcome_text: rest.slice(0, 500) }); return reply("Teks welcome disimpan."); }
  if (a === "setimg" && rest) { store.setMod(platform, chatId, { welcome_img: rest.split(/\s+/)[0].slice(0, 500) }); return reply("Gambar welcome disimpan."); }
  return reply("Pakai /mod untuk daftar perintah.");
}

// Cek tiap pesan grup. Return {action:'warn'|'kick', ...} atau null.
// Eksekusi kick/ban dilakukan caller (core/wa.js, core/tg.js) karena butuh akses socket/bot.
function check(ctx) {
  const { platform, chatId, userId, text, isGroup, isOwner } = ctx;
  if (!isGroup || !chatId || isOwner) return null;
  let mod;
  try { mod = store.getMod(platform, chatId); } catch { return null; }
  if (!mod || !mod.anti_badword) return null;
  const words = store.listModWords(platform, chatId);
  if (!words.length) return null;
  const t = " " + String(text || "").toLowerCase() + " ";
  const hit = words.find((w) => t.includes(w.toLowerCase()));
  if (!hit) return null;
  const max = mod.max_warn || 3;
  const count = store.bumpWarn(platform, chatId, userId);
  const tpl = mod.warn_msg || "@nama jangan pakai kata berbahaya (@hitung/@batas). Peringatan @hitung dari @batas, lewat batas = kick!";
  const name = ctx.senderName || "kamu";
  const msg = tpl.split("@nama").join(name).split("@hitung").join(String(count)).split("@batas").join(String(max));
  if (count >= max) {
    store.resetWarn(platform, chatId, userId);
    return { action: "kick", hit, count, max, msg: msg + "\nBatas tercapai — kick!" };
  }
  return { action: "warn", hit, count, max, msg };
}

function welcomeText(mod, name) {
  const tpl = mod.welcome_text || "Selamat datang @nama di grup! Semoga betah.";
  return tpl.split("@nama").join(name || "kawan");
}

module.exports = { handle, check, welcomeText };
