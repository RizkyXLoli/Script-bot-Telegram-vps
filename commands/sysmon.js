"use strict";

// SysGuard — monitoring VPS untuk owner via chat bot.
// Ringan: hanya /proc + df, tanpa dependency baru, tanpa proses baru.
// Semua command owner-only (dicek via ctx.isOwner dari dispatcher).

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");

function sh(bin, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeout || 8000, maxBuffer: 64 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String((stderr || stdout || err.message || err)).slice(0, 500)));
      resolve(String(stdout || ""));
    });
  });
}

function readProcMem() {
  // /proc/meminfo: kB
  try {
    const t = fs.readFileSync("/proc/meminfo", "utf8");
    const g = (k) => {
      const m = t.match(new RegExp("^" + k + ":\\s+(\\d+)", "m"));
      return m ? Number(m[1]) : 0;
    };
    const total = g("MemTotal"), avail = g("MemAvailable"), free = g("MemFree");
    const swapT = g("SwapTotal"), swapF = g("SwapFree");
    return { total, avail, free, swapT, swapF };
  } catch { return null; }
}

function readLoad() {
  try {
    const t = fs.readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/);
    return t.slice(0, 3).join(" ");
  } catch { return "?"; }
}

function readUptime() {
  try {
    const s = Math.floor(Number(fs.readFileSync("/proc/uptime", "utf8").split(" ")[0]));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return [d ? d + " hari" : "", (d || h) ? h + " jam" : "", m + " mnt"].filter(Boolean).join(" ") || "0 mnt";
  } catch { return "?"; }
}

const fmtMB = (kb) => (kb / 1024).toFixed(0) + " MB";

async function sysinfo(reply) {
  const mem = readProcMem();
  let dfLine = "";
  try {
    const df = await sh("df", ["-h", "/"]);
    const row = df.trim().split("\n").slice(1).find((l) => l.trim());
    if (row) {
      const c = row.trim().split(/\s+/);
      // Filesystem Size Used Avail Use% Mounted
      dfLine = "Disk /: " + (c[1] || "?") + " total, " + (c[2] || "?") + " pakai (" + (c[4] || "?") + "), sisa " + (c[3] || "?");
    }
  } catch (e) { dfLine = "Disk: gagal baca (" + e.message.slice(0, 80) + ")"; }
  const cpuN = os.cpus().length;
  const memLine = mem
    ? "RAM: " + fmtMB(mem.total - mem.avail) + " / " + fmtMB(mem.total) + " pakai (" +
      Math.round(((mem.total - mem.avail) / Math.max(mem.total, 1)) * 100) + "%), sisa " + fmtMB(mem.avail) +
      "\nSwap: " + fmtMB(mem.swapT - mem.swapF) + " / " + fmtMB(mem.swapT) + " pakai"
    : "RAM: gagal baca /proc/meminfo";
  // Bot sendiri
  const pm = process.memoryUsage();
  return reply(
    "SYSGUARD VPS\n" +
    "Uptime: " + readUptime() + "\n" +
    "Load: " + readLoad() + " (CPU " + cpuN + " core)\n" +
    memLine + "\n" + dfLine + "\n" +
    "Bot: " + (pm.rss / 1048576).toFixed(0) + " MB RSS, Node " + process.version
  );
}

async function systop(reply, arg) {
  // Ringkas top-8 proses pemakan RAM. Argumen opsional: jumlah (maks 15).
  let n = parseInt(String(arg || "").trim(), 10);
  if (!n || n < 1) n = 8;
  if (n > 15) n = 15;
  let out;
  try {
    out = await sh("ps", ["-eo", "pid,comm,%mem,%cpu,etime", "--sort=-%mem"]);
  } catch (e) { return reply("Gagal baca proses: " + e.message.slice(0, 150)); }
  const rows = out.trim().split("\n").slice(1, 1 + n);
  const fmt = rows.map((l) => {
    const c = l.trim().split(/\s+/);
    return c[0] + " " + (c[1] || "?").slice(0, 18) + " " + (c[2] || "?") + "%M " + (c[3] || "?") + "%C " + (c[4] || "");
  });
  return reply("TOP " + n + " PROSES (RAM)\nPID CMD %MEM %CPU ELAPSED\n" + fmt.join("\n"));
}

async function syslog(reply, arg) {
  // Log bot 30 baris terakhir; argumen opsional: jumlah (maks 60) atau "err".
  const errOnly = /err/i.test(String(arg || ""));
  let n = parseInt(String(arg || "").trim(), 10);
  if (!n || n < 1) n = 30;
  if (n > 60) n = 60;
  let out;
  try {
    out = errOnly
      ? await sh("journalctl", ["-u", "elaina-bot.service", "-p", "err", "-n", String(n), "--no-pager"])
      : await sh("journalctl", ["-u", "elaina-bot.service", "-n", String(n), "--no-pager"]);
  } catch (e) { return reply("Gagal baca log: " + e.message.slice(0, 150)); }
  out = out.trim().slice(-3000) || "(log kosong)";
  return reply((errOnly ? "LOG BOT (ERROR, " + n + ")" : "LOG BOT (" + n + " baris)") + "\n" + out);
}

async function sysdisk(reply) {
  // 12 direktori terbesar di /root + /tmp.
  let root, tmp;
  try { root = await sh("bash", ["-c", "du -sh /root/* 2>/dev/null | sort -rh | head -12"]); } catch (e) { root = "gagal: " + e.message.slice(0, 100); }
  try { tmp = await sh("du", ["-sh", "/tmp"]); } catch (e) { tmp = "gagal: " + e.message.slice(0, 100); }
  const parse = (t) => t.trim().split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => {
      const m = l.match(/^([\d.]+[KMGT]?\s+\S+)/);
      return m ? m[1] : l.slice(0, 60);
    })
    .sort().slice(0, 12);
  return reply("DISK TERBESAR\n/root:\n" + parse(root).join("\n") + "\n/tmp: " + tmp.trim().split("\n")[0]);
}

async function handle(ctx) {
  const { text, reply, isOwner } = ctx;
  const parts = String(text || "").trim().split(/\s+/);
  const cmd = (parts[0] || "").toLowerCase();
  const arg = parts.slice(1).join(" ").trim();
  if (!["/sysinfo", "/sys", "/systop", "/top", "/syslog", "/logbot", "/sysdisk", "/disk"].includes(cmd)) return null;
  if (!isOwner) return reply("Khusus owner.");
  try {
    if (cmd === "/sysinfo" || cmd === "/sys") return await sysinfo(reply);
    if (cmd === "/systop" || cmd === "/top") return await systop(reply, arg);
    if (cmd === "/syslog" || cmd === "/logbot") return await syslog(reply, arg);
    if (cmd === "/sysdisk" || cmd === "/disk") return await sysdisk(reply);
  } catch (e) {
    return reply("SysGuard gagal: " + String(e.message || e).slice(0, 200));
  }
  return null;
}

module.exports = { handle };
