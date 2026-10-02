const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');

// Display order (matches the plugin list in the Sword dashboard design).
const ORDER = [
  'settings', 'protection', 'admin', 'welcome', 'logs',
  'activity', 'autorole', 'rolesassigner', 'tickets',
  'autoactions', 'counters', 'colors',
];

function loadPlugins() {
  const plugins = new Map();
  const commands = new Map();

  const ids = fs.readdirSync(PLUGINS_DIR).filter((d) => fs.existsSync(path.join(PLUGINS_DIR, d, 'index.js')));
  ids.sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));

  for (const dir of ids) {
    const plugin = require(path.join(PLUGINS_DIR, dir, 'index.js'));
    plugin.toggleable ??= true;
    plugin.commands ??= [];
    store.registerDefaults(plugin.id, plugin.defaults);
    plugins.set(plugin.id, plugin);
    for (const command of plugin.commands) {
      const name = command.data.name;
      if (commands.has(name)) throw new Error(`Duplicate command /${name} in ${plugin.id}`);
      command.plugin = plugin;
      commands.set(name, command);
    }
  }
  return { plugins, commands };
}

// Flattened command list (one entry per subcommand) for /help and the website.
function describeCommands(plugins) {
  const out = [];
  for (const plugin of plugins.values()) {
    for (const command of plugin.commands) {
      const json = command.data.toJSON();
      const subs = (json.options || []).flatMap((opt) => {
        if (opt.type === 2) return (opt.options || []).map((s) => ({ ...s, name: `${json.name} ${opt.name} ${s.name}` }));
        if (opt.type === 1) return [{ ...opt, name: `${json.name} ${opt.name}` }];
        return [];
      });
      const entries = subs.length ? subs : [{ ...json }];
      for (const entry of entries) {
        out.push({
          plugin: plugin.id,
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

const usage = (cmd) => `/${cmd.name}${cmd.options.map((o) => (o.required ? ` <${o.name}>` : ` [${o.name}]`)).join('')}`;

module.exports = { loadPlugins, describeCommands, usage };
