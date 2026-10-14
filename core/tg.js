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

  const { InlineKeyboard } = require("grammy");
  function rich(toReply) {
    return async (t) => {
      if (t && typeof t === "object" && t.buttons) {
        const kb = new InlineKeyboard();
        for (const row of t.buttons) {
          for (const b of row) kb.text(b.text, b.data);
          kb.row();
        }
        return toReply(String(t.text).slice(0, 4000), { reply_markup: kb });
      }
      return toReply(String(t).slice(0, 4000));
    };
  }

  bot.on("callback_query:data", async (ctx) => {
    try {
      const data = ctx.callbackQuery.data || "";
      const userId = "tg:" + ctx.from.id;
      const senderName = ((ctx.from.first_name || "") + " " + (ctx.from.last_name || "")).trim() || ("user-" + ctx.from.id);
      const senderUser = (ctx.from.username || "").toLowerCase();
      await ctx.answerCallbackQuery();
      let text = null;
      if (/^setup:[1234]$/.test(data)) text = "/ai setup_pilih " + data.slice(6);
      else if (/^model:\d+$/.test(data)) text = data.slice(6);
      if (!text) return;
      try { await ctx.editMessageReplyMarkup({ reply_markup: undefined }); } catch {}
      await onMessage({
        userId, platform: "tg", text, isGroup: false, senderName, senderUser,
        reply: rich((m, extra) => ctx.reply(m.slice(0, 4000), extra)),
        replyFile: async () => {},
        viaButton: true,
      });
    } catch (e) { log.error("callback TG: " + e.message); }
  });

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
        chatId: String(ctx.chat.id),
        reply: rich((m, extra) => ctx.reply(m.slice(0, 4000), extra)),
        replyFile: async (fp, cap) => {
          if (fs.statSync(fp).size > 150 * 1024 * 1024) {
            await ctx.reply("File di atas 150 MB, tidak bisa dikirim.");
            return;
          }
          if (fp.endsWith(".mp3")) await ctx.replyWithAudio(new (require("grammy").InputFile)(fp), { caption: cap || "" });
          else if (/\.(jpg|jpeg|png|webp)$/i.test(fp)) {
            if (/^https?:\/\//i.test(fp)) await ctx.replyWithPhoto(fp, { caption: (cap || "").slice(0, 1000) });
            else await ctx.replyWithPhoto(new (require("grammy").InputFile)(fp), { caption: (cap || "").slice(0, 1000) });
          }
          else await ctx.replyWithVideo(new (require("grammy").InputFile)(fp), { caption: (cap || "").slice(0, 1000) });
        },
        sendAlbum: async (items) => {
          // items: [{img, caption}] -> 1 bubble album (max 10 per grup)
          const fs2 = require("fs"), { InputFile } = require("grammy");
          for (let i = 0; i < items.length; i += 10) {
            const batch = items.slice(i, i + 10).map((it, j) => {
              let media = it.img;
              if (!/^https?:\/\//i.test(it.img)) {
                try { media = new InputFile(fs2.createReadStream(it.img)); }
                catch { media = it.img; }
              }
              return {
                type: "photo", media,
                ...(i + j === 0 && it.caption ? { caption: it.caption.slice(0, 1000) } : {}),
              };
            });
            await ctx.replyWithMediaGroup(batch);
          }
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
      const sendFile = async (fp, cap) => {
        if (fp.endsWith(".mp3")) await ctx.replyWithAudio(new (require("grammy").InputFile)(fp), { caption: cap || "" });
        else await ctx.replyWithVideo(new (require("grammy").InputFile)(fp), { caption: (cap || "").slice(0, 1000) });
      };
      await onFile({ userId, platform: "tg", filePath: tmp, name: "foto.jpg", senderName, reply: (t) => ctx.reply(t.slice(0, 4000)), replyFile: sendFile });
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

  bot.on(["message:video", "message:video_note", "message:animation"], async (ctx) => {
    if (ctx.from && ctx.from.is_bot) return;
    const userId = "tg:" + ctx.from.id;
    const senderName = ((ctx.from.first_name || "") + " " + (ctx.from.last_name || "")).trim() || ("user-" + ctx.from.id);
    try {
      const v = ctx.message.video || ctx.message.video_note || ctx.message.animation;
      if ((v.file_size || 0) > 20 * 1024 * 1024) {
        await ctx.reply("Video kebesaran — Telegram Bot API cuma bisa unduh file max 20 MB. Kirim video di bawah 20 MB ya.");
        return;
      }
      const file = await ctx.getFile();
      const fn = (v.file_name || "video.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
      const tmp = path.join(os.tmpdir(), "wa-tg-" + Date.now() + "-" + fn);
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
      fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
      const sendFile = async (fp, cap) => {
        if (fp.endsWith(".mp3")) await ctx.replyWithAudio(new (require("grammy").InputFile)(fp), { caption: cap || "" });
        else await ctx.replyWithVideo(new (require("grammy").InputFile)(fp), { caption: (cap || "").slice(0, 1000) });
      };
      await onFile({ userId, platform: "tg", filePath: tmp, name: fn, senderName, reply: (t) => ctx.reply(t.slice(0, 4000)), replyFile: sendFile });
      try { fs.unlinkSync(tmp); } catch {}
    } catch (e) {
      const m = /file is too big/i.test(e.message || "") ? "Video kebesaran — Telegram Bot API cuma bisa unduh file max 20 MB. Kirim video di bawah 20 MB ya." : "Gagal proses video: " + e.message;
      await ctx.reply(m);
    }
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
      await onFile({ userId, platform: "tg", filePath: tmp, name: doc.file_name || "file", senderName, reply: (t) => ctx.reply(t.slice(0, 4000)), replyFile: async (fp, cap) => {
        if (fp.endsWith(".mp3")) await ctx.replyWithAudio(new (require("grammy").InputFile)(fp), { caption: cap || "" });
        else await ctx.replyWithDocument(new (require("grammy").InputFile)(fp), { caption: (cap || "").slice(0, 1000) });
      } });
      try { fs.unlinkSync(tmp); } catch {}
    } catch (e) { await ctx.reply("Gagal unduh file: " + e.message); }
  });

  bot.catch((e) => log.error("TG error: " + (e.message || e)));
  bot.start();
  try { require("./scheduler").registerTG(bot); } catch {}
  log.info("Telegram terhubung.");
  return bot;
}

module.exports = { startTG };
