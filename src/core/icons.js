// Sword icons inside Discord. Every PNG in assets/icons is uploaded once as an
// application emoji (shared by every server the bot is in, no slots used) and
// referenced as <:sw_name:id>. `I.lock` is a lazy handle:
//   `${I.lock}`      → "<:sw_lock:123…>" in message/embed text
//   asEmoji(I.lock)  → { id, name } for buttons and select menus
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const LIST = require('./icon-list');
const logger = require('./logger');

const DIR = path.join(__dirname, '..', '..', 'assets', 'icons');
const PREFIX = 'sw_';
const loaded = new Map(); // name -> { id, name }

class Icon {
  constructor(key) {
    this.key = key;
  }
  get ready() { return loaded.has(this.key); }
  toString() {
    const e = loaded.get(this.key);
    return e ? `<:${e.name}:${e.id}>` : '';
  }
  toJSON() { return asEmoji(this); }
}

const handles = {};
// Sets a button's emoji only once the icon exists on Discord.
function setIcon(builder, value) {
  const e = asEmoji(value);
  if (e) builder.setEmoji(e);
  return builder;
}

const isIcon = (value) => typeof value === 'string' && Object.hasOwn(handles, value);
for (const key of Object.keys(LIST)) handles[key] = new Icon(key);

// Unknown names throw early instead of silently rendering nothing.
const I = new Proxy(handles, {
  get(target, key) {
    if (typeof key !== 'string' || Object.hasOwn(target, key)) return target[key];
    if (key === 'then' || key === 'toJSON' || key.startsWith('__')) return undefined;
    throw new Error(`Unknown icon "${key}"`);
  },
});

/** Component emoji ({id,name}) from an Icon, an icon name, or a user-typed emoji string. */
function asEmoji(value) {
  if (!value) return undefined;
  if (value instanceof Icon) {
    const e = loaded.get(value.key);
    return e ? { id: e.id, name: e.name } : undefined;
  }
  if (isIcon(value)) return asEmoji(handles[value]);
  return value;
}

/** Text form of an Icon / icon name / user emoji. */
function text(value) {
  if (!value) return '';
  if (value instanceof Icon) return String(value);
  if (isIcon(value)) return String(handles[value]);
  return String(value);
}


// Uploads missing or changed icons; a small hash file tracks what's on Discord.
async function sync(client, { dataDir = 'data' } = {}) {
  const hashFile = path.join(dataDir, 'icons.json');
  let hashes = {};
  try {
    hashes = JSON.parse(fs.readFileSync(hashFile, 'utf8'));
  } catch { /* first run */ }

  const manager = client.application.emojis;
  const existing = await manager.fetch();
  let uploaded = 0;
  for (const key of Object.keys(LIST)) {
    const file = path.join(DIR, `${key}.png`);
    if (!fs.existsSync(file)) continue;
    const name = `${PREFIX}${key}`.slice(0, 32);
    const hash = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
    let found = existing.find((e) => e.name === name);
    if (found && hashes[key] && hashes[key] !== hash) {
      await found.delete().catch(() => null);
      found = null;
    }
    if (!found) {
      try {
        found = await manager.create({ attachment: file, name });
        uploaded += 1;
      } catch (err) {
        logger.warn(`icon ${key}: ${err.message}`);
        continue;
      }
    }
    hashes[key] = hash;
    loaded.set(key, { id: found.id, name });
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(hashFile, JSON.stringify(hashes, null, 2));
  logger.info(`🎨 الأيقونات جاهزة: ${loaded.size}/${Object.keys(LIST).length}${uploaded ? ` (رفعت ${uploaded} جديدة)` : ''}`);
}

module.exports = { I, Icon, asEmoji, setIcon, text, isIcon, sync, LIST };
