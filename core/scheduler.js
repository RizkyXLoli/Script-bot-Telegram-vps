"use strict";

const store = require("../db/store");
const { ZONES } = require("../commands/auto");

let tgBot = null;
let waSock = null;

function registerTG(bot) { tgBot = bot; }
function registerWA(sock) { waSock = sock; }

async function sender(platform, chatId, text) {
  if (platform === "tg" && tgBot) await tgBot.api.sendMessage(chatId, text.slice(0, 4000));
  else if (platform === "wa" && waSock) await waSock.sendMessage(chatId, { text: text.slice(0, 4000) });
  else throw new Error("platform offline");
}

async function get(u, timeout) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), timeout || 15000);
  try { const r = await fetch(u, { signal: c.signal, headers: { "User-Agent": "Mozilla/5.0" } }); return await r.text(); }
  finally { clearTimeout(t); }
}

function nowIn(tz) {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const p = (n) => String(n).padStart(2, "0");
  return {
    date: d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()),
    hm: p(d.getHours()) + ":" + p(d.getMinutes()),
  };
}
const TZ = { wib: "Asia/Jakarta", wita: "Asia/Makassar", wit: "Asia/Jayapura" };
const DOA = {
  Subuh: "Selamat menunaikan sholat Subuh.",
  Dzuhur: "Selamat menunaikan sholat Dzuhur.",
  Ashar: "Selamat menunaikan sholat Ashar.",
  Maghrib: "Selamat menunaikan sholat Maghrib.",
  Isya: "Selamat menunaikan sholat Isya.",
};

async function sendAuto() {
  let chats = [];
  try { chats = store.listAuto(); } catch { return; }
  for (const c of chats) {
    const zona = (c.zona || "wib").toLowerCase();
    const tz = TZ[zona] || TZ.wib;
    const now = nowIn(tz);
    
    if (c.sholat) {
      try {
        const kota = ZONES[zona] || "Jakarta";
        const j = JSON.parse(await get("https://api.aladhan.com/v1/timingsByCity/" + now.date +
          "?city=" + encodeURIComponent(kota) + "&country=Indonesia&method=20"));
        const t = (j && j.data && j.data.timings) || {};
        const JAM = { Subuh: t.Fajr, Dzuhur: t.Dhuhr, Ashar: t.Asr, Maghrib: t.Maghrib, Isya: t.Isha };
        for (const k of ["Subuh", "Dzuhur", "Ashar", "Maghrib", "Isya"]) {
          const jam = String(JAM[k] || "").slice(0, 5);
          if (!jam || now.hm < jam) continue;
          const mark = now.date + " " + k;
          if ((c.last_sent || "") === mark) continue;
          await sender(c.platform, c.chat_id,
            "Waktunya sholat " + k + " (" + jam + ", " + kota + ").\n" + (DOA[k] || ""));
          store.setAuto(c.platform, c.chat_id, { last_sent: mark });
          c.last_sent = mark;
          break;
        }
      } catch (e) { console.error("[auto-sholat] " + e.message); }
    }
    
    if (c.libur && c.libur_date !== now.date) {
      try {
        const hj = JSON.parse(await get("https://api.kemendesa.link/libur-nasional/api/is-holiday?date=" + now.date));
        const hit = hj && hj.is_holiday === true;
        const nama = (hj && hj.data && hj.data.name) || "Hari Libur Nasional";
        const cuti = hj && hj.data && hj.data.is_cuti_bersama;
        if (hit) {
          const label = cuti ? "cuti bersama" : "libur nasional";
          await sender(c.platform, c.chat_id,
            "Hari ini " + label + ": " + nama + " (" + now.date + ").\nSelamat menikmati hari libur bersama keluarga!");
          store.setAuto(c.platform, c.chat_id, { libur_date: now.date });
        } else {
          store.setAuto(c.platform, c.chat_id, { libur_date: now.date });
        }
      } catch (e) { console.error("[auto-libur] " + e.message); }
    }
  }
}

async function sendDue() {
  let due = [];
  try { due = store.dueSchedules(); } catch (e) { return; }
  for (const s of due) {
    try {
      if (s.platform === "tg" && tgBot) {
        await tgBot.api.sendMessage(s.chat_id, s.text.slice(0, 4000));
      } else if (s.platform === "wa" && waSock) {
        await waSock.sendMessage(s.chat_id, { text: s.text.slice(0, 4000) });
      } else {
        continue; 
      }
      store.bumpSchedule(s.id, s.interval_min);
    } catch (e) {
      console.error("[promo] gagal kirim #" + s.id + ": " + e.message);
    }
  }
}

function start() {
  setInterval(sendDue, 30 * 1000);
  setTimeout(sendDue, 10 * 1000);
  setInterval(sendAuto, 60 * 1000);
  setTimeout(sendAuto, 20 * 1000);
}

module.exports = { registerTG, registerWA, start };