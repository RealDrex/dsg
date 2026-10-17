// Tracks temporary voice rooms created by the "join to create" channel so the
// control panel knows each room's owner and empty rooms can be cleaned up.
const db = require('../../core/db');

db.exec(`
  CREATE TABLE IF NOT EXISTS temp_rooms (
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    owner_id   TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, channel_id)
  );

  CREATE TABLE IF NOT EXISTS room_claims (
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    owner_id   TEXT NOT NULL,
    PRIMARY KEY (guild_id, channel_id)
  );

  CREATE TABLE IF NOT EXISTS room_denies (
    channel_id TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    PRIMARY KEY (channel_id, user_id)
  );
`);

const stmt = {
  add: db.prepare('INSERT OR REPLACE INTO temp_rooms (guild_id, channel_id, owner_id, created_at) VALUES (?, ?, ?, ?)'),
  byChannel: db.prepare('SELECT * FROM temp_rooms WHERE channel_id = ?'),
  byOwner: db.prepare('SELECT * FROM temp_rooms WHERE guild_id = ? AND owner_id = ?'),
  setOwner: db.prepare('UPDATE temp_rooms SET owner_id = ? WHERE channel_id = ?'),
  del: db.prepare('DELETE FROM temp_rooms WHERE channel_id = ?'),
  all: db.prepare('SELECT * FROM temp_rooms WHERE guild_id = ?'),

  claimSet: db.prepare('INSERT OR REPLACE INTO room_claims (guild_id, channel_id, owner_id) VALUES (?, ?, ?)'),
  claimGet: db.prepare('SELECT owner_id FROM room_claims WHERE channel_id = ?'),
  claimDel: db.prepare('DELETE FROM room_claims WHERE channel_id = ?'),

  denyAdd: db.prepare('INSERT OR IGNORE INTO room_denies (channel_id, user_id) VALUES (?, ?)'),
  denyDel: db.prepare('DELETE FROM room_denies WHERE channel_id = ? AND user_id = ?'),
  denyHas: db.prepare('SELECT 1 FROM room_denies WHERE channel_id = ? AND user_id = ?'),
  denyClear: db.prepare('DELETE FROM room_denies WHERE channel_id = ?'),
};

module.exports = {
  add: (g, c, owner) => stmt.add.run(g, c, owner, Date.now()),
  byChannel: (c) => stmt.byChannel.get(c),
  byOwner: (g, u) => stmt.byOwner.get(g, u),
  setOwner: (c, owner) => stmt.setOwner.run(owner, c),
  remove: (c) => stmt.del.run(c),
  all: (g) => stmt.all.all(g),

  // Manually-claimed room ownership (أمر انشاء ملكيه)
  claimSet: (g, c, owner) => stmt.claimSet.run(g, c, owner),
  claimOwner: (c) => stmt.claimGet.get(c)?.owner_id || null,
  claimDel: (c) => { stmt.claimDel.run(c); stmt.denyClear.run(c); },

  // Denied users for a claimed room (kicked on sight if they bypass)
  denyAdd: (c, u) => stmt.denyAdd.run(c, u),
  denyDel: (c, u) => stmt.denyDel.run(c, u),
  denyHas: (c, u) => !!stmt.denyHas.get(c, u),
};
