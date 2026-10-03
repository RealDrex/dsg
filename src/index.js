const { Client, GatewayIntentBits, Partials, ActivityType, Events } = require('discord.js');
const config = require('./config');
const logger = require('./core/logger');
const { loadPlugins } = require('./core/loader');
const { bindEvents, handleInteraction } = require('./core/handler');
const { handlePrefix } = require('./core/prefix');
const icons = require('./core/icons');
const updater = require('./core/updater');
const path = require('node:path');

// Exit code 78 = configuration problem: start.bat stops instead of restarting.
const CONFIG_ERROR = 78;

if (!config.token) {
  logger.error('DISCORD_TOKEN مو موجود — افتح ملف .env وحط التوكن (أو شغّل install.bat).');
  process.exit(CONFIG_ERROR);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User],
  allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
});

const { plugins, commands, aliases } = loadPlugins();
client.plugins = plugins;
client.commands = commands;
client.aliases = aliases;

bindEvents(client);
client.on(Events.InteractionCreate, handleInteraction);
client.on(Events.MessageCreate, handlePrefix);

client.once(Events.ClientReady, async () => {
  logger.info(`⚔️  ${client.user.tag} جاهز — ${plugins.size} قسم، ${commands.size} أمر، ${client.guilds.cache.size} سيرفر`);
  client.user.setPresence({ activities: [{ name: 'Sword • /مساعدة', type: ActivityType.Watching }], status: 'online' });
  try {
    await icons.sync(client, { dataDir: path.dirname(path.resolve(config.dbPath)) });
  } catch (err) {
    logger.warn('تعذر رفع الأيقونات:', err.message);
  }
  updater.schedule(client);
  for (const plugin of plugins.values()) {
    try {
      await plugin.ready?.(client);
    } catch (err) {
      logger.error(`[${plugin.id}] ready:`, err);
    }
  }
});

if (config.web.enabled) require('./web/server').start(client);

process.on('unhandledRejection', (err) => logger.error('Unhandled rejection:', err));
client.login(config.token).catch((err) => {
  logger.error('فشل تسجيل دخول البوت — تأكد من DISCORD_TOKEN وتفعيل Intents في Developer Portal:', err.message);
  process.exit(CONFIG_ERROR);
});
