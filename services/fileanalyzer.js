"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const zlib = require("zlib");

function extractDocx(buf) {
  try {
    const s = buf.toString("latin1");
    const parts = [];
    const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let m;
    while ((m = re.exec(s)) && parts.length < 5000) parts.push(m[1]);
    if (parts.length) return parts.join(" ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  } catch {}
  return "";
}

function extract(filePath, originalName) {
  const ext = (originalName.split(".").pop() || "").toLowerCase();
  const buf = fs.readFileSync(filePath);
  if (["log", "txt", "md", "csv", "json"].includes(ext)) {
    return buf.toString("utf8").slice(0, 12000);
  }
  if (ext === "pdf") {
    try {
      const out = execFileSync("pdftotext", ["-l", "5", filePath, "-"], { maxBuffer: 16 * 1024 * 1024 }).toString("utf8");
      return out.slice(0, 12000) || "(pdf kosong / tidak bisa dibaca)";
    } catch {
      return "(butuh pdftotext untuk baca PDF: sudo apt install poppler-utils)";
    }
  }
  if (ext === "docx") {
    return extractDocx(buf).slice(0, 12000) || "(docx tidak bisa dibaca)";
  }
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
    return "(gambar diterima — analisis gambar butuh model vision; tanya langsung ke AInya ya)";
  }
  const s = buf.toString("utf8").slice(0, 12000);
  return s.includes("\uFFFD") ? "(format belum didukung: " + ext + ")" : s;
}

module.exports = { extract };