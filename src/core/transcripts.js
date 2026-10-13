// Stores ticket/activation HTML transcripts so they can be opened as a web link
// (served by the site at /t/:id) instead of a downloadable file.
const db = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS transcripts (
    id         TEXT PRIMARY KEY,
    html       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

const stmt = {
  put: db.prepare('INSERT OR REPLACE INTO transcripts (id, html, created_at) VALUES (?, ?, ?)'),
  get: db.prepare('SELECT html FROM transcripts WHERE id = ?'),
};

module.exports = {
  save: (id, html) => stmt.put.run(id, html, Date.now()),
  get: (id) => stmt.get.get(id)?.html || null,
};
