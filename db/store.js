"use strict";

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "bot.sqlite3");

let db = null;

function open() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      base_url TEXT,
      model TEXT,
      api_key TEXT,
      setup_step TEXT DEFAULT 'idle',
      setup_tmp TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      sender TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pending (
      user_id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      name TEXT,
      sender TEXT,
      expires_at INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS stats (
      key TEXT PRIMARY KEY,
      value INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      interval_min INTEGER NOT NULL,
      text TEXT NOT NULL,
      next_run INTEGER NOT NULL,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      sender TEXT,
      text TEXT NOT NULL,
      due_at INTEGER NOT NULL,
      attempts INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chats (
      platform TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      title TEXT,
      last_seen TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (platform, chat_id)
    );
  `);
  return db;
}

function getUser(id, platform) {
  const d = open();
  let u = d.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!u) {
    d.prepare("INSERT INTO users (id, platform) VALUES (?, ?)").run(id, platform);
    u = d.prepare("SELECT * FROM users WHERE id = ?").get(id);
  }
  return u;
}

function setUser(id, patch) {
  const d = open();
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  d.prepare(`UPDATE users SET ${set}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map((k) => patch[k]), id);
}

function tmpGet(id) {
  const u = open().prepare("SELECT setup_tmp FROM users WHERE id = ?").get(id);
  try { return JSON.parse((u && u.setup_tmp) || "{}"); } catch { return {}; }
}
function tmpSet(id, obj) {
  setUser(id, { setup_tmp: JSON.stringify(obj) });
}

const MAX_HISTORY = parseInt(process.env.MAX_HISTORY || "20", 10);

function pushHistory(userId, role, content, sender) {
  const d = open();
  try { d.exec("ALTER TABLE history ADD COLUMN sender TEXT"); } catch {}
  d.prepare("INSERT INTO history (user_id, role, content, sender) VALUES (?, ?, ?, ?)").run(userId, role, content, sender || null);
  d.prepare(`DELETE FROM history WHERE id NOT IN (
    SELECT id FROM history WHERE user_id = ? ORDER BY id DESC LIMIT ?
  ) AND user_id = ?`).run(userId, MAX_HISTORY, userId);
}

function getHistory(userId) {
  const d = open();
  try { d.exec("ALTER TABLE history ADD COLUMN sender TEXT"); } catch {}
  return d.prepare(
    "SELECT role, content, sender FROM history WHERE user_id = ? ORDER BY id ASC"
  ).all(userId);
}

function clearHistory(userId) {
  open().prepare("DELETE FROM history WHERE user_id = ?").run(userId);
}

function bumpStat(key) {
  open().prepare(
    "INSERT INTO stats (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1"
  ).run(key);
}

function getStats() {
  const d = open();
  const users = d.prepare("SELECT COUNT(*) c FROM users WHERE api_key IS NOT NULL").get().c;
  const msgs = d.prepare("SELECT value FROM stats WHERE key = 'ai_reply'").get();
  return { usersSetup: users, aiReplies: (msgs && msgs.value) || 0 };
}

function setPending(userId, filePath, name, sender, expiresAt) {
  open().prepare(
    "INSERT INTO pending (user_id, path, name, sender, expires_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET path = excluded.path, name = excluded.name, sender = excluded.sender, expires_at = excluded.expires_at, created_at = datetime('now')"
  ).run(userId, filePath, name || "", sender || null, expiresAt);
}

function getPending(userId) {
  return open().prepare("SELECT path, name, sender, expires_at FROM pending WHERE user_id = ?").get(userId) || null;
}

function clearPending(userId) {
  const d = open();
  const row = d.prepare("SELECT path FROM pending WHERE user_id = ?").get(userId);
  d.prepare("DELETE FROM pending WHERE user_id = ?").run(userId);
  return row ? row.path : null;
}

function clearPendingExcept(userId, keepPath) {
  const fs = require("fs");
  const rows = open().prepare("SELECT path FROM pending WHERE user_id = ?").all(userId);
  for (const r of rows) {
    if (r.path === keepPath) continue;
    try { fs.unlinkSync(r.path); } catch {}
    open().prepare("DELETE FROM pending WHERE user_id = ? AND path = ?").run(userId, r.path);
  }
}

function sweepExpired() {
  const fs = require("fs");
  const now = Date.now();
  const rows = open().prepare("SELECT user_id, path FROM pending WHERE expires_at IS NOT NULL AND expires_at < ?").all(now);
  for (const r of rows) {
    try { fs.unlinkSync(r.path); } catch {}
    open().prepare("DELETE FROM pending WHERE user_id = ?").run(r.user_id);
  }
  return rows.length;
}

