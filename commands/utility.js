"use strict";

// Paket utilitas tambahan: /gempa /kurs /bmi /umur /quran /ip /libur

const dns = require("dns").promises;

async function get(u, timeout) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout || 15000);
  try {
    const r = await fetch(u, { signal: c.signal, headers: { "User-Agent": "Mozilla/5.0 (ElainaBot)" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

async function getJson(u, timeout) {
  const t = await get(u, timeout);
  try { return JSON.parse(t); } catch { throw new Error("respon bukan JSON"); }
}

function rupiah(n) {
  const v = Math.round(Number(n) || 0);
  return "Rp" + v.toLocaleString("id-ID");
}

function pad2(n) { return String(n).padStart(2, "0"); }

function todayWib() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

// ---------- gempa ----------
async function gempa(arg, reply, ctx) {
  const listMode = /^(list|terkini|semua|5|10)$/i.test(arg || "");
  if (listMode) {
    const j = await getJson("https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json");
    const arr = (j && j.Infogempa && j.Infogempa.gempa) || [];
    if (!arr.length) return reply("Data gempa terkini kosong dari BMKG.");
    const n = arg === "10" ? 10 : 5;
    const lines = arr.slice(0, n).map((g, i) =>
      (i + 1) + ". M" + g.Magnitude + " · " + g.Kedalaman + " · " + g.Wilayah + "\n    " + g.Tanggal + " " + g.Jam);
    return reply("GEMPA TERKINI (BMKG)\n\n" + lines.join("\n"));
  }
  const j = await getJson("https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json");
  const g = j && j.Infogempa && j.Infogempa.gempa;
  if (!g) return reply("Data gempa tidak tersedia dari BMKG.");
  const teks =
    "GEMPA TERKINI — BMKG\n" +
    g.Tanggal + " · " + g.Jam + "\n\n" +
    "Magnitudo: " + g.Magnitude + "\n" +
    "Kedalaman: " + g.Kedalaman + "\n" +
    "Koordinat: " + g.Lintang + " — " + g.Bujur + "\n" +
    "Wilayah: " + g.Wilayah + "\n" +
    (g.Dirasakan ? "Dirasakan: " + g.Dirasakan + "\n" : "") +
    "Potensi: " + g.Potensi;
  if (g.Shakemap && typeof ctx.replyFile === "function") {
    try {
      await ctx.replyFile("https://data.bmkg.go.id/DataMKG/TEWS/" + g.Shakemap, "Peta guncangan (BMKG)");
    } catch {}
  }
  return reply(teks);
}

// ---------- kurs ----------
const KURS_UMUM = ["USD", "SGD", "MYR", "EUR", "SAR", "JPY", "CNY", "GBP", "AUD", "THB", "KRW", "HKD", "TWD"];
async function kurs(arg, reply) {
  const j = await getJson("https://open.er-api.com/v6/latest/USD");
  if (!j || j.result !== "success" || !j.rates || !j.rates.IDR) throw new Error("sumber kurs tidak valid");
  const rates = j.rates;
  const idr = rates.IDR;
  const tokens = String(arg || "").toUpperCase().split(/\s+/).filter(Boolean);
  const code = tokens.find((t) => /^[A-Z]{3}$/.test(t));
  const amountTok = tokens.find((t) => /^\d+([.,]\d+)?$/.test(t));
  const amount = amountTok ? Number(amountTok.replace(",", ".")) : 1;

  if (code) {
    if (!rates[code]) return reply("Kode mata uang " + code + " tidak dikenal. Contoh: /kurs USD atau /kurs 100 SGD");
    const per = idr / rates[code];
    return reply(
      "KURS " + code + " → IDR\n" +
      "1 " + code + " = " + rupiah(per) + "\n" +
      amount + " " + code + " = " + rupiah(per * amount) + "\n\n" +
      "Update: " + (j.time_last_update_utc || "-") + "\nSumber: exchangerate-api"
    );
  }

  const lines = KURS_UMUM.filter((c) => rates[c]).map((c) => {
    const per = idr / rates[c];
    if (c === "JPY") return "1 " + c + " = " + rupiah(per) + "  (100 " + c + " = " + rupiah(per * 100) + ")";
    return "1 " + c + " = " + rupiah(per);
  });
  return reply(
    "KURS KE RUPIAH\n" +
    "1 USD = " + rupiah(idr) + "\n\n" +
    lines.join("\n") +
    "\n\nCek nominal lain: /kurs 100 SGD\nUpdate: " + (j.time_last_update_utc || "-")
  );
}

// ---------- bmi ----------
function bmi(arg, reply) {
  const nums = (String(arg || "").match(/\d+([.,]\d+)?/g) || []).map((s) => Number(s.replace(",", ".")));
  if (nums.length < 2) return reply("Pakai: /bmi tinggi_cm berat_kg\nContoh: /bmi 170 65");
  const cm = nums[0];
  const kg = nums[1];
  if (cm < 50 || cm > 260 || kg < 10 || kg > 400) return reply("Angka tidak masuk akal. Contoh: /bmi 170 65");
  const m = cm / 100;
  const bmi = kg / (m * m);
  let kategori;
  if (bmi < 18.5) kategori = "Kurang berat badan";
  else if (bmi < 25) kategori = "Normal / ideal";
  else if (bmi < 30) kategori = "Kelebihan berat badan";
  else kategori = "Obesitas";
  const minIdeal = 18.5 * m * m;
  const maxIdeal = 24.9 * m * m;
  return reply(
    "HASIL BMI\n" +
    "Tinggi: " + cm + " cm · Berat: " + kg + " kg\n" +
    "BMI: " + bmi.toFixed(1) + "\n" +
    "Kategori: " + kategori + "\n" +
    "Berat ideal: " + minIdeal.toFixed(1) + " - " + maxIdeal.toFixed(1) + " kg"
  );
}

// ---------- umur ----------
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function umur(arg, reply) {
  const t = String(arg || "").trim();
  let m = t.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = t.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return reply("Pakai: /umur 17-08-1995 (atau 1995-08-17)");
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return reply("Tanggal tidak valid.");
  const birth = new Date(Date.UTC(y, mo - 1, d));
  if (birth.getUTCDate() !== d || birth.getUTCMonth() !== mo - 1) return reply("Tanggal tidak valid (mis. 31 Februari).");
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (birth > today) return reply("Tanggal lahir di masa depan?");
  let yy = today.getUTCFullYear() - birth.getUTCFullYear();
  let mm = today.getUTCMonth() - birth.getUTCMonth();
  let dd = today.getUTCDate() - birth.getUTCDate();
  if (dd < 0) {
    mm--;
    dd += new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)).getUTCDate();
  }
  if (mm < 0) { yy--; mm += 12; }
  const totalHari = Math.floor((today - birth) / 86400000);
  return reply(
    "UMUR\n" +
    "Lahir: " + HARI[birth.getUTCDay()] + ", " + d + " " + BULAN[mo - 1] + " " + y + "\n" +
    "Umur: " + yy + " tahun " + mm + " bulan " + dd + " hari\n" +
    "Total: " + totalHari.toLocaleString("id-ID") + " hari"
  );
}

// ---------- quran ----------
const quranCache = new Map();
async function surahData(nomor) {
  const hit = quranCache.get(nomor);
  if (hit && Date.now() - hit.at < 3600000) return hit.data;
  const j = await getJson("https://equran.id/api/v2/surat/" + nomor, 20000);
  if (!j || j.code !== 200 || !j.data) throw new Error("surat tidak ditemukan");
  quranCache.set(nomor, { at: Date.now(), data: j.data });
  return j.data;
}

async function quran(arg, reply) {
  const t = String(arg || "").trim().toLowerCase();
  if (!t) return reply("Pakai: /quran 2:255 (surat:ayat), /quran 18, atau /quran acak");
  if (t === "acak" || t === "random") {
    const nomor = 1 + Math.floor(Math.random() * 114);
    const s = await surahData(nomor);
    const ayat = 1 + Math.floor(Math.random() * s.jumlahAyat);
    return quran(nomor + ":" + ayat, reply);
  }
  const m = t.match(/^(\d{1,3})(?:[:\s.,-]+(\d{1,3}))?$/);
  if (!m) return reply("Format: /quran 2:255");
  const nomor = Number(m[1]);
  if (nomor < 1 || nomor > 114) return reply("Nomor surat 1-114.");
  const s = await surahData(nomor);
  const head = "QS. " + s.namaLatin + " (" + s.nomor + ") · " + s.arti + "\n" + s.tempatTurun + " · " + s.jumlahAyat + " ayat";
  if (!m[2]) {
    const awal = s.ayat.slice(0, 3).map((a) =>
      "Ayat " + a.nomorAyat + "\n" + a.teksArab + "\n" + a.teksLatin + "\n" + a.teksIndonesia
    ).join("\n\n");
    return reply((head + "\n\n" + awal + "\n\nBuka satu ayat: /quran " + s.nomor + ":1").slice(0, 4000));
  }
  const no = Number(m[2]);
  const a = s.ayat.find((x) => x.nomorAyat === no);
  if (!a) return reply("Surat " + s.namaLatin + " hanya sampai ayat " + s.jumlahAyat + ".");
  return reply(
    (head + "\n\nAyat " + a.nomorAyat + "\n\n" + a.teksArab + "\n\n" + a.teksLatin + "\n\n" + a.teksIndonesia).slice(0, 4000)
  );
}

// ---------- ip / dns ----------
async function ip(arg, reply) {
  const host = String(arg || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!host) return reply("Pakai: /ip example.com atau /ip 8.8.8.8");
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const hasil = [];
  let ipv4 = isIp ? [host] : [];
  if (!isIp) {
    const [a, aaaa, mx, ns, txt] = await Promise.allSettled([
      dns.resolve4(host), dns.resolve6(host), dns.resolveMx(host), dns.resolveNs(host), dns.resolveTxt(host),
    ]);
    if (a.status === "fulfilled") ipv4 = a.value;
    if (a.status === "fulfilled" && a.value.length) hasil.push("A: " + a.value.join(", "));
    if (aaaa.status === "fulfilled" && aaaa.value.length) hasil.push("AAAA: " + aaaa.value.join(", "));
    if (mx.status === "fulfilled" && mx.value.length) {
      hasil.push("MX: " + mx.value.sort((x, y) => x.priority - y.priority).slice(0, 5).map((r) => r.priority + " " + r.exchange).join(", "));
    }
    if (ns.status === "fulfilled" && ns.value.length) hasil.push("NS: " + ns.value.slice(0, 5).join(", "));
    if (txt.status === "fulfilled" && txt.value.length) {
      const flat = txt.value.map((r) => r.join("")).filter((s) => s.length < 200);
      if (flat.length) hasil.push("TXT: " + flat.slice(0, 3).join(" | "));
    }
    if (!hasil.length) return reply("Tidak ada record DNS untuk " + host + " (domain tidak ada / DNS gagal).");
  }
  const target = ipv4[0];
  if (target) {
    try {
      const g = await getJson("https://ipwho.is/" + encodeURIComponent(target), 12000);
      if (g && g.success) {
        hasil.push("Lokasi " + target + ": " + [g.city, g.region, g.country].filter(Boolean).join(", ") +
          (g.connection && g.connection.isp ? " (" + g.connection.isp + ")" : ""));
      }
    } catch {}
  }
  return reply("DNS " + host + "\n\n" + hasil.join("\n"));
}

// ---------- libur nasional ----------
async function libur(arg, reply) {
  let date = String(arg || "").trim();
  if (!date) date = todayWib();
  else {
    let m = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) date = m[1] + "-" + pad2(+m[2]) + "-" + pad2(+m[3]);
    else if ((m = date.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/))) date = m[3] + "-" + pad2(+m[2]) + "-" + pad2(+m[1]);
    else return reply("Pakai: /libur atau /libur 2026-08-17 atau /libur 17-08-2026");
  }
  const j = await getJson("https://api.kemendesa.link/libur-nasional/api/is-holiday?date=" + date, 15000);
  if (!j || typeof j.is_holiday !== "boolean") throw new Error("sumber libur tidak valid");
  if (!j.is_holiday) {
    return reply("Tanggal " + date + " BUKAN hari libur nasional.\nCek tanggal lain: /libur 2026-12-25");
  }
  const d = j.data || {};
  const jenis = d.is_cuti_bersama ? "Cuti bersama" : (d.is_religious ? "Libur keagamaan" : "Libur nasional");
  return reply(
    "HARI LIBUR NASIONAL\n" +
    date + "\n" +
    (d.name || "Hari Libur") + "\n" +
    "Jenis: " + jenis +
    (j.metadata && j.metadata.source ? "\nSumber: " + j.metadata.source.name : "")
  );
}

async function handle(ctx) {
  const { text, reply } = ctx;
  const parts = String(text || "").trim().split(/\s+/);
  const cmd = (parts[0] || "").toLowerCase();
  const arg = parts.slice(1).join(" ").trim();
  try {
    if (cmd === "/gempa") return await gempa(arg, reply, ctx);
    if (cmd === "/kurs") return await kurs(arg, reply);
    if (cmd === "/bmi") return bmi(arg, reply);
    if (cmd === "/umur") return umur(arg, reply);
    if (cmd === "/quran") return await quran(arg, reply);
    if (cmd === "/ip") return await ip(arg, reply);
    if (cmd === "/libur") return await libur(arg, reply);
  } catch (e) {
    return reply("Gagal: " + String(e.message || e).slice(0, 200));
  }
  return null;
}

module.exports = { handle };
