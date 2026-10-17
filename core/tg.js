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
  function tgFmt(s) {
    // Convert WA-style *bold* to Telegram HTML <b>, escape the rest
    let t = String(s).slice(0, 4000);
    const ph = [];
    t = t.replace(/\*([^*\n]+)\*/g, (_, inner) => {
      ph.push(inner);
      return `\u0000B${ph.length - 1}\u0000`;
    });
    // blok ```...``` jadi <pre> (monospace) supaya kolom menu rata di Telegram
    const pre = [];
    t = t.replace(/```([\s\S]*?)```/g, (_, inner) => {
      pre.push(inner);
      return `\u0000P${pre.length - 1}\u0000`;
    });
    t = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    t = t.replace(/\u0000B(\d+)\u0000/g, (_, i) => `<b>${ph[Number(i)].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</b>`);
    t = t.replace(/\u0000P(\d+)\u0000/g, (_, i) => `<pre>${pre[Number(i)].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`);
    return t;
  }
  function rich(toReply) {
    return async (t) => {
      if (t && typeof t === "object" && t.buttons) {
        const kb = new InlineKeyboard();
        for (const row of t.buttons) {
          for (const b of row) kb.text(b.text, b.data);
          kb.row();
        }
        return toReply(tgFmt(t.text), { reply_markup: kb });
      }
      // tgFmt HANYA di sini: callback pemanggil sudah memakai parse_mode HTML,
      // jadi jangan memformat dua kali (kalau dobel, <pre>/<b> ikut ter-escape
      // dan user melihat tag mentah).
      return toReply(tgFmt(t), {});
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
        reply: rich((m, extra) => ctx.reply(String(m).slice(0, 4000), { parse_mode: "HTML", ...(extra || {}) })),
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
        reply: rich((m, extra) => ctx.reply(String(m).slice(0, 4000), { parse_mode: "HTML", reply_parameters: { message_id: ctx.message.message_id }, ...(extra || {}) })),
        kickUser: async () => {
          await ctx.api.banChatMember(ctx.chat.id, ctx.from.id);
          try { await ctx.api.unbanChatMember(ctx.chat.id, ctx.from.id); } catch {}
        },
        replyFile: async (fp, cap) => {
          if (fs.statSync(fp).size > 150 * 1024 * 1024) {
            await ctx.reply("File di atas 150 MB, tidak bisa dikirim.", { reply_parameters: { message_id: ctx.message.message_id } });
            return;
          }
          if (fp.endsWith(".mp3")) await ctx.replyWithAudio(new (require("grammy").InputFile)(fp), { caption: cap || "", reply_parameters: { message_id: ctx.message.message_id } });
          else if (/\.(jpg|jpeg|png|webp)$/i.test(fp)) {
            if (/^https?:\/\//i.test(fp)) await ctx.replyWithPhoto(fp, { caption: (cap || "").slice(0, 1000), reply_parameters: { message_id: ctx.message.message_id } });
            else await ctx.replyWithPhoto(new (require("grammy").InputFile)(fp), { caption: (cap || "").slice(0, 1000), reply_parameters: { message_id: ctx.message.message_id } });
          }
          else await ctx.replyWithVideo(new (require("grammy").InputFile)(fp), { caption: (cap || "").slice(0, 1000), reply_parameters: { message_id: ctx.message.message_id } });
        },
        sendAlbum: async (items) => {
          
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
            await ctx.replyWithMediaGroup(batch, { reply_parameters: { message_id: ctx.message.message_id } });
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
      const sendStickerTg = async (fp) => {
        await ctx.replyWithSticker(new (require("grammy").InputFile)(fp));
      };
      if (/^\/(stiker|sticker|smeme)(\s|$)/i.test(caption.trim())) {
        try {
          await require("../commands/stiker").handle({
            userId, platform: "tg", text: caption.trim(), isGroup: false, senderName, senderUser,
            filePath: tmp, fileName: "foto.jpg",
            reply: (t) => ctx.reply(String(t).slice(0, 4000)),
            replyFile: async () => {}, sendSticker: sendStickerTg,
          });
        } catch (e) { log.error("stiker TG: " + e.message); }
        try { fs.unlinkSync(tmp); } catch {}
        return;
      }
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

  // Welcome member baru TG (disetting owner via /mod)
  bot.on("message:new_chat_members", async (ctx) => {
    try {
      const store = require("../db/store");
      const mod = require("../commands/mod");
      const cfg = store.getMod("tg", String(ctx.chat.id));
      if (!cfg || !cfg.welcome_on) return;
      for (const u of ctx.message.new_chat_members || []) {
        if (u.is_bot) continue;
        const name = (u.first_name || "kawan") + (u.last_name ? " " + u.last_name : "");
        const teks = mod.welcomeText(cfg, name);
        if (cfg.welcome_img && /^https?:\/\//i.test(cfg.welcome_img)) {
          try { await ctx.replyWithPhoto(cfg.welcome_img, { caption: teks.slice(0, 1000) }); continue; }
          catch {}
        }
        await ctx.reply(teks.slice(0, 4000));
      }
    } catch (e) { log.error("welcome TG: " + e.message); }
  });

  bot.start();
  try { require("./scheduler").registerTG(bot); } catch {}
  log.info("Telegram terhubung.");
  return bot;
}

module.exports = { startTG };