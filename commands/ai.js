"use strict";

const store = require("../db/store");
const { fetchModels, chat, testConnection } = require("../services/ai");

const PRESETS = {
  "1": { name: "tiprouter", url: "https://tiprouter.my.id/v1" },
  "2": { name: "openrouter", url: "https://openrouter.ai/api/v1" },
  "3": { name: "openai", url: "https://api.openai.com/v1" },
};

const MAX_MODELS_SHOWN = 30;

function setupIntro() {
  return {
    text: "⚙️ SETUP AI\n━━━━━━━━━━━━━━━\nLangkah 1 dari 3 — Pilih provider AI-mu:",
    buttons: [
      [{ text: "1️⃣ TipRouter", data: "setup:1" }, { text: "2️⃣ OpenRouter", data: "setup:2" }],
      [{ text: "3️⃣ OpenAI", data: "setup:3" }, { text: "4️⃣ Custom URL", data: "setup:4" }],
    ],
  };
}

function fmtModels(models) {
  const shown = models.slice(0, MAX_MODELS_SHOWN);
  return {
    text: "🤖 PILIH MODEL\n━━━━━━━━━━━━━━━\nLangkah 3 dari 3 — Tap model favoritmu:\n" + shown.map((m, i) => `${i + 1}. ${m}`).join("\n"),
    buttons: shown.slice(0, 20).map((m, i) => [{ text: `${i + 1}. ${String(m).slice(0, 32)}`, data: "model:" + (i + 1) }]),
  };
}

