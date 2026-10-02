// Per-guild, per-plugin JSON config with defaults and an in-memory cache.
const db = require('./db');

const cache = new Map();
const defaults = new Map();

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(base, stored) {
  if (!isObject(base)) return stored === undefined ? structuredClone(base) : stored;
  const out = {};
  for (const key of Object.keys(base)) out[key] = merge(base[key], stored?.[key]);
  if (isObject(stored)) for (const key of Object.keys(stored)) if (!(key in out)) out[key] = stored[key];
  return out;
}

const selectStmt = db.prepare('SELECT data FROM config WHERE guild_id = ? AND plugin = ?');
const upsertStmt = db.prepare(`
  INSERT INTO config (guild_id, plugin, data) VALUES (?, ?, ?)
  ON CONFLICT (guild_id, plugin) DO UPDATE SET data = excluded.data
`);

function registerDefaults(plugin, value) {
  defaults.set(plugin, value || {});
}

function get(guildId, plugin) {
  const key = `${guildId}:${plugin}`;
  if (cache.has(key)) return cache.get(key);
  const row = selectStmt.get(guildId, plugin);
  const value = merge(defaults.get(plugin) || {}, row ? JSON.parse(row.data) : undefined);
  cache.set(key, value);
  return value;
}

function save(guildId, plugin, value) {
  cache.set(`${guildId}:${plugin}`, value);
  upsertStmt.run(guildId, plugin, JSON.stringify(value));
  return value;
}

function update(guildId, plugin, mutate) {
  const value = get(guildId, plugin);
  mutate(value);
  return save(guildId, plugin, value);
}

// Plugin on/off state lives in the "core" config.
registerDefaults('core', { disabled: [], prefix: '!' });

const isEnabled = (guildId, pluginId) => !get(guildId, 'core').disabled.includes(pluginId);

function setEnabled(guildId, pluginId, enabled) {
  update(guildId, 'core', (cfg) => {
    cfg.disabled = cfg.disabled.filter((id) => id !== pluginId);
    if (!enabled) cfg.disabled.push(pluginId);
  });
}

module.exports = { registerDefaults, get, save, update, isEnabled, setEnabled };
