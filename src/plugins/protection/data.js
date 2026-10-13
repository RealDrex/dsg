// Per-user spam offense counter for the escalating anti-spam ladder.
// Offenses decay after a quiet period so a one-off months later starts fresh.
const db = require('../../core/db');

db.exec(`
  CREATE TABLE IF NOT EXISTS spam_strikes (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    strikes  INTEGER NOT NULL DEFAULT 0,
    at       INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
`);

const DECAY_MS = 24 * 60 * 60 * 1000; // 24h of good behaviour resets the ladder

const stmt = {
  get: db.prepare('SELECT strikes, at FROM spam_strikes WHERE guild_id = ? AND user_id = ?'),
  set: db.prepare('INSERT INTO spam_strikes (guild_id, user_id, strikes, at) VALUES (?, ?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET strikes = excluded.strikes, at = excluded.at'),
  del: db.prepare('DELETE FROM spam_strikes WHERE guild_id = ? AND user_id = ?'),
};

module.exports = {
  // Bump and return the current offense number (1-based).
  bump: (g, u) => {
    const now = Date.now();
    const row = stmt.get.get(g, u);
    const base = row && (now - row.at) < DECAY_MS ? row.strikes : 0;
    const next = base + 1;
    stmt.set.run(g, u, next, now);
    return next;
  },
  reset: (g, u) => stmt.del.run(g, u),
};
