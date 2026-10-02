const { Guild, MessageFlags } = require('discord.js');
const store = require('./store');
const { reply, simple, emoji } = require('./theme');
const logger = require('./logger');
const { fromSlash } = require('./options');

function guildIdOf(args) {
  for (const arg of args) {
    if (!arg) continue;
    if (arg instanceof Guild) return arg.id;
    if (arg.guildId) return arg.guildId;
    if (arg.guild?.id) return arg.guild.id;
    if (arg.message?.guildId) return arg.message.guildId;
  }
  return null;
}

// Wire every plugin's events onto the client, skipping guilds that disabled the plugin.
function bindEvents(client) {
  const byEvent = new Map();
  for (const plugin of client.plugins.values()) {
    for (const [event, fn] of Object.entries(plugin.events || {})) {
      if (!byEvent.has(event)) byEvent.set(event, []);
      byEvent.get(event).push({ plugin, fn });
    }
  }
  for (const [event, handlers] of byEvent) {
    client.on(event, async (...args) => {
      const guildId = guildIdOf(args);
      for (const { plugin, fn } of handlers) {
        if (guildId && plugin.toggleable && !store.isEnabled(guildId, plugin.id)) continue;
        try {
          await fn(...args);
        } catch (err) {
          logger.error(`[${plugin.id}] ${event}:`, err);
        }
      }
    });
  }
}

async function handleInteraction(interaction) {
  const { client } = interaction;
  try {
    if (interaction.isChatInputCommand() || interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      // Plugins read English option names; translate the Arabic ones Discord sent.
      Object.defineProperty(interaction, 'options', { value: fromSlash(interaction), configurable: true });
      if (interaction.isAutocomplete()) return await command.autocomplete?.(interaction);

      if (!interaction.inCachedGuild()) {
        return reply.error(interaction, 'أوامر Sword تشتغل داخل السيرفر فقط.');
      }
      const { plugin } = command;
      if (plugin.toggleable && !store.isEnabled(interaction.guildId, plugin.id)) {
        return reply.error(interaction, `${plugin.emoji} **${plugin.nameAr}** مقفل حالياً. شغّله من \`/البلوقنات\`.`);
      }
      return await command.execute(interaction);
    }

    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      const [pluginId, action, ...args] = interaction.customId.split(':');
      const plugin = client.plugins.get(pluginId);
      const handler = plugin?.components?.[action];
      if (!handler) return;
      if (interaction.inGuild() && plugin.toggleable && !store.isEnabled(interaction.guildId, plugin.id)) {
        return reply.error(interaction, `${plugin.nameAr} مقفل حالياً.`);
      }
      return await handler(interaction, args);
    }
  } catch (err) {
    logger.error(`Interaction ${interaction.commandName || interaction.customId}:`, err);
    if (interaction.isAutocomplete()) return;
    const payload = { embeds: [simple(`${emoji.error} صار خطأ غير متوقع، حاول مرة ثانية.`, 'error')], flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch {
      /* interaction expired */
    }
  }
}

module.exports = { bindEvents, handleInteraction };
