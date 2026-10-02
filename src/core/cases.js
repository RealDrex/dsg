// Moderation cases (warn/ban/kick/timeout...) — stored and broadcast to the logs plugin.
const db = require('./db');

const ACTIONS = {
  warn: { label: 'تحذير', emoji: '⚠️' },
  timeout: { label: 'تايم أوت', emoji: '⏳' },
  untimeout: { label: 'فك التايم أوت', emoji: '⌛' },
  kick: { label: 'طرد', emoji: '👢' },
  ban: { label: 'باند', emoji: '🔨' },
  unban: { label: 'فك الباند', emoji: '🕊️' },
  unwarn: { label: 'حذف تحذير', emoji: '🧽' },
  auto: { label: 'إجراء تلقائي (حماية)', emoji: '🛡️' },
};

const nextNumber = db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM cases WHERE guild_id = ?');
const insert = db.prepare(`INSERT INTO cases (guild_id, number, action, user_id, mod_id, reason, duration, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

function create(guild, { action, userId, modId, reason = null, duration = null }) {
  const number = nextNumber.get(guild.id).n;
  const entry = { guildId: guild.id, number, action, userId, modId, reason, duration, createdAt: Date.now() };
  insert.run(guild.id, number, action, userId, modId, reason, duration, entry.createdAt);
  guild.client.emit('swordModAction', guild, entry);
  return entry;
}

const forUser = (guildId, userId, action) =>
  action
    ? db.prepare('SELECT * FROM cases WHERE guild_id = ? AND user_id = ? AND action = ? ORDER BY number DESC').all(guildId, userId, action)
    : db.prepare('SELECT * FROM cases WHERE guild_id = ? AND user_id = ? ORDER BY number DESC').all(guildId, userId);

const byNumber = (guildId, number) => db.prepare('SELECT * FROM cases WHERE guild_id = ? AND number = ?').get(guildId, number);
const remove = (guildId, number) => db.prepare('DELETE FROM cases WHERE guild_id = ? AND number = ?').run(guildId, number);
const clearWarnings = (guildId, userId) =>
  db.prepare("DELETE FROM cases WHERE guild_id = ? AND user_id = ? AND action = 'warn'").run(guildId, userId).changes;

module.exports = { ACTIONS, create, forUser, byNumber, remove, clearWarnings };
