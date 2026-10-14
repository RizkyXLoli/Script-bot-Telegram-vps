"use strict";

const QUOTES = ["Jangan menyerah, hari buruk bukan hidup yang buruk.","Kode yang bagus ditulis untuk dibaca manusia.","Sedikit kemajuan tiap hari tetap kemajuan.","Fokus pada yang bisa kamu kontrol.","Istirahat bukan menyerah."];
const JOKES = ["Kenapa programmer benci alam? Terlalu banyak bug.","Kenapa komputer dingin? Jendelanya terbuka.","Apa kata server ke client? Aku selalu mendengarkanmu.","Kenapa WiFi putus? Dia butuh ruang.","Programmer: mesin pengubah kopi jadi kode."];
const FAKTA = ["Madu tidak pernah basi.","Gurita punya tiga jantung.","Pisang mengapung di air.","Cahaya butuh 8 menit dari Matahari ke Bumi.","Otak memakai ~20% energi tubuh."];
const PANTUN = ["Pergi ke pasar membeli duku | Jangan lupa membeli pepaya | Rajin belajar setiap waktu | Sukses menanti di depan mata","Pagi hari minum kopi | Ditemani roti bakar | Jangan pernah berhenti bermimpi | Usaha pasti berbuah sabar"];
const TEBAK = [["Aku selalu datang tapi tak pernah tiba, siapa aku?","besok"],["Makin diambil makin besar, apa aku?","lubang"],["Punya kunci tapi tak bisa buka pintu?","keyboard"]];
const tebakState = new Map();
async function get(u, timeout=15000) {
  const c = new AbortController(); const t = setTimeout(()=>c.abort(), timeout);
  try { const r = await fetch(u, {signal:c.signal, headers:{"User-Agent":"Mozilla/5.0"}}); return await r.text(); }
  finally { clearTimeout(t); }
}
const pick = a => a[Math.floor(Math.random()*a.length)];
async function handle(ctx, store) {
  const { text, reply, userId } = ctx;
  const [raw, ...rest] = text.trim().split(/\s+/);
  const cmd = (raw||"").toLowerCase();
  const arg = rest.join(" ").trim();
  if (cmd === "/quote") return reply(pick(QUOTES));
  if (cmd === "/joke" || cmd === "/lucu") return reply(pick(JOKES));
  if (cmd === "/fakta") return reply(pick(FAKTA));
  if (cmd === "/pantun") return reply(pick(PANTUN));
  if (cmd === "/dadu") return reply("Dadu: " + (1+Math.floor(Math.random()*6)));
  if (cmd === "/koin") return reply("Koin: " + (Math.random()<0.5?"Kepala":"Ekor"));
  if (cmd === "/suit") {
    const p = (arg||"").toLowerCase();
    if (!["batu","gunting","kertas"].includes(p)) return reply("Contoh: /suit batu");
    const b = pick(["batu","gunting","kertas"]);
    const win = {batu:"gunting", gunting:"kertas", kertas:"batu"};
    const hasil = p===b ? "Seri!" : (win[p]===b ? "Kamu menang!" : "Bot menang!");
    return reply("Bot: "+b+". "+hasil);
  }
  if (cmd === "/ramal") {
    const nama = arg || "kamu";
    const h = ["Besar peluang rezeki hari ini.","Hati-hati, jangan buru-buru.","Cocok untuk mulai hal baru.","Ada kabar baik dari teman lama."];
    return reply("Ramalan "+nama+": "+pick(h));
  }
  if (cmd === "/tebak") {
    const t = pick(TEBAK);
    tebakState.set(userId, t[1]);
    return reply("Tebak: "+t[0]+"\nBalas dengan /jawab <tebakanmu>");
  }
  if (cmd === "/jawab") {
    const kunci = tebakState.get(userId);
    if (!kunci) return reply("Belum ada tebakan aktif. Ketik /tebak dulu.");
    if ((arg||"").toLowerCase().includes(kunci)) { tebakState.delete(userId); return reply("Benar! Hebat."); }
    return reply("Kurang tepat, coba lagi! (/jawab ...)");
  }
  if (cmd === "/nama") {
    try {
      const j = JSON.parse(await get("https://api.agify.io?name="+encodeURIComponent(arg||"budi")));
      return reply("Prediksi umur nama "+j.name+": "+j.age+" tahun ("+j.count+" sampel).");
    } catch(e){ return reply("Gagal: "+e.message); }
  }
  return null;
}
module.exports = { handle };