// Storage for the interactive-staff plugin: jail snapshots (to restore roles on
// release), the blacklist, ticket-open blocks, and invite counts.
const db = require('../../core/db');

db.exec(`
  CREATE TABLE IF NOT EXISTS staff_jail (
    guild_id  TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    roles     TEXT NOT NULL,
    jailed_by TEXT,
    reason    TEXT,
    at        INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS staff_blacklist (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    by_id    TEXT,
    reason   TEXT,
    at       INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS staff_tblock (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    by_id    TEXT,
    at       INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS staff_invites (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    invites  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
`);

const stmt = {
  jailSet: db.prepare('INSERT INTO staff_jail (guild_id, user_id, roles, jailed_by, reason, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET roles = excluded.roles, jailed_by = excluded.jailed_by, reason = excluded.reason, at = excluded.at'),
  jailGet: db.prepare('SELECT * FROM staff_jail WHERE guild_id = ? AND user_id = ?'),
  jailDel: db.prepare('DELETE FROM staff_jail WHERE guild_id = ? AND user_id = ?'),

  blSet: db.prepare('INSERT INTO staff_blacklist (guild_id, user_id, by_id, reason, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET by_id = excluded.by_id, reason = excluded.reason, at = excluded.at'),
  blGet: db.prepare('SELECT * FROM staff_blacklist WHERE guild_id = ? AND user_id = ?'),
  blDel: db.prepare('DELETE FROM staff_blacklist WHERE guild_id = ? AND user_id = ?'),

  tbSet: db.prepare('INSERT INTO staff_tblock (guild_id, user_id, by_id, at) VALUES (?, ?, ?, ?) ON CONFLICT (guild_id, user_id) DO NOTHING'),
  tbGet: db.prepare('SELECT * FROM staff_tblock WHERE guild_id = ? AND user_id = ?'),
  tbDel: db.prepare('DELETE FROM staff_tblock WHERE guild_id = ? AND user_id = ?'),

  invInc: db.prepare('INSERT INTO staff_invites (guild_id, user_id, invites) VALUES (?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET invites = MAX(0, invites + ?)'),
  invGet: db.prepare('SELECT invites FROM staff_invites WHERE guild_id = ? AND user_id = ?'),
  invTop: db.prepare('SELECT user_id, invites FROM staff_invites WHERE guild_id = ? AND invites > 0 ORDER BY invites DESC LIMIT ?'),
};

module.exports = {
  // Jail
  jailSave: (g, u, roles, by, reason) => stmt.jailSet.run(g, u, JSON.stringify(roles), by, reason, Date.now()),
  jailGet: (g, u) => {
    const row = stmt.jailGet.get(g, u);
    return row ? { ...row, roles: JSON.parse(row.roles) } : null;
  },
  jailClear: (g, u) => stmt.jailDel.run(g, u),

  // Blacklist
  blAdd: (g, u, by, reason) => stmt.blSet.run(g, u, by, reason, Date.now()),
  blGet: (g, u) => stmt.blGet.get(g, u),
  blRemove: (g, u) => stmt.blDel.run(g, u).changes,

  // Ticket block
  tblock: (g, u, by) => stmt.tbSet.run(g, u, by, Date.now()),
  tblocked: (g, u) => !!stmt.tbGet.get(g, u),
  tunblock: (g, u) => stmt.tbDel.run(g, u).changes,

  // Invites
  inviteAdd: (g, u, n = 1) => stmt.invInc.run(g, u, n, n),
  inviteCount: (g, u) => stmt.invGet.get(g, u)?.invites || 0,
  inviteTop: (g, limit = 10) => stmt.invTop.all(g, limit),
};
