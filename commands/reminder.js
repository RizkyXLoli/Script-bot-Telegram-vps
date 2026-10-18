"use strict";

// Pengingat pribadi: /ingatkan 10m minum obat, /ingat list, /ingat hapus 3
// Waktu absolut selalu ditafsirkan sebagai WIB (Asia/Jakarta).

const store = require("../db/store");

const WIB_OFFSET_MIN = 7 * 60;
const MAX_TEXT = 300;
const MAX_PER_USER = 50;
const MAX_AHEAD_MS = 400 * 86400000;

function pad(n) { return String(n).padStart(2, "0"); }

function fmtWib(ts) {
  return new Date(ts).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta", weekday: "short", day: "numeric",
    month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }) + " WIB";
}

function wibParts(now) {
  const d = new Date(new Date(now).toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  return { y: d.getFullYear(), mo: d.getMonth() + 1, day: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
}

function wibToEpoch(y, mo, day, h, mi) {
  return Date.UTC(y, mo - 1, day, h, mi) - WIB_OFFSET_MIN * 60000;
}

function humanLeft(ms) {
  const total = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  const out = [];
  if (d) out.push(d + " hari");
  if (h) out.push(h + " jam");
  if (m || !out.length) out.push(m + " menit");
  return out.join(" ");
}

// Mengembalikan { dueAt, rest } atau { error }.
function parseWhen(raw, now) {
  const t = String(raw || "").trim();
  if (!t) return { error: "Waktu belum diisi. Contoh: /ingatkan 10m minum obat" };
  const n = now || Date.now();
  let m;
  const relative = (ms) => {
    const rest = t.slice(m[0].length).replace(/^[\s,:-]+/, "").trim();
    return { dueAt: n + ms, rest };
  };

  if ((m = t.match(/^(\d{1,4})\s*(menit|mnt|min|m)\b/i))) return relative(Number(m[1]) * 60000);
  if ((m = t.match(/^(\d{1,3})\s*(jam|j|h|hour)\b/i))) return relative(Number(m[1]) * 3600000);
  if ((m = t.match(/^(\d{1,3})\s*(hari|hr|d|day)\b/i))) return relative(Number(m[1]) * 86400000);

  const p = wibParts(n);
  const atTime = (dayOffset, h, mi) => {
    const due = wibToEpoch(p.y, p.mo, p.day + dayOffset, h, mi);
    return due;
  };

  if ((m = t.match(/^besok\s+(\d{1,2})[:.](\d{2})\b/i))) {
    return { dueAt: atTime(1, Number(m[1]), Number(m[2])), rest: t.slice(m[0].length).replace(/^[\s,:-]+/, "").trim() };
  }
  if ((m = t.match(/^lusa\s+(\d{1,2})[:.](\d{2})\b/i))) {
    return { dueAt: atTime(2, Number(m[1]), Number(m[2])), rest: t.slice(m[0].length).replace(/^[\s,:-]+/, "").trim() };
  }
  if ((m = t.match(/^hari\s+ini\s+(\d{1,2})[:.](\d{2})\b/i))) {
    return { dueAt: atTime(0, Number(m[1]), Number(m[2])), rest: t.slice(m[0].length).replace(/^[\s,:-]+/, "").trim() };
  }
  if ((m = t.match(/^(\d{1,2})[:.](\d{2})\b/))) {
    let due = atTime(0, Number(m[1]), Number(m[2]));
    if (due <= n) due = atTime(1, Number(m[1]), Number(m[2]));
    return { dueAt: due, rest: t.slice(m[0].length).replace(/^[\s,:-]+/, "").trim() };
  }
  if ((m = t.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?\s+(\d{1,2})[:.](\d{2})\b/))) {
    const day = Number(m[1]);
    const mo = Number(m[2]);
    const y = m[3] ? Number(m[3]) : p.y;
    const h = Number(m[4]);
    const mi = Number(m[5]);
    if (mo < 1 || mo > 12 || day < 1 || day > 31 || h > 23 || mi > 59) {
      return { error: "Tanggal/jam tidak valid." };
    }
    return { dueAt: wibToEpoch(y, mo, day, h, mi), rest: t.slice(m[0].length).replace(/^[\s,:-]+/, "").trim() };
  }
  return { error: "Format waktu tidak dikenal. Contoh: 10m, 2j, besok 08:00, 20:30, 17/10 20:00" };
}

function listText(userId) {
  const rows = store.listReminders(userId);
  if (!rows.length) return "Belum ada pengingat aktif.\n\nContoh: /ingatkan 10m minum obat";
  const now = Date.now();
  const lines = rows.map((r) => {
    const left = r.due_at > now ? " (" + humanLeft(r.due_at - now) + " lagi)" : " (terlambat)";
    return "#" + r.id + "  " + fmtWib(r.due_at) + left + "\n     " + String(r.text).slice(0, 120);
  });
  return "PENGINGAT AKTIF (" + rows.length + ")\n\n" + lines.join("\n") +
    "\n\nHapus: /ingat hapus <nomor>";
}

async function handle(ctx) {
  const { text, reply, userId, platform, chatId, senderName } = ctx;
  const parts = String(text || "").trim().split(/\s+/);
  const cmd = (parts[0] || "").toLowerCase();
  if (!["/ingatkan", "/ingat", "/remind", "/pengingat"].includes(cmd)) return null;
  if (!chatId) return reply("Pengingat butuh chat tujuan. Kirim perintah ini dari chat pribadi atau grup.");

  const arg = parts.slice(1).join(" ").trim();
  const sub = arg.toLowerCase();

  if (!arg || sub === "list" || sub === "daftar") {
    return reply(listText(userId));
  }

  if (sub === "clear" || sub === "hapus semua" || sub === "reset") {
    const n = store.clearReminders(userId);
    return reply(n ? n + " pengingat dihapus." : "Tidak ada pengingat untuk dihapus.");
  }

  if (/^(hapus|batal|delete)\b/i.test(arg)) {
    const id = (arg.match(/(\d+)/) || [])[1];
    if (!id) return reply("Pakai: /ingat hapus <nomor>  (lihat nomor di /ingat list)");
    const n = store.deleteReminder(Number(id), userId);
    return reply(n ? "Pengingat #" + id + " dihapus." : "Pengingat #" + id + " tidak ditemukan.");
  }

  const when = parseWhen(arg, Date.now());
  if (when.error) return reply(when.error);
  if (!when.rest) return reply("Isi pengingatnya belum ada. Contoh: /ingatkan 10m minum obat");
  if (when.rest.length > MAX_TEXT) return reply("Teks pengingat kepanjangan (maks " + MAX_TEXT + " karakter).");

  const now = Date.now();
  if (when.dueAt <= now + 5000) return reply("Waktunya sudah lewat. Pakai waktu yang akan datang, contoh: 10m atau 20:30.");
  if (when.dueAt > now + MAX_AHEAD_MS) return reply("Maksimal 400 hari ke depan.");

  let existing = [];
  try { existing = store.listReminders(userId); } catch {}
  if (existing.length >= MAX_PER_USER) return reply("Pengingatmu sudah " + MAX_PER_USER + ". Hapus beberapa dulu dengan /ingat hapus <nomor>.");

  const saved = store.addReminder(userId, platform, String(chatId), when.rest, when.dueAt, senderName || "");
  return reply(
    "Pengingat #" + saved.id + " disimpan.\n" +
    "Waktu: " + fmtWib(saved.dueAt) + " (" + humanLeft(saved.dueAt - now) + " lagi)\n" +
    "Isi: " + when.rest + "\n\n" +
    "Lihat: /ingat list   Batal: /ingat hapus " + saved.id
  );
}

module.exports = { handle, parseWhen, fmtWib, humanLeft };
