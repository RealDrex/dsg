// Loads every plugin and validates all (Arabic) slash command definitions without connecting to Discord.
process.env.DB_PATH = process.env.DB_PATH || ':memory:';
const { loadPlugins, describeCommands, usage } = require('../src/core/loader');

// Discord's rule for command/option names.
const NAME_RE = /^[-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

const { plugins, commands } = loadPlugins();
let errors = 0;
const fail = (msg) => {
  errors += 1;
  console.error(`✖ ${msg}`);
};

function checkOptions(where, options = []) {
  const seen = new Set();
  for (const opt of options) {
    if (!NAME_RE.test(opt.name) || opt.name !== opt.name.toLowerCase()) fail(`${where}: invalid name "${opt.name}"`);
    if (/^[a-z_]+$/.test(opt.name)) fail(`${where}: "${opt.name}" has no Arabic translation`);
    if (seen.has(opt.name)) fail(`${where}: duplicate option "${opt.name}"`);
    seen.add(opt.name);
    if (opt.options) checkOptions(`${where} ${opt.name}`, opt.options);
  }
}

for (const command of commands.values()) {
  const { json } = command;
  try {
    command.data.toJSON();
  } catch (err) {
    fail(`/${command.key}: ${err.message}`);
  }
  if (!NAME_RE.test(json.name)) fail(`/${command.key}: invalid Arabic name "${json.name}"`);
  if (/^[a-z_]+$/.test(json.name)) fail(`/${command.key}: no Arabic translation`);
  if (JSON.stringify(json).length > 8000) fail(`/${json.name}: command JSON exceeds 8000 chars`);
  checkOptions(`/${json.name}`, json.options);
}
if (commands.size > 100) fail(`${commands.size} top-level commands (Discord limit is 100)`);

const all = describeCommands(plugins);
for (const plugin of plugins.values()) {
  console.log(`${plugin.emoji}  ${plugin.nameAr.padEnd(32)} ${String(plugin.commands.length).padStart(2)} commands, ${all.filter((c) => c.plugin === plugin.id).length} total`);
}
console.log(`\nأمثلة: ${all.slice(7, 10).map((c) => usage(c)).join('  |  ')}`);
console.log(`${plugins.size} plugins • ${commands.size} slash commands • ${all.length} subcommands`);
if (errors) process.exit(1);
console.log('✔ all good');
