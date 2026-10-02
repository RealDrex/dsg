// Registers slash commands. With GUILD_ID they appear instantly in that server.
const { REST, Routes } = require('discord.js');
const config = require('./config');
const logger = require('./core/logger');
const { loadPlugins } = require('./core/loader');

(async () => {
  if (!config.token || !config.clientId) {
    logger.error('لازم DISCORD_TOKEN و CLIENT_ID في .env');
    process.exit(1);
  }
  const { commands } = loadPlugins();
  const body = [...commands.values()].map((c) => c.json);
  const rest = new REST().setToken(config.token);
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body });
  logger.info(`تم تسجيل ${body.length} أمر ${config.guildId ? 'في السيرفر' : 'جلوبال (قد تاخذ حتى ساعة)'} ⚔️`);
})().catch((err) => {
  logger.error(err);
  process.exit(1);
});