async function handle(ctx) {
  const { userId, platform, text, reply, isOwner = true } = ctx;
  const user = store.getUser(userId, platform);
  const parts = text.trim().split(/\s+/);
  const cmd = (parts[0] || "").toLowerCase();
  const arg = parts.slice(1).join(" ").trim();

  if (cmd === "/ai") {
    const sub = (parts[1] || "status").toLowerCase();
    if (sub === "setup") {
      if (!isOwner) return reply("Khusus owner.");
      store.setUser(userId, { setup_step: "provider", setup_tmp: "{}" });
      return reply(setupIntro());
    }
    if (sub === "setup_pilih") {
      if (!isOwner) return reply("Khusus owner.");
      const n = parts[2] || "";
      store.setUser(userId, { setup_step: "provider", setup_tmp: "{}" });
      const done = await handleSetupFlow({ ...ctx, text: n === "4" ? "4" : n });
      if (done) return;
      return reply(setupIntro());
    }
    if (sub === "status") {
      if (!isOwner) return reply("Khusus owner.");
      if (!user.api_key) return reply("📭 Belum ada AI terhubung.\n\nKetik /ai setup untuk mulai — cuma 3 langkah cepat.");
      return reply(`✅ AI AKTIF\n━━━━━━━━━━━━━━━\n🌐 Provider: ${user.base_url}\n🤖 Model: ${user.model}\n\n🔄 /ai ganti — ganti model\n🗑️ /ai reset — hapus semua`);
    }
    if (sub === "ganti") {
      if (!isOwner) return reply("Khusus owner.");
      if (!user.api_key) return reply("Kamu belum setup AI. Ketik /ai setup dulu.");
      const tmp = store.tmpGet(userId);
      tmp.url = user.base_url;
      tmp.key = user.api_key;
      store.tmpSet(userId, tmp);
      store.setUser(userId, { setup_step: "rekey" });
      return reply("Kirim API key-mu lagi untuk ambil daftar model (ketik 'sama' untuk pakai key yang tersimpan).");
    }
    if (sub === "reset") {
      if (!isOwner) return reply("Khusus owner.");
      store.setUser(userId, { api_key: null, base_url: null, model: null, setup_step: "idle", setup_tmp: "{}" });
      store.clearHistory(userId);
      return reply("API key dan riwayatmu sudah dihapus.");
    }
    return reply("Pakai: /ai setup | .ai status | .ai ganti | .ai reset");
  }

  if (cmd === "/model") return handle({ ...ctx, text: "/ai ganti" });

  if (cmd === "/lupa") {
    if (!isOwner) return reply("Khusus owner.");
    store.clearHistory(userId);
    return reply("Riwayat chat dihapus. Mulai fresh ya.");
  }

  if (cmd === "/tanya") {
    let cred = user.api_key ? user : null;
    if (!cred && typeof store.getOwnerCreds === "function") {
      try { cred = store.getOwnerCreds(process.env.OWNER_IDS ? process.env.OWNER_IDS.split(/[\s,]+/) : (process.env.OWNER_ID ? [process.env.OWNER_ID] : [])); } catch {}
    }
    if (!cred || !cred.api_key) return reply("AI owner belum disetup. Minta owner ketik /ai setup dulu.");
    let q = arg.replace(/^>(.*)<$/s, "$1").trim();
    if (!q) return reply("Contoh: /tanya >di mana errornya<");
    store.sweepExpired();
    const pend = store.getPending(userId);
    if (!pend) return reply("Belum ada file aktif. Kirim dulu filenya (max 150 MB, selain APK), lalu /tanya dalam 3 menit.");
    const fs = require("fs");
    if (pend.expires_at && pend.expires_at < Date.now()) {
      try { fs.unlinkSync(pend.path); } catch {}
      store.clearPending(userId);
      return reply("Waktu habis (3 menit). File sudah dihapus dari VPS. Kirim ulang filenya ya.");
    }
    if (/\.apk$/i.test(pend.name || "")) {
      try { fs.unlinkSync(pend.path); } catch {}
      store.clearPending(userId);
      return reply("File APK tidak diterima dan sudah dihapus.");
    }
    let size = 0;
    try { size = fs.statSync(pend.path).size; } catch { return reply("File tidak ditemukan di VPS (mungkin sudah kedaluwarsa). Kirim ulang ya."); }
    if (size > 150 * 1024 * 1024) {
      try { fs.unlinkSync(pend.path); } catch {}
      store.clearPending(userId);
      return reply("File kebesaran (maksimal 150 MB). Sudah dihapus.");
    }
    const who = ctx.senderName || pend.sender || userId;
    const isImage = /\.(jpg|jpeg|png|webp)$/i.test(pend.name || "");
    const { extract } = require("../services/fileanalyzer");
    const { chat, chatVision } = require("../services/ai");
    const hist = store.getHistory(userId);
    let out;
    try {
      if (isImage) {
        const b64 = fs.readFileSync(pend.path).toString("base64").slice(0, 4000000);
        out = await chatVision(cred.base_url, cred.api_key, cred.model, b64,
          "Kamu asisten berbahasa Indonesia. ATURAN WAJIB: seluruh jawaban HANYA Bahasa Indonesia, tanpa kalimat Inggris. Penanya: " + who + ". Pertanyaan soal gambar ini: " + q);
      } else {
        let teks = "";
        try { teks = extract(pend.path, pend.name); } catch (e) { teks = "(gagal baca file: " + e.message + ")"; }
        out = await chat(cred.base_url, cred.api_key, cred.model, [
          { role: "system", content: "Kamu asisten berbahasa Indonesia. ATURAN WAJIB: seluruh jawaban HANYA Bahasa Indonesia, dilarang ada kalimat Inggris walau satu kata (dilarang membuka dengan 'I'll', 'Let me', 'I will', dsb). Jangan menulis proses berpikir — langsung berikan hasil akhirnya saja. FORMAT: teks chat biasa tanpa markdown — dilarang memakai **tebal**, # judul, ```blok kode```, atau backtick; tulis perintah sebagai teks baris biasa. Setiap pesan user diawali [nama pengirim]. Penanya sekarang: " + who + ". Jawab berdasarkan ISI FILE berikut (file ini dikirim oleh " + who + "):\n\n" + teks.slice(0, 12000) },
          ...hist.slice(-6),
          { role: "user", content: `[${who}]: ${q}` },
        ]);
      }
    } catch (e) {
      try { fs.unlinkSync(pend.path); } catch {}
      store.clearPending(userId);
      let msg = String((e && e.message) || e);
      if (/opencode/i.test(msg)) msg = "Model space-bunny versi gratis hanya bisa dipakai dari dalam aplikasi OpenCode, tidak bisa dari bot/VPS. Ketik /ai ganti lalu pilih model lain.";
      return reply("AI error: " + msg.slice(0, 500));
    } finally {
      try { fs.unlinkSync(pend.path); } catch {}
      store.clearPending(userId);
    }
    store.pushHistory(userId, "user", `[${who}] (file: ${pend.name}): ${q}`, who);
    if (!out || !String(out).trim() || String(out).trim() === "(respon kosong)") {
      return reply("AI mengembalikan respon kosong untuk file ini (kemungkinan format " + (pend.name || "file") + " tidak terbaca atau model menolak). Coba kirim sebagai .txt/.log, atau tanya lebih spesifik, mis. /tanya ringkas 5 poin.");
    }
    store.pushHistory(userId, "assistant", out);
    store.bumpStat("ai_reply");
    return reply(out.slice(0, 4000));
  }

  return null; // bukan command AI
}

