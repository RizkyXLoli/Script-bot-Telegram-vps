"use strict";

// Smoke test tanpa jaringan Telegram/WhatsApp: panggil handler dengan ctx palsu.
// Jalankan: node test/smoke.js

const path = require("path");
const fs = require("fs");

process.env.DB_PATH = path.join(__dirname, "smoke.sqlite3");
try { fs.unlinkSync(process.env.DB_PATH); } catch {}

const store = require("../db/store");
const reminder = require("../commands/reminder");
const utility = require("../commands/utility");

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  OK   " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? "\n       " + detail : "")); }
}
function eq(name, got, want) { ok(name + " = " + JSON.stringify(want), got === want, "dapat: " + JSON.stringify(got)); }

function fakeCtx(text, extra) {
  const out = [];
  const ctx = {
    userId: "tg:111", platform: "tg", chatId: "111", senderName: "Tester", text,
    reply: async (t) => { out.push(typeof t === "string" ? t : JSON.stringify(t)); return "sent"; },
    replyFile: async (fp, cap) => { out.push("[FILE] " + fp + " | " + (cap || "")); return "sent"; },
    ...(extra || {}),
  };
  return { ctx, out };
}

async function run(text, extra) {
  const { ctx, out } = fakeCtx(text, extra);
  const r = await reminder.handle(ctx) ?? await utility.handle(ctx);
  return { r, out };
}

const WIB = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) - 7 * 3600000;

