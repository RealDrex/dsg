// Custom images uploaded from the dashboard (per server, per plugin, per key).
// Stored next to the database: data/images/<guildId>/<pluginId>/<key>.<ext>
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

const ROOT = path.join(path.dirname(path.resolve(config.dbPath)), 'images');
const TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const MAX_BYTES = 8 * 1024 * 1024;
const SAFE = /^[\w-]{1,40}$/;

// Detect the real format from magic bytes (never trust the upload's name/type).
function detect(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg';
  if (buffer.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const dir = (guildId, pluginId) => {
  if (![guildId, pluginId].every((s) => SAFE.test(s))) throw new Error('bad id');
  return path.join(ROOT, guildId, pluginId);
};

function find(guildId, pluginId, key) {
  if (!SAFE.test(key)) return null;
  for (const ext of Object.keys(TYPES)) {
    const file = path.join(dir(guildId, pluginId), `${key}.${ext}`);
    if (fs.existsSync(file)) return { file, ext, type: TYPES[ext] };
  }
  return null;
}

function remove(guildId, pluginId, key) {
  const found = find(guildId, pluginId, key);
  if (found) fs.unlinkSync(found.file);
  return !!found;
}

function save(guildId, pluginId, key, buffer) {
  if (!SAFE.test(key)) throw Object.assign(new Error('اسم غير صالح'), { userFacing: true });
  if (buffer.length > MAX_BYTES) throw Object.assign(new Error('الصورة أكبر من 8 ميقا'), { userFacing: true });
  const ext = detect(buffer);
  if (!ext) throw Object.assign(new Error('الصيغ المسموحة: PNG أو JPG أو GIF أو WEBP'), { userFacing: true });
  remove(guildId, pluginId, key);
  fs.mkdirSync(dir(guildId, pluginId), { recursive: true });
  fs.writeFileSync(path.join(dir(guildId, pluginId), `${key}.${ext}`), buffer);
  return ext;
}

module.exports = { find, save, remove, TYPES, MAX_BYTES };
