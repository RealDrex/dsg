const { Client, GatewayIntentBits, Partials, ActivityType, Events } = require('discord.js');
const config = require('./config');
const logger = require('./core/logger');
const { loadPlugins } = require('./core/loader');
const { bindEvents, handleInteraction } = require('./core/handler');
const { handlePrefix } = require('./core/prefix');

if (!config.token) {
  logger.error('DISCORD_TOKEN مو موجود. انسخ .env.example إلى .env وحط التوكن.');
  process.exit(1);
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
  logger.info(`⚔️  ${client.user.tag} جاهز — ${plugins.size} بلوقن، ${commands.size} أمر، ${client.guilds.cache.size} سيرفر`);
  client.user.setPresence({ activities: [{ name: 'Sword ⚔️ /مساعدة', type: ActivityType.Watching }], status: 'online' });
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
client.login(config.token);
