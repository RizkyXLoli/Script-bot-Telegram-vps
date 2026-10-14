"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const pino = require("pino");
const log = pino({ level: process.env.LOG_LEVEL || "info" });

async function startWA(onMessage, onFile, opts) {
  if (process.env.WA_ENABLED !== "1") {
    log.info("WA_ENABLED bukan 1 — WhatsApp nonaktif.");
    return null;
  }
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
  const sessDir = process.env.WA_SESSION_DIR || path.join(__dirname, "..", "db", "wa-session");
  fs.mkdirSync(sessDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(sessDir);
  let version = undefined;
  try { version = (await fetchLatestBaileysVersion()).version; } catch {}
  const loginMode = (process.env.WA_LOGIN || "qr").toLowerCase();
  const pairNumber = (process.env.WA_PAIR_NUMBER || "").replace(/[^0-9]/g, "");

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "warn" }),
    browser: ["Elaina Bot", "Chrome", "120"],
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  sock.ev.on("creds.update", saveCreds);

  let paired = false;
  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr && loginMode === "qr") {
      
      try {
        const qt = require("qrcode-terminal");
        qt.generate(qr, { small: false });
      } catch { try { require("qrcode-terminal").generate(qr, { small: true }); } catch {} }
      console.log("\n===== SCAN QR WHATSAPP DI ATAS =====\nWA > Perangkat Tertaut > Tautkan perangkat\n");
      
      try {
        const qrcode = require("qrcode");
        const png = path.join(sessDir, "wa-qr.png");
        await qrcode.toFile(png, qr, { width: 600 });
        log.warn("WA QR tersimpan: " + png);
        const tgBot = (opts && opts.tgBot) || null;
        const ownerChat = (opts && opts.ownerChatId) || "";
        if (tgBot && ownerChat) {
          try {
            const { InputFile } = require("grammy");
            await tgBot.api.sendPhoto(ownerChat, new InputFile(png),
              { caption: "Scan QR ini dari WhatsApp > Perangkat Tertaut > Tautkan perangkat." });
          } catch (e) { log.warn("kirim QR ke TG gagal: " + e.message); }
        }
      } catch {}
    }
    if (connection === "connecting" && loginMode === "pair" && pairNumber && !paired && !state.creds.registered) {
      try {
        await new Promise((r) => setTimeout(r, 3000));
        const code = await sock.requestPairingCode(pairNumber);
        paired = true;
        log.warn("WA PAIRING CODE untuk " + pairNumber + ": " + code + " — masukkan di WhatsApp > Perangkat Tertaut > Tautkan dengan nomor telepon.");
      } catch (e) { log.error("Pairing gagal: " + e.message); }
    }
    if (connection === "open") log.info("WhatsApp terhubung.");
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      log.warn("WA putus (kode " + code + "), reconnect...");
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(() => startWA(onMessage, onFile).catch((e) => log.error("WA restart: " + e.message)), 5000);
      } else {
        log.error("WA logout — hapus isi " + sessDir + " lalu restart untuk login ulang.");
      }
    }
  });

  const replyFor = (jid, sender, senderName, msgKey) => async (t) => {
    let s = t;
    if (typeof t === "object" && t !== null) {
      s = t.text || "";
      if (t.buttons) {
        const flat = t.buttons.flat();
        s += "\n\nBalas dengan angka:\n" + flat.map((b, i) => `${i + 1}. ${b.text}`).join("\n");
      }
      s = String(s);
    } else s = String(t);
    s = s.slice(0, 4000);
    const isGroup = jid.endsWith("@g.us");
    if (isGroup && sender) {
      await sock.sendMessage(jid, { text: "@" + sender.replace(/@.*$/, "").split(":").pop() + " " + s, mentions: [sender] }, { quoted: msgKey ? { key: msgKey, message: { conversation: "." } } : undefined });
    } else {
      await sock.sendMessage(jid, { text: s });
    }
  };
  const replyFileFor = (jid) => async (fp, cap) => {
    if (fp.endsWith(".mp3")) await sock.sendMessage(jid, { audio: { url: fp }, mimetype: "audio/mpeg", fileName: path.basename(fp) });
    else if (/\.(jpg|jpeg|png|webp)$/i.test(fp)) await sock.sendMessage(jid, { image: { url: fp }, caption: (cap || "").slice(0, 1000) });
    else await sock.sendMessage(jid, { video: { url: fp }, caption: (cap || "").slice(0, 1000) });
  };

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      try {
        if (m.key.fromMe) continue;
        const jid = m.key.remoteJid || "";
        const isGroup = jid.endsWith("@g.us");
        const sender = isGroup ? (m.key.participant || "") : jid;
        const userId = "wa:" + sender.replace(/@.*$/, "");
        const senderName = m.pushName || userId;
        const msg = m.message || {};
        const text = msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || msg.documentMessage?.caption || "";
        const ctx = {
          userId, platform: "wa", text, isGroup, senderName, senderUser: senderName.toLowerCase().replace(/\s+/g, ""),
          chatId: jid,
          reply: replyFor(jid, sender, senderName, m.key), replyFile: replyFileFor(jid),
          kickUser: async () => { await sock.groupParticipantsUpdate(jid, [sender], "remove"); },
          sendAlbum: async (items) => {
            for (const it of items) {
              try {
                if (isGroup) {
                  await sock.sendMessage(jid, { image: { url: it.img }, caption: ("@" + sender.replace(/@.*$/, "") + " " + (it.caption || "")).slice(0, 1000), mentions: [sender] }, { quoted: { key: m.key, message: { conversation: "." } } });
                } else {
                  await sock.sendMessage(jid, { image: { url: it.img }, caption: (it.caption || "").slice(0, 1000) });
                }
              } catch { await replyFor(jid, sender, senderName, m.key)(it.caption || it.img); }
            }
          },
        };
        const media = msg.videoMessage || msg.documentMessage || msg.imageMessage;
        if (media) {
          const buf = await downloadMediaMessage(m, "buffer", {});
          const name = media.fileName || (msg.videoMessage ? "video.mp4" : msg.imageMessage ? "foto.jpg" : "file");
          const tmp = path.join(os.tmpdir(), "wa-tg-" + Date.now() + "-" + String(name).replace(/[^a-zA-Z0-9._-]/g, "_"));
          fs.writeFileSync(tmp, buf);
          await onFile({ ...ctx, filePath: tmp, name });
          try { fs.unlinkSync(tmp); } catch {}
          if (text.trim() && !text.startsWith("/")) {
            
          } else if (text.trim()) { await onMessage(ctx); }
          continue;
        }
        if (text) await onMessage(ctx);
      } catch (e) { log.error("handler WA: " + e.message); }
    }
  });
  try { require("./scheduler").registerWA(sock); } catch {}
  // Welcome member baru (disetting owner via /mod)
  sock.ev.on("group-participants.update", async ({ id, participants, action }) => {
    try {
      if (action !== "add") return;
      const store = require("../db/store");
      const mod = require("../commands/mod");
      const cfg = store.getMod("wa", id);
      if (!cfg || !cfg.welcome_on) return;
      for (const p of participants || []) {
        const num = String(p).replace(/@.*$/, "").split(":").pop();
        const name = "@" + num;
        const teks = mod.welcomeText(cfg, name);
        if (cfg.welcome_img && /^https?:\/\//i.test(cfg.welcome_img)) {
          try { await sock.sendMessage(id, { image: { url: cfg.welcome_img }, caption: teks.slice(0, 1000), mentions: [p] }); continue; }
          catch {}
        }
        await sock.sendMessage(id, { text: teks.slice(0, 4000), mentions: [p] });
      }
    } catch (e) { log.error("welcome WA: " + e.message); }
  });
  return sock;
}

module.exports = { startWA };