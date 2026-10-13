// Storage for the activation system: one open ticket row per channel so the
// "تفعيل" button knows whose SOWRD role to lift.
const db = require('../../core/db');

db.exec(`
  CREATE TABLE IF NOT EXISTS activation_tickets (
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    owner_id   TEXT NOT NULL,
    number     INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, channel_id)
  );
`);

const stmt = {
  insert: db.prepare('INSERT INTO activation_tickets (guild_id, channel_id, owner_id, number, created_at) VALUES (?, ?, ?, ?, ?)'),
  byChannel: db.prepare('SELECT * FROM activation_tickets WHERE channel_id = ?'),
  openForOwner: db.prepare('SELECT * FROM activation_tickets WHERE guild_id = ? AND owner_id = ?'),
  del: db.prepare('DELETE FROM activation_tickets WHERE channel_id = ?'),
};

module.exports = {
  open: (g, c, owner, number) => stmt.insert.run(g, c, owner, number, Date.now()),
  byChannel: (c) => stmt.byChannel.get(c),
  openForOwner: (g, u) => stmt.openForOwner.all(g, u),
  close: (c) => stmt.del.run(c),
};
