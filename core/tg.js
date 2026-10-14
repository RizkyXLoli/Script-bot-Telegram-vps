"use strict";

const pino = require("pino");
const fs = require("fs");
const os = require("os");
const path = require("path");

const log = pino({ level: process.env.LOG_LEVEL || "info" });

async function startTG(onMessage, onFile) {
  const token = process.env.BOT_TOKEN || "";
  if (!token) {
    log.warn("BOT_TOKEN kosong — Telegram nonaktif (WA tetap jalan).");
    return null;
  }
  const { Bot } = require("grammy");
  const bot = new Bot(token);

  bot.on("message:text", async (ctx) => {
    if (ctx.from && ctx.from.is_bot) return;
    const userId = "tg:" + ctx.from.id;
    const senderName = ((ctx.from.first_name || "") + " " + (ctx.from.last_name || "")).trim() || ("user-" + ctx.from.id);
    const senderUser = (ctx.from.username || "").toLowerCase();
    let text = ctx.message.text || "";
    text = text.replace(/^[\/.]ai@\S+/i, "/ai");
    const isGroup = ctx.chat && (ctx.chat.type === "group" || ctx.chat.type === "supergroup");
    try {
      await onMessage({
        userId, platform: "tg", text, isGroup, senderName, senderUser,
        reply: (t) => ctx.reply(t.slice(0, 4000)),
        replyFile: async (fp, cap) => {
          if (fs.statSync(fp).size > 150 * 1024 * 1024) {
            await ctx.reply("File di atas 150 MB, tidak bisa dikirim.");
            return;
          }
          if (fp.endsWith(".mp3")) await ctx.replyWithAudio(new (require("grammy").InputFile)(fp), { caption: cap || "" });
          else await ctx.replyWithVideo(new (require("grammy").InputFile)(fp), { caption: (cap || "").slice(0, 1000) });
        },
      });
    } catch (e) { log.error("handler TG: " + e.message); }
  });

  bot.on("message:photo", async (ctx) => {
    if (ctx.from && ctx.from.is_bot) return;
    const userId = "tg:" + ctx.from.id;
    const senderName = ((ctx.from.first_name || "") + " " + (ctx.from.last_name || "")).trim() || ("user-" + ctx.from.id);
    const senderUser = (ctx.from.username || "").toLowerCase();
    try {
      const photos = ctx.message.photo || [];
      const best = photos[photos.length - 1];
      const file = await ctx.api.getFile(best.file_id);
      const tmp = path.join(os.tmpdir(), "wa-tg-" + Date.now() + "-foto.jpg");
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
      fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
      const caption = ctx.message.caption || "";
      await onFile({ userId, platform: "tg", filePath: tmp, name: "foto.jpg", senderName, reply: (t) => ctx.reply(t.slice(0, 4000)) });
      if (caption.trim()) {
        await onMessage({
          userId, platform: "tg", text: "/tanya " + caption.trim(), isGroup: false, senderName, senderUser,
          reply: (t) => ctx.reply(t.slice(0, 4000)),
          replyFile: async () => {},
        });
      }
      try { fs.unlinkSync(tmp); } catch {}
    } catch (e) { await ctx.reply("Gagal proses foto: " + e.message); }
  });

  bot.on("message:document", async (ctx) => {
    if (ctx.from && ctx.from.is_bot) return;
    const userId = "tg:" + ctx.from.id;
    const senderName = ((ctx.from.first_name || "") + " " + (ctx.from.last_name || "")).trim() || ("user-" + ctx.from.id);
    const senderUser = (ctx.from.username || "").toLowerCase();
    const doc = ctx.message.document;
    if ((doc.file_size || 0) > 20 * 1024 * 1024) {
      await ctx.reply("File kebesaran (max 20 MB di Telegram).");
      return;
    }
    try {
      const file = await ctx.getFile();
      const tmp = path.join(os.tmpdir(), "wa-tg-" + Date.now() + "-" + (doc.file_name || "file"));
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
      fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
      await onFile({ userId, platform: "tg", filePath: tmp, name: doc.file_name || "file", senderName, reply: (t) => ctx.reply(t.slice(0, 4000)) });
      try { fs.unlinkSync(tmp); } catch {}
    } catch (e) { await ctx.reply("Gagal unduh file: " + e.message); }
  });

  bot.catch((e) => log.error("TG error: " + (e.message || e)));
  bot.start();
  log.info("Telegram terhubung.");
  return bot;
}

module.exports = { startTG };
