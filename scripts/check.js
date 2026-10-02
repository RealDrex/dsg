// Loads every plugin and validates all slash command definitions without connecting to Discord.
process.env.DB_PATH = process.env.DB_PATH || ':memory:';
const { loadPlugins, describeCommands } = require('../src/core/loader');

const { plugins, commands } = loadPlugins();
let errors = 0;
for (const command of commands.values()) {
  try {
    const json = command.data.toJSON();
    if (JSON.stringify(json).length > 8000) throw new Error('command JSON exceeds 8000 chars');
  } catch (err) {
    errors += 1;
    console.error(`✖ /${command.data.name}: ${err.message}`);
  }
}
if (commands.size > 100) {
  errors += 1;
  console.error(`✖ ${commands.size} top-level commands (Discord limit is 100)`);
}
const all = describeCommands(plugins);
for (const plugin of plugins.values()) {
  console.log(`${plugin.emoji}  ${plugin.nameAr.padEnd(32)} ${String(plugin.commands.length).padStart(2)} commands, ${all.filter((c) => c.plugin === plugin.id).length} total`);
}
console.log(`\n${plugins.size} plugins • ${commands.size} slash commands • ${all.length} subcommands`);
if (errors) process.exit(1);
console.log('✔ all good');