async function main() {
  console.log("\n[1] parseWhen");
  const now = WIB(2026, 10, 17, 12, 0); // 17 Okt 2026 12:00 WIB
  let p = reminder.parseWhen("10m beli makan", now);
  eq("10m dueAt", p.dueAt, now + 600000);
  eq("10m rest", p.rest, "beli makan");

  p = reminder.parseWhen("2 jam olahraga", now);
  eq("2 jam dueAt", p.dueAt, now + 7200000);
  eq("2 jam rest", p.rest, "olahraga");

  p = reminder.parseWhen("3 hari cek vps", now);
  eq("3 hari dueAt", p.dueAt, now + 3 * 86400000);

  p = reminder.parseWhen("besok 08:00 rapat", now);
  eq("besok 08:00", p.dueAt, WIB(2026, 10, 18, 8, 0));
  eq("besok rest", p.rest, "rapat");

  p = reminder.parseWhen("20:30 nonton", now);
  eq("20:30 hari ini", p.dueAt, WIB(2026, 10, 17, 20, 30));

  p = reminder.parseWhen("08:00 pagi", now);
  eq("08:00 sudah lewat -> besok", p.dueAt, WIB(2026, 10, 18, 8, 0));

  p = reminder.parseWhen("17/10 20:00 x", now);
  eq("17/10 20:00", p.dueAt, WIB(2026, 10, 17, 20, 0));

  p = reminder.parseWhen("17-08-2027 09:15 ulang tahun", now);
  eq("17-08-2027 09:15", p.dueAt, WIB(2027, 8, 17, 9, 15));

  p = reminder.parseWhen("besok sore", now);
  ok("format tak dikenal ditolak", !!p.error, JSON.stringify(p));

  console.log("\n[2] handler /ingatkan");
  let r = await run("/ingatkan 10m minum obat");
  ok("buat pengingat", /Pengingat #\d+ disimpan/.test(r.out[0] || ""), r.out[0]);
  ok("sebut WIB", /WIB/.test(r.out[0] || ""));

  r = await run("/ingatkan 5m");
  ok("tolak tanpa isi", /Isi pengingatnya belum ada/.test(r.out[0] || ""), r.out[0]);

  r = await run("/ingatkan 0m kosong");
  ok("tolak waktu lewat", /sudah lewat/.test(r.out[0] || ""), r.out[0]);

  r = await run("/ingat list");
  ok("list tampil 1", /PENGINGAT AKTIF \(1\)/.test(r.out[0] || ""), r.out[0]);

  r = await run("/ingat hapus 1");
  ok("hapus #1", /Pengingat #1 dihapus/.test(r.out[0] || ""), r.out[0]);

  r = await run("/ingat hapus 99");
  ok("hapus id asing", /tidak ditemukan/.test(r.out[0] || ""), r.out[0]);

  r = await run("/ingatkan 1j cek");
  r = await run("/ingat clear");
  ok("clear semua", /1 pengingat dihapus/.test(r.out[0] || ""), r.out[0]);

  const due = store.addReminder("tg:111", "tg", "111", "tes scheduler", Date.now() - 1000, "Tester");
  ok("dueReminders mengambil yang jatuh tempo", store.dueReminders().some((x) => x.id === due.id));
  store.deleteReminderAny(due.id);

  console.log("\n[3] /bmi /umur");
  r = await run("/bmi 170 65");
  ok("bmi normal", /BMI: 22\.5/.test(r.out[0] || "") && /Normal/.test(r.out[0] || ""), r.out[0]);
  r = await run("/umur 17-08-1995");
  ok("umur terhitung", /Umur: \d+ tahun \d+ bulan \d+ hari/.test(r.out[0] || ""), r.out[0]);

  console.log("\n[4] API live");
  r = await run("/gempa");
  ok("gempa BMKG", /GEMPA TERKINI/.test(r.out.join("\n")), r.out.join("\n"));
  r = await run("/gempa list");
  ok("gempa list", /GEMPA TERKINI \(BMKG\)/.test(r.out[0] || ""), r.out[0]);
  r = await run("/kurs");
  ok("kurs tabel", /1 USD = Rp/.test(r.out[0] || ""), r.out[0]);
  r = await run("/kurs 100 SGD");
  ok("kurs nominal", /100 SGD = Rp/.test(r.out[0] || ""), r.out[0]);
  r = await run("/quran 2:255");
  ok("quran ayat", /QS\. Al-Baqarah \(2\)/.test(r.out[0] || "") && /Ayat 255/.test(r.out[0] || ""), r.out[0]);
  r = await run("/quran 18");
  ok("quran surat", /QS\. Al-Kahf/.test(r.out[0] || ""), r.out[0]);
  r = await run("/ip example.com");
  ok("dns example.com", /DNS example\.com/.test(r.out[0] || "") && /A: /.test(r.out[0] || ""), r.out[0]);
  r = await run("/libur 2026-08-17");
  ok("libur proklamasi", /Proklamasi/.test(r.out[0] || ""), r.out[0]);
  r = await run("/libur 2026-10-20");
  ok("bukan libur", /BUKAN hari libur/.test(r.out[0] || ""), r.out[0]);

  const tools = require("../commands/tools");
  let t = fakeCtx("/qr https://example.com");
  await tools.handle(t.ctx);
  ok("qr kirim gambar", t.out.some((l) => /^\[FILE\] .*qr-\d+\.png/.test(l)), t.out.join("\n"));
  t = fakeCtx("/cuaca Jakarta 3");
  await tools.handle(t.ctx);
  ok("cuaca 3 hari", /PRAKIRAAN .*\(3 hari\)/.test(t.out[0] || ""), t.out[0]);

  console.log("\n[5] admin grup");
  const admin = require("../commands/admin");
  function adminCtx(text, extra) {
    const out = [], calls = [];
    const ctx = {
      userId: "tg:1", platform: "tg", chatId: "-100", isGroup: true, text,
      senderName: "Owner", isOwner: true,
      reply: async (t) => { out.push(t); return "sent"; },
      targetUser: { userId: "tg:2", id: "2", name: "Budi" },
      groupAdmin: {
        kick: async (id) => calls.push("kick:" + id),
        promote: async (id) => calls.push("promote:" + id),
        demote: async (id) => calls.push("demote:" + id),
        mute: async () => calls.push("mute"),
        unmute: async () => calls.push("unmute"),
        tagAll: async (t) => { calls.push("tagall:" + t); return {}; },
        listAdmins: async () => [{ name: "Owner", id: "1" }],
        info: async () => ({ title: "Grup Tes", id: "-100", count: 5, admins: 1 }),
        setTitle: async (n) => calls.push("title:" + n),
      },
      ...(extra || {}),
    };
    return { ctx, out, calls };
  }

  let a = adminCtx("/kick");
  await admin.handle(a.ctx);
  ok("/kick menendang target", a.calls.includes("kick:2") && /dikeluarkan/.test(a.out[0] || ""), JSON.stringify(a));

  a = adminCtx("/promote");
  await admin.handle(a.ctx);
  ok("/promote", a.calls.includes("promote:2"), JSON.stringify(a.calls));

  a = adminCtx("/demote");
  await admin.handle(a.ctx);
  ok("/demote", a.calls.includes("demote:2"));

  a = adminCtx("/tutup");
  await admin.handle(a.ctx);
  ok("/tutup -> mute", a.calls.includes("mute"));

  a = adminCtx("/buka");
  await admin.handle(a.ctx);
  ok("/buka -> unmute", a.calls.includes("unmute"));

  a = adminCtx("/tagall rapat jam 8");
  await admin.handle(a.ctx);
  ok("/tagall", a.calls.includes("tagall:rapat jam 8"));

  a = adminCtx("/info");
  await admin.handle(a.ctx);
  ok("/info grup", /Grup Tes/.test(a.out[0] || "") && /Anggota: 5/.test(a.out[0] || ""), a.out[0]);

  a = adminCtx("/setname Grup Baru");
  await admin.handle(a.ctx);
  ok("/setname", a.calls.includes("title:Grup Baru"));

  a = adminCtx("/warn");
  await admin.handle(a.ctx);
  ok("/warn 1/3", /1\/3/.test(a.out[0] || ""), a.out[0]);
  await admin.handle(adminCtx("/warn").ctx);
  a = adminCtx("/warn");
  await admin.handle(a.ctx);
  ok("/warn 3x -> kick", a.calls.includes("kick:2") && /dikeluarkan/.test(a.out[0] || ""), a.out[0]);

  a = adminCtx("/kick", { isOwner: false, checkAdmin: async () => false });
  await admin.handle(a.ctx);
  ok("non-admin ditolak", /Khusus owner atau admin/.test(a.out[0] || ""), a.out[0]);

  a = adminCtx("/kick", { isOwner: false, checkAdmin: async () => true });
  await admin.handle(a.ctx);
  ok("admin grup boleh", a.calls.includes("kick:2"), JSON.stringify(a.calls));

  a = adminCtx("/kick", { isGroup: false });
  await admin.handle(a.ctx);
  ok("perintah grup ditolak di private", /hanya bisa dipakai di dalam grup/.test(a.out[0] || ""), a.out[0]);

  console.log("\n[6] owner");
  const owner = require("../commands/owner");
  const ownerCtx = (text, extra) => {
    const out = [], docs = [];
    return {
      out, docs,
      ctx: {
        userId: "tg:1", platform: "tg", chatId: "1", isGroup: false, text, isOwner: true,
        reply: async (t) => { out.push(t); return "sent"; },
        sendDoc: async (fp, cap) => { docs.push([fp, cap]); return "sent"; },
        ...(extra || {}),
      },
    };
  };
  let o = ownerCtx("/stats");
  await owner.handle(o.ctx);
  ok("/stats", /STATISTIK BOT/.test(o.out[0] || "") && /Uptime:/.test(o.out[0] || ""), o.out[0]);
  o = ownerCtx("/chats");
  await owner.handle(o.ctx);
  ok("/chats", /CHAT TERDAFTAR|Belum ada chat/.test(o.out[0] || ""), o.out[0]);
  o = ownerCtx("/broadcast");
  await owner.handle(o.ctx);
  ok("/broadcast tanpa teks = info", /Broadcast ke \d+ chat/.test(o.out[0] || ""), o.out[0]);
  o = ownerCtx("/stats", { isOwner: false });
  await owner.handle(o.ctx);
  ok("/stats non-owner ditolak", /Khusus owner/.test(o.out[0] || ""), o.out[0]);
  o = ownerCtx("/backup");
  await owner.handle(o.ctx);
  ok("/backup kirim dokumen", o.docs.length === 1 && /smoke\.sqlite3$/.test(o.docs[0][0]), JSON.stringify(o.docs));

  console.log("\n[7] moderasi antilink");
  const mod = require("../commands/mod");
  store.setMod("tg", "-100", { antilink: 1, anti_badword: 0 });
  let hit = mod.check({ platform: "tg", chatId: "-100", userId: "tg:3", text: "cek https://contoh.com", isGroup: true, isOwner: false });
  ok("antilink mendeteksi link", !!hit && hit.hit === "link" && hit.deleteMsg === true, JSON.stringify(hit));
  hit = mod.check({ platform: "tg", chatId: "-100", userId: "tg:3", text: "/dl https://youtu.be/x", isGroup: true, isOwner: false });
  ok("perintah berlink tidak dihapus", hit === null, JSON.stringify(hit));
  hit = mod.check({ platform: "tg", chatId: "-100", userId: "tg:3", text: "mampir ke tokoku.com ya", isGroup: true, isOwner: false });
  ok("domain tanpa http terdeteksi", !!hit && hit.hit === "link", JSON.stringify(hit));
  hit = mod.check({ platform: "tg", chatId: "-100", userId: "tg:3", text: "halo semua", isGroup: true, isOwner: false });
  ok("teks biasa lolos", hit === null);
  store.setMod("tg", "-100", { antilink: 0 });

  console.log("\nHasil: " + pass + " OK, " + fail + " FAIL");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