function addSchedule(platform, chatId, intervalMin, text, createdBy) {
  const next = Date.now() + intervalMin * 60000;
  const r = open().prepare(
    "INSERT INTO schedules (platform, chat_id, interval_min, text, next_run, created_by) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(platform, chatId, intervalMin, text, next, createdBy || null);
  return { id: r.lastInsertRowid, nextRun: next };
}
function listSchedules() {
  return open().prepare("SELECT * FROM schedules ORDER BY id ASC").all();
}
function deleteSchedule(id) {
  return open().prepare("DELETE FROM schedules WHERE id = ?").run(id).changes;
}
function clearSchedules() {
  return open().prepare("DELETE FROM schedules").run().changes;
}
function dueSchedules(now) {
  return open().prepare("SELECT * FROM schedules WHERE next_run <= ?").all(now || Date.now());
}
function bumpSchedule(id, intervalMin) {
  open().prepare("UPDATE schedules SET next_run = ? WHERE id = ?").run(Date.now() + intervalMin * 60000, id);
}
function autoSetup() {
  open().exec(`CREATE TABLE IF NOT EXISTS auto_chats (
    platform TEXT NOT NULL, chat_id TEXT NOT NULL,
    sholat INTEGER DEFAULT 0, libur INTEGER DEFAULT 0, zona TEXT DEFAULT 'wib',
    last_sent TEXT DEFAULT '', libur_date TEXT DEFAULT '',
    PRIMARY KEY (platform, chat_id)
  );`);
}
function getAuto(platform, chatId) {
  autoSetup();
  let r = open().prepare("SELECT * FROM auto_chats WHERE platform = ? AND chat_id = ?").get(platform, chatId);
  if (!r) {
    open().prepare("INSERT INTO auto_chats (platform, chat_id) VALUES (?, ?)").run(platform, chatId);
    r = open().prepare("SELECT * FROM auto_chats WHERE platform = ? AND chat_id = ?").get(platform, chatId);
  }
  return r;
}
function setAuto(platform, chatId, patch) {
  autoSetup();
  getAuto(platform, chatId);
  const keys = Object.keys(patch);
  if (!keys.length) return;
  open().prepare(`UPDATE auto_chats SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE platform = ? AND chat_id = ?`)
    .run(...keys.map((k) => patch[k]), platform, chatId);
}
function listAuto() {
  autoSetup();
  return open().prepare("SELECT * FROM auto_chats WHERE sholat = 1 OR libur = 1").all();
}
let modReady = false;
function modSetup() {
  if (modReady) return;
  open().exec(`CREATE TABLE IF NOT EXISTS mod_chats (
    platform TEXT NOT NULL, chat_id TEXT NOT NULL,
    anti_badword INTEGER DEFAULT 0,
    warn_msg TEXT DEFAULT '',
    max_warn INTEGER DEFAULT 3,
    welcome_on INTEGER DEFAULT 0,
    welcome_text TEXT DEFAULT '',
    welcome_img TEXT DEFAULT '',
    PRIMARY KEY (platform, chat_id)
  );
  CREATE TABLE IF NOT EXISTS mod_words (
    platform TEXT NOT NULL, chat_id TEXT NOT NULL, word TEXT NOT NULL,
    PRIMARY KEY (platform, chat_id, word)
  );
  CREATE TABLE IF NOT EXISTS mod_warns (
    platform TEXT NOT NULL, chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    PRIMARY KEY (platform, chat_id, user_id)
  );`);
  try { open().exec("ALTER TABLE mod_chats ADD COLUMN antilink INTEGER DEFAULT 0"); } catch {}
  modReady = true;
}
function getMod(platform, chatId) {
  modSetup();
  let r = open().prepare("SELECT * FROM mod_chats WHERE platform = ? AND chat_id = ?").get(platform, chatId);
  if (!r) {
    open().prepare("INSERT INTO mod_chats (platform, chat_id) VALUES (?, ?)").run(platform, chatId);
    r = open().prepare("SELECT * FROM mod_chats WHERE platform = ? AND chat_id = ?").get(platform, chatId);
  }
  return r;
}
function setMod(platform, chatId, patch) {
  modSetup();
  getMod(platform, chatId);
  const keys = Object.keys(patch);
  if (!keys.length) return;
  open().prepare(`UPDATE mod_chats SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE platform = ? AND chat_id = ?`)
    .run(...keys.map((k) => patch[k]), platform, chatId);
}
function addModWord(platform, chatId, word) {
  modSetup();
  open().prepare("INSERT OR IGNORE INTO mod_words (platform, chat_id, word) VALUES (?, ?, ?)")
    .run(platform, chatId, word.toLowerCase());
}
function delModWord(platform, chatId, word) {
  modSetup();
  return open().prepare("DELETE FROM mod_words WHERE platform = ? AND chat_id = ? AND word = ?")
    .run(platform, chatId, word.toLowerCase()).changes;
}
function listModWords(platform, chatId) {
  modSetup();
  return open().prepare("SELECT word FROM mod_words WHERE platform = ? AND chat_id = ? ORDER BY word ASC")
    .all(platform, chatId).map((r) => r.word);
}
function clearModWords(platform, chatId) {
  modSetup();
  return open().prepare("DELETE FROM mod_words WHERE platform = ? AND chat_id = ?").run(platform, chatId).changes;
}
function bumpWarn(platform, chatId, userId) {
  modSetup();
  open().prepare("INSERT INTO mod_warns (platform, chat_id, user_id, count) VALUES (?, ?, ?, 1) " +
    "ON CONFLICT(platform, chat_id, user_id) DO UPDATE SET count = count + 1")
    .run(platform, chatId, userId);
  return open().prepare("SELECT count FROM mod_warns WHERE platform = ? AND chat_id = ? AND user_id = ?")
    .get(platform, chatId, userId).count;
}
function resetWarn(platform, chatId, userId) {
  modSetup();
  return open().prepare("DELETE FROM mod_warns WHERE platform = ? AND chat_id = ? AND user_id = ?")
    .run(platform, chatId, userId).changes;
}
function getWarn(platform, chatId, userId) {
  modSetup();
  const r = open().prepare("SELECT count FROM mod_warns WHERE platform = ? AND chat_id = ? AND user_id = ?")
    .get(platform, chatId, userId);
  return (r && r.count) || 0;
}
function addReminder(userId, platform, chatId, text, dueAt, sender) {
  const r = open().prepare(
    "INSERT INTO reminders (user_id, platform, chat_id, sender, text, due_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(userId, platform, chatId, sender || null, text, dueAt);
  return { id: Number(r.lastInsertRowid), dueAt };
}
function listReminders(userId) {
  return open().prepare(
    "SELECT id, text, due_at, chat_id FROM reminders WHERE user_id = ? ORDER BY due_at ASC"
  ).all(userId);
}
function dueReminders(now) {
  return open().prepare("SELECT * FROM reminders WHERE due_at <= ? ORDER BY due_at ASC").all(now || Date.now());
}
function bumpReminderAttempt(id) {
  open().prepare("UPDATE reminders SET attempts = attempts + 1 WHERE id = ?").run(id);
}
function deleteReminder(id, userId) {
  return open().prepare("DELETE FROM reminders WHERE id = ? AND user_id = ?").run(id, userId).changes;
}
function deleteReminderAny(id) {
  return open().prepare("DELETE FROM reminders WHERE id = ?").run(id).changes;
}
function clearReminders(userId) {
  return open().prepare("DELETE FROM reminders WHERE user_id = ?").run(userId).changes;
}
function touchChat(platform, chatId, title) {
  if (!platform || !chatId) return;
  open().prepare(
    "INSERT INTO chats (platform, chat_id, title, last_seen) VALUES (?, ?, ?, datetime('now')) " +
    "ON CONFLICT(platform, chat_id) DO UPDATE SET last_seen = datetime('now'), title = COALESCE(excluded.title, chats.title)"
  ).run(platform, String(chatId), title || null);
}
function listChats(limit) {
  return open().prepare("SELECT platform, chat_id, title, last_seen FROM chats ORDER BY last_seen DESC LIMIT ?")
    .all(limit || 100);
}
function countChats() {
  return open().prepare("SELECT COUNT(*) c FROM chats").get().c;
}
function statsDetail() {
  const d = open();
  const one = (sql) => {
    try { return d.prepare(sql).get().c || 0; } catch { return 0; }
  };
  return {
    users: one("SELECT COUNT(*) c FROM users"),
    usersSetup: one("SELECT COUNT(*) c FROM users WHERE api_key IS NOT NULL"),
    chats: one("SELECT COUNT(*) c FROM chats"),
    reminders: one("SELECT COUNT(*) c FROM reminders"),
    schedules: one("SELECT COUNT(*) c FROM schedules"),
    pending: one("SELECT COUNT(*) c FROM pending"),
    aiReplies: one("SELECT value c FROM stats WHERE key = 'ai_reply'"),
  };
}
function getOwnerCreds(ownerIds) {
  const d = open();
  const ids = (ownerIds || []).filter(Boolean);
  for (const id of ids) {
    const u = d.prepare("SELECT * FROM users WHERE id = ? AND api_key IS NOT NULL").get(id);
    if (u && u.api_key) return u;
  }
  
  return d.prepare("SELECT * FROM users WHERE api_key IS NOT NULL LIMIT 1").get() || null;
}
module.exports = { getUser, setUser, tmpGet, tmpSet, pushHistory, getHistory, clearHistory, setPending, getPending, clearPending, clearPendingExcept, sweepExpired, bumpStat, getStats, addSchedule, listSchedules, deleteSchedule, clearSchedules, dueSchedules, bumpSchedule, getOwnerCreds, getAuto, setAuto, listAuto, getMod, setMod, addModWord, delModWord, listModWords, clearModWords, bumpWarn, resetWarn, getWarn, addReminder, listReminders, dueReminders, bumpReminderAttempt, deleteReminder, deleteReminderAny, clearReminders, touchChat, listChats, countChats, statsDetail };
