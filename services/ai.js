"use strict";

async function fetchModels(baseUrl, apiKey) {
  const url = baseUrl.replace(/\/+$/, "") + "/models";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const headers = {};
    if (apiKey) headers.Authorization = "Bearer " + apiKey;
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      let msg = "HTTP " + res.status;
      try {
        const j = JSON.parse(txt);
        const m = (j.error && (j.error.message || j.error.code)) || j.message;
        if (m) msg += " — " + m;
      } catch { if (txt) msg += " — " + txt.slice(0, 160); }
      throw new Error(msg);
    }
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.data || [];
    return list.map((m) => (typeof m === "string" ? m : m.id)).filter(Boolean);
  } finally {
    clearTimeout(t);
  }
}

function cleanChat(t) {
  let s = String(t || "");
  s = s.replace(/```(\w*)\n?/g, "").replace(/```/g, "");
  s = s.replace(/\*\*(.+?)\*\*/g, "$1");
  s = s.replace(/__(.+?)__/g, "$1");
  s = s.replace(/(^|\n)#{1,6}\s*/g, "$1");
  s = s.replace(/~~(.+?)~~/g, "$1");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
  s = s.replace(/^\s*[-*]\s+/gm, "- ");
  return s.trim();
}

async function chat(baseUrl, apiKey, model, messages) {
  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({ model, messages, max_tokens: 1500 }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error("HTTP " + res.status + " " + txt.slice(0, 200));
    }
    const data = await res.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    let text = (msg && msg.content ? String(msg.content) : "").trim();
    if (!text && msg && msg.reasoning_content) text = String(msg.reasoning_content).trim();
    if (!text && data.choices && data.choices[0] && data.choices[0].text) text = String(data.choices[0].text).trim();
    return cleanChat(text) || "(respon kosong)";
  } finally {
    clearTimeout(t);
  }
}

async function testConnection(baseUrl, apiKey, model) {
  return chat(baseUrl, apiKey, model, [{ role: "user", content: "balas persis: OK" }]);
}

async function chatVision(baseUrl, apiKey, model, imageBase64, prompt) {
  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64," + imageBase64 } },
          ],
        }],
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error("HTTP " + res.status + " " + txt.slice(0, 200));
    }
    const data = await res.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    let text = (msg && msg.content ? String(msg.content) : "").trim();
    if (!text && msg && msg.reasoning_content) text = String(msg.reasoning_content).trim();
    if (!text && data.choices && data.choices[0] && data.choices[0].text) text = String(data.choices[0].text).trim();
    return cleanChat(text) || "(respon kosong)";
  } finally {
    clearTimeout(t);
  }
}

module.exports = { fetchModels, chat, testConnection, chatVision };