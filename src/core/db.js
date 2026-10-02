const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

// node:sqlite is stable enough for our use; hide the experimental notice only.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  const text = typeof warning === 'string' ? warning : warning?.message;
  if (text && text.includes('SQLite')) return;
  return emitWarning.call(process, warning, ...args);
};
const { DatabaseSync } = require('node:sqlite');

const file = config.dbPath === ':memory:' ? ':memory:' : path.resolve(config.dbPath);
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

const db = new DatabaseSync(file);
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS config (
    guild_id TEXT NOT NULL,
    plugin   TEXT NOT NULL,
    data     TEXT NOT NULL,
    PRIMARY KEY (guild_id, plugin)
  );

  CREATE TABLE IF NOT EXISTS cases (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    number     INTEGER NOT NULL,
    action     TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    mod_id     TEXT NOT NULL,
    reason     TEXT,
    duration   INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cases_user ON cases (guild_id, user_id);

  CREATE TABLE IF NOT EXISTS levels (
    guild_id      TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    xp            INTEGER NOT NULL DEFAULT 0,
    level         INTEGER NOT NULL DEFAULT 0,
    messages      INTEGER NOT NULL DEFAULT 0,
    voice_minutes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL UNIQUE,
    owner_id   TEXT NOT NULL,
    number     INTEGER NOT NULL,
    type       TEXT,
    claimed_by TEXT,
    status     TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    closed_at  INTEGER
  );
`);

module.exports = db;
