// Keeps a copy of every log entry in the database so the website can show a
// live feed of "log rooms" for each guild, independent of Discord channels.
// A rolling window is kept per guild (old rows are trimmed) to bound growth.
const db = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS log_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL,
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    text        TEXT,
    user_tag    TEXT,
    user_id     TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS log_entries_guild ON log_entries (guild_id, id);
`);

const KEEP = 3000; // most recent entries kept per guild

const stmt = {
  add: db.prepare('INSERT INTO log_entries (guild_id, type, title, text, user_tag, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  recent: db.prepare('SELECT type, title, text, user_tag, user_id, created_at FROM log_entries WHERE guild_id = ? ORDER BY id DESC LIMIT ?'),
  recentType: db.prepare('SELECT type, title, text, user_tag, user_id, created_at FROM log_entries WHERE guild_id = ? AND type = ? ORDER BY id DESC LIMIT ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM log_entries WHERE guild_id = ?'),
  trim: db.prepare(`DELETE FROM log_entries WHERE guild_id = ? AND id <= (
    SELECT id FROM log_entries WHERE guild_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?
  )`),
};

// Turn a Discord-markdown description into plain text the website can show:
// drop bold/code markers and turn raw <@id>/<#id> mentions into readable tags.
function plain(text) {
  if (!text) return '';
  return String(text)
    .replace(/<@!?(\d+)>/g, '@$1')
    .replace(/<#(\d+)>/g, '#room')
    .replace(/<@&(\d+)>/g, '@role')
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/\*\*|__|`+|-#\s?/g, '')
    .replace(/​/g, '')
    .trim();
}

const counters = new Map(); // guild_id → writes since last trim

module.exports = {
  add(guildId, type, { title, text, userTag, userId }) {
    try {
      stmt.add.run(guildId, type, String(title || '').slice(0, 300), plain(text).slice(0, 4000), userTag || null, userId || null, Date.now());
      // Trim occasionally rather than on every write.
      const n = (counters.get(guildId) || 0) + 1;
      if (n >= 50) {
        counters.set(guildId, 0);
        if (stmt.count.get(guildId).n > KEEP) stmt.trim.run(guildId, guildId, KEEP);
      } else {
        counters.set(guildId, n);
      }
    } catch { /* logging must never throw */ }
  },
  recent(guildId, { type, limit = 100 } = {}) {
    const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const rows = type && type !== 'all' ? stmt.recentType.all(guildId, type, n) : stmt.recent.all(guildId, n);
    return rows.map((r) => ({ type: r.type, title: r.title, text: r.text, user: r.user_tag, userId: r.user_id, at: r.created_at }));
  },
};