async function handleSetupFlow(ctx) {
  const { userId, text, reply } = ctx;
  const user = store.getUser(userId, ctx.platform);
  const step = user.setup_step || "idle";
  const t = text.trim();

  if (step === "provider") {
    let url = null;
    if (PRESETS[t]) url = PRESETS[t].url;
    else if (t === "4") {
      store.setUser(userId, { setup_step: "custom_url" });
      return true && reply("🌐 LANGKAH 2 DARI 3 — URL Custom\n━━━━━━━━━━━━━━━\nKetik base URL provider-mu:\nContoh: https://tiprouter.my.id/v1") && true;
    } else if (/^https?:\/\//i.test(t)) url = t;
    else return true && reply("👆 Tap salah satu tombol di atas, atau balas angka 1-4.") && true;
    return pickModels(ctx, url);
  }

  if (step === "custom_url") {
    if (!/^https?:\/\//i.test(t)) return true && reply("URL tidak valid. Contoh: https://tiprouter.my.id/v1") && true;
    return pickModels(ctx, t);
  }

  if (step === "rekey") {
    const tmp = store.tmpGet(userId);
    const key = t.toLowerCase() === "sama" ? tmp.key : t.split(/\s+/)[0];
    await reply("🔍 Menghubungi provider, mengambil daftar model...");
    let models;
    try {
      models = await fetchModels(tmp.url, key);
    } catch (e) {
      return true && reply("Gagal hubungi URL itu: " + e.message) && true;
    }
    if (!models.length) {
      store.setUser(userId, { setup_step: "idle" });
      return true && reply("❌ Tidak ada model terdeteksi di URL itu. Cek URL / key lalu /ai setup lagi.") && true;
    }
    const shown = models.slice(0, MAX_MODELS_SHOWN);
    tmp.key = key;
    tmp.models = shown;
    store.tmpSet(userId, tmp);
    store.setUser(userId, { setup_step: "pick_model" });
    return true && reply(fmtModels(shown)) && true;
  }

  if (step === "api_key") {
    const tmp = store.tmpGet(userId);
    const key = t.split(/\s+/)[0];
    await reply("🔍 Menghubungi provider, mengambil daftar model...");
    let models;
    try {
      models = await fetchModels(tmp.url, key);
    } catch (e) {
      return true && reply("Gagal hubungi URL itu: " + e.message + "\nKirim ulang API key yang benar.") && true;
    }
    if (!models.length) {
      store.setUser(userId, { setup_step: "idle" });
      return true && reply("❌ Tidak ada model terdeteksi di URL itu. Cek URL lalu /ai setup lagi.") && true;
    }
    const shown = models.slice(0, MAX_MODELS_SHOWN);
    tmp.key = key;
    tmp.models = shown;
    store.tmpSet(userId, tmp);
    store.setUser(userId, { setup_step: "pick_model" });
    return true && reply(fmtModels(shown)) && true;
  }

  if (step === "pick_model") {
    const tmp = store.tmpGet(userId);
    const models = tmp.models || [];
    const n = parseInt(t, 10);
    if (!n || n < 1 || n > models.length) return true && reply(`Balas angka 1-${models.length}.`) && true;
    const model = models[n - 1];
    await reply("⏳ Mengetes koneksi ke model...");
    try {
      await testConnection(tmp.url, tmp.key, model);
    } catch (e) {
      return true && reply("❌ Koneksi gagal: " + e.message + "\nKirim ulang API key-mu.") && true;
    }
    store.setUser(userId, { base_url: tmp.url, model, api_key: tmp.key, setup_step: "idle", setup_tmp: "{}" });
    store.bumpStat("ai_setup");
    return true && reply(`🎉 SETUP BERHASIL!\n━━━━━━━━━━━━━━━\n🌐 ${tmp.url}\n🤖 ${model}\n\nLangsung chat saja — aku jawab pakai AI. Ketik /help untuk semua fitur.`) && true;
  }

  return false;
}

async function pickModels(ctx, url) {
  const { userId, reply } = ctx;
  const tmp = store.tmpGet(userId);
  tmp.url = url;
  store.tmpSet(userId, tmp);
  store.setUser(userId, { setup_step: "api_key" });
  return true && reply("🔑 LANGKAH 2 DARI 3 — API Key\\n━━━━━━━━━━━━━━━\\nProvider: " + url + "\\n\\nSekarang kirim API key-mu. Hanya kamu & bot yang tahu, bisa dihapus via /ai reset.") && true;
}

async function chatReply(ctx, userText) {
  const { userId, platform, reply, senderName } = ctx;
  const user = store.getUser(userId, platform);
  if (!user.api_key) {
    await reply("Aku belum kenal AI-mu. Ketik /ai setup untuk hubungkan API key dulu.");
    return;
  }
  const who = senderName || userId;
  store.pushHistory(userId, "user", `[${who}]: ${userText}`, who);
  const hist = store.getHistory(userId);
  const out = await chat(user.base_url, user.api_key, user.model,
    [{ role: "system", content: "Kamu asisten berbahasa Indonesia. ATURAN WAJIB: seluruh jawaban HANYA Bahasa Indonesia, dilarang ada kalimat Inggris walau satu kata (dilarang membuka dengan 'I'll', 'Let me', 'I will', dsb). Jangan menulis proses berpikir — langsung berikan hasil akhirnya saja. FORMAT: teks chat biasa tanpa markdown — dilarang memakai **tebal**, # judul, ```blok kode```, atau backtick; tulis perintah sebagai teks baris biasa." }, ...hist.slice(-10)]);
  store.pushHistory(userId, "assistant", out);
  store.bumpStat("ai_reply");
  await reply(out);
}

module.exports = { handle, handleSetupFlow, chatReply, setupIntro };
