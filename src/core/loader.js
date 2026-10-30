const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const { translateCommand, normalize, commandEn } = require('./i18n');

const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');

// Display order (matches the plugin list in the Sword dashboard design).
const ORDER = [
  'settings', 'protection', 'admin', 'staff', 'welcome', 'logs',
  'autorole', 'rolesassigner', 'tickets', 'activation',
  'autoactions', 'counters', 'colors', 'games', 'voicebots', 'tempvoice', 'autoclean',
];

/**
 * plugins:  Map<pluginId, plugin>
 * commands: Map<arabicName, command>   (what Discord sends)
 * aliases:  Map<normalizedName, command> (Arabic + English, for prefix use)
 * Each command gets `json` (Arabic, ready to register) and `key` (English name).
 */
function loadPlugins() {
  const plugins = new Map();
  const commands = new Map();
  const aliases = new Map();

  const ids = fs.readdirSync(PLUGINS_DIR).filter((d) => fs.existsSync(path.join(PLUGINS_DIR, d, 'index.js')));
  ids.sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));

  for (const dir of ids) {
    const plugin = require(path.join(PLUGINS_DIR, dir, 'index.js'));
    plugin.toggleable ??= true;
    plugin.commands ??= [];
    store.registerDefaults(plugin.id, plugin.defaults);
    plugins.set(plugin.id, plugin);
    for (const command of plugin.commands) {
      command.plugin = plugin;
      command.key = command.data.name;
      command.json = translateCommand(command.data.toJSON());
      if (commands.has(command.json.name)) throw new Error(`Duplicate command /${command.json.name} in ${plugin.id}`);
      commands.set(command.json.name, command);
      for (const alias of [command.json.name, command.key, ...(command.aliases || [])]) aliases.set(normalize(alias), command);
    }
  }
  return { plugins, commands, aliases };
}

// Flattened command list (one entry per subcommand) for /help and the website.
function describeCommands(plugins) {
  const out = [];
  for (const plugin of plugins.values()) {
    for (const command of plugin.commands) {
      const { json } = command;
      const subs = (json.options || []).flatMap((opt) => {
        if (opt.type === 2) return (opt.options || []).map((s) => ({ ...s, name: `${json.name} ${opt.name} ${s.name}` }));
        if (opt.type === 1) return [{ ...opt, name: `${json.name} ${opt.name}` }];
        return [];
      });
      const entries = subs.length ? subs : [{ ...json }];
      for (const entry of entries) {
        out.push({
          plugin: plugin.id,
          key: commandEn(json.name),
          name: entry.name,
          description: entry.description,
          options: (entry.options || []).filter((o) => o.type > 2).map((o) => ({ name: o.name, required: !!o.required })),
          staff: json.default_member_permissions != null,
        });
      }
    }
  }
  return out;
}

const usage = (cmd, prefix = '/') => `${prefix}${cmd.name}${cmd.options.map((o) => (o.required ? ` <${o.name}>` : ` [${o.name}]`)).join('')}`;

module.exports = { loadPlugins, describeCommands, usage };
