// Voice bots panel: add extra *bot* tokens that sit 24/7 in a voice channel.
// Admin only. Tokens are verified as bot tokens and stored encrypted (never shown again).
// UI is in English by request.
const crypto = require('node:crypto');
const {
  SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const store = require('../../core/store');
const config = require('../../config');
const { card, simple, emoji, reply } = require('../../core/theme');
const { I, asEmoji, setIcon } = require('../../core/icons');
const { register } = require('../../core/i18n');
const { encrypt } = require('../../core/secrets');
const logger = require('../../core/logger');
const manager = require('./manager');

register({ commands: { voicebots: 'بوتات_الفويس' } });

const MAX_BOTS = 25;
const SNOWFLAKE = /^\d{17,20}$/;
const TOKEN_SHAPE = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/;
const API = 'https://discord.com/api/v10';
const P = PermissionFlagsBits;

const cfgOf = (guildId) => store.get(guildId, 'voicebots');
const findBot = (guildId, id) => cfgOf(guildId).bots.find((b) => b.id === id);
const isAdmin = (i) => i.memberPermissions?.has(P.Administrator) || config.ownerIds.includes(i.user.id);
const eph = (content, components = []) => ({ content, components, flags: MessageFlags.Ephemeral });

const STATUS = {
  running: { label: 'Online', icon: 'on' },
  starting: { label: 'Starting...', icon: 'clock' },
  stopped: { label: 'Offline', icon: 'off' },
  error: { label: 'Error', icon: 'error' },
};
const statusLine = (bot) => {
  const s = manager.status(bot.id);
  const meta = STATUS[s.status] || STATUS.stopped;
  return `${I[meta.icon]} **${meta.label}**${s.error ? ` — ${s.error}` : ''}`;
};

// Discord API check with the candidate token (the token is only sent to Discord).
async function discord(token, route) {
  const res = await fetch(`${API}${route}`, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(8000) });
  return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null };
}

const inviteUrl = (botId, guildId) =>
  `https://discord.com/oauth2/authorize?client_id=${botId}&scope=bot&permissions=${P.ViewChannel | P.Connect}&guild_id=${guildId}&disable_guild_select=true`;

function panelPayload(guildId) {
  const bots = cfgOf(guildId).bots;
  const list = bots.map((b, n) => `\`${n + 1}\` **${b.name}** — <#${b.channelId}>\n${statusLine(b)}`).join('\n');
  const { content, files } = card({
    title: 'Voice Bots',
    icon: I.voice,
    description: `${list || '*No bots yet — press Add Token*'}`,
    image: 'banner',
    footer: `Sword • ${bots.length}/${MAX_BOTS}`,
  });
  return {
    content,
    files,
    components: [new ActionRowBuilder().addComponents(
      setIcon(new ButtonBuilder().setCustomId('voicebots:add').setLabel('Add Token').setStyle(ButtonStyle.Success), I.plus),
      setIcon(new ButtonBuilder().setCustomId('voicebots:control').setLabel('Control').setStyle(ButtonStyle.Primary), I.settings),
      setIcon(new ButtonBuilder().setCustomId('voicebots:delete').setLabel('Delete Token').setStyle(ButtonStyle.Danger), I.trash),
    )],
  };
}

function picker(customId, guildId, placeholder) {
  const bots = cfgOf(guildId).bots;
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .addOptions(bots.map((b) => {
      const s = STATUS[manager.status(b.id).status] || STATUS.stopped;
      return { label: b.name.slice(0, 100), value: b.id, description: `${s.label} • channel ${b.channelId}`.slice(0, 100), emoji: asEmoji(I[s.icon]) };
    })));
}

function controlView(guildId, bot) {
  const s = manager.status(bot.id);
  const running = s.status === 'running' || s.status === 'starting';
  const embed = simple([
    `${emoji.dot} <@${bot.botId}> — voice <#${bot.channelId}>`,
    `${emoji.dot} commands <#${bot.commandChannelId || bot.channelId}>`,
    `${emoji.dot} ${statusLine(bot)}`,
  ].join('\n'), 'primary', `${I.music} ${bot.name}`);
  return eph(embed, [new ActionRowBuilder().addComponents(
    setIcon(new ButtonBuilder().setCustomId(`voicebots:on:${bot.id}`).setLabel(running ? 'Restart' : 'Start').setStyle(ButtonStyle.Success), I.fast),
    setIcon(new ButtonBuilder().setCustomId(`voicebots:off:${bot.id}`).setLabel('Stop').setStyle(ButtonStyle.Secondary).setDisabled(!running), I.stop),
    setIcon(new ButtonBuilder().setCustomId(`voicebots:move:${bot.id}`).setLabel('Move').setStyle(ButtonStyle.Primary), I.voice),
    setIcon(new ButtonBuilder().setCustomId(`voicebots:refresh:${bot.id}`).setLabel('Refresh').setStyle(ButtonStyle.Secondary), I.history),
  )]);
}

async function refreshPanel(interaction) {
  const msg = interaction.message;
  if (msg && !msg.flags?.has(MessageFlags.Ephemeral)) await msg.edit({ ...panelPayload(interaction.guildId), files: undefined }).catch(() => null);
}

function update(guildId, id, patch) {
  store.update(guildId, 'voicebots', (cfg) => {
    const bot = cfg.bots.find((b) => b.id === id);
    if (bot) Object.assign(bot, patch);
  });
}

async function startBot(guildId, bot) {
  update(guildId, bot.id, { running: true });
  await manager.start(bot);
  // give the gateway a moment so the status shown is meaningful
  await new Promise((r) => setTimeout(r, 2500));
}

const guard = (fn) => async (interaction, args) => {
  if (!isAdmin(interaction)) return reply.error(interaction, 'This panel is for admins only.');
  return fn(interaction, args);
};

const command = {
  data: new SlashCommandBuilder()
    .setName('voicebots')
    .setDescription('لوحة بوتات الفويس: إضافة توكن بوت، تشغيله في روم، وحذفه')
    .setDefaultMemberPermissions(P.Administrator),
  async execute(interaction) {
    if (!isAdmin(interaction)) return reply.error(interaction, 'Admins only.');
    await interaction.reply(panelPayload(interaction.guildId));
  },
};

module.exports = {
  id: 'voicebots',
  name: 'Music Bots',
  nameAr: 'بوتات الأغاني',
  emoji: I.music,
  description: 'أضف بوتات أغاني (توكن + روم + اسم + أفتار) تقعد 24/7 وتشغّل أغاني بصوت صافي بأيقونات SVG — تُدار من الموقع.',
  defaults: { bots: [] },
  commands: [command],
  components: {
    add: guard(async (interaction) => {
      if (cfgOf(interaction.guildId).bots.length >= MAX_BOTS) return reply.error(interaction, `Max is ${MAX_BOTS} bots.`);
      const modal = new ModalBuilder().setCustomId('voicebots:addmodal').setTitle('Add Bot Token').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('token').setLabel('Bot Token')
          .setStyle(TextInputStyle.Short).setRequired(true).setMinLength(50).setMaxLength(120).setPlaceholder('Developer Portal -> Bot -> Reset Token')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guild').setLabel('Server ID')
          .setStyle(TextInputStyle.Short).setRequired(true).setMinLength(17).setMaxLength(20).setValue(interaction.guildId)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel').setLabel('Voice Channel ID (sits here 24/7)')
          .setStyle(TextInputStyle.Short).setRequired(true).setMinLength(17).setMaxLength(20)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cmdchannel').setLabel('Command/Music Text Channel ID')
          .setStyle(TextInputStyle.Short).setRequired(false).setMinLength(17).setMaxLength(20).setPlaceholder('روم أوامر الأغاني (اختياري)')),
      );
      return interaction.showModal(modal);
    }),

    addmodal: guard(async (interaction) => {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const token = interaction.fields.getTextInputValue('token').trim().replace(/^Bot\s+/i, '');
      const guildId = interaction.fields.getTextInputValue('guild').trim();
      const channelId = interaction.fields.getTextInputValue('channel').trim();
      const cmdChannelId = interaction.fields.getTextInputValue('cmdchannel').trim();
      if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(channelId)) return reply.error(interaction, 'Invalid server or channel ID.');
      if (cmdChannelId && !SNOWFLAKE.test(cmdChannelId)) return reply.error(interaction, 'Invalid command channel ID.');
      if (!TOKEN_SHAPE.test(token)) return reply.error(interaction, 'Invalid token format.');

      let me;
      try {
        me = await discord(token, '/users/@me');
      } catch {
        return reply.error(interaction, 'Could not reach Discord, try again in a bit.');
      }
      if (!me.ok || !me.body?.bot) return reply.error(interaction, 'Invalid token, or not a **bot token** — user/account tokens are not allowed.');
      if (me.body.id === interaction.client.user.id) return reply.error(interaction, "That's Sword's own token.");

      const inGuild = await discord(token, `/guilds/${guildId}`).catch(() => ({ ok: false }));
      if (!inGuild.ok) {
        return reply.info(interaction, `${I.warn} **${me.body.username}** is not in server \`${guildId}\`.\nInvite it here, then press Add Token again:\n${inviteUrl(me.body.id, guildId)}`);
      }
      const channel = await discord(token, `/channels/${channelId}`).catch(() => ({ ok: false }));
      if (!channel.ok || channel.body.guild_id !== guildId || ![2, 13].includes(channel.body.type)) {
        return reply.error(interaction, 'No voice channel with that ID in the server (or the bot cannot see it).');
      }

      const cfg = cfgOf(interaction.guildId);
      const existing = cfg.bots.find((b) => b.botId === me.body.id);
      const entry = {
        id: existing?.id || crypto.randomBytes(4).toString('hex'),
        botId: me.body.id,
        name: me.body.global_name || me.body.username,
        token: encrypt(token),
        guildId,
        channelId,
        commandChannelId: cmdChannelId || existing?.commandChannelId || null,
        volume: existing?.volume || 100,
        running: true,
        addedBy: interaction.user.id,
        addedAt: Date.now(),
      };
      store.update(interaction.guildId, 'voicebots', (c) => {
        c.bots = c.bots.filter((b) => b.botId !== entry.botId);
        c.bots.push(entry);
      });
      logger.info(`voice bot ${entry.name} added by ${interaction.user.tag}`);
      await startBot(interaction.guildId, entry);
      await refreshPanel(interaction);
      return interaction.editReply(controlView(interaction.guildId, entry));
    }),

    control: guard(async (interaction) => {
      if (!cfgOf(interaction.guildId).bots.length) return reply.error(interaction, 'No bots yet — add a token first.');
      return interaction.reply(eph(simple('Pick a bot to control.', 'primary', `${I.settings} Control`), [picker('voicebots:pick', interaction.guildId, 'Select a bot')]));
    }),

    pick: guard(async (interaction) => {
      const bot = findBot(interaction.guildId, interaction.values[0]);
      if (!bot) return reply.error(interaction, 'That bot is gone.');
      return interaction.update(controlView(interaction.guildId, bot));
    }),

    on: guard(async (interaction, [id]) => {
      const bot = findBot(interaction.guildId, id);
      if (!bot) return reply.error(interaction, 'That bot is gone.');
      await interaction.deferUpdate();
      await startBot(interaction.guildId, bot);
      await interaction.editReply(controlView(interaction.guildId, bot));
      await refreshPanel(interaction);
    }),

    off: guard(async (interaction, [id]) => {
      const bot = findBot(interaction.guildId, id);
      if (!bot) return reply.error(interaction, 'That bot is gone.');
      update(interaction.guildId, id, { running: false });
      await manager.stop(id);
      await interaction.update(controlView(interaction.guildId, bot));
    }),

    refresh: guard(async (interaction, [id]) => {
      const bot = findBot(interaction.guildId, id);
      if (!bot) return reply.error(interaction, 'That bot is gone.');
      return interaction.update(controlView(interaction.guildId, bot));
    }),

    move: guard(async (interaction, [id]) => {
      const bot = findBot(interaction.guildId, id);
      if (!bot) return reply.error(interaction, 'That bot is gone.');
      return interaction.showModal(new ModalBuilder().setCustomId(`voicebots:movemodal:${id}`).setTitle(`Move ${bot.name}`.slice(0, 45)).addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel').setLabel('New Voice Channel ID')
          .setStyle(TextInputStyle.Short).setRequired(true).setMinLength(17).setMaxLength(20).setValue(bot.channelId)),
      ));
    }),

    movemodal: guard(async (interaction, [id]) => {
      const bot = findBot(interaction.guildId, id);
      if (!bot) return reply.error(interaction, 'That bot is gone.');
      const channelId = interaction.fields.getTextInputValue('channel').trim();
      if (!SNOWFLAKE.test(channelId)) return reply.error(interaction, 'Invalid ID.');
      await interaction.deferUpdate();
      update(interaction.guildId, id, { channelId });
      const fresh = findBot(interaction.guildId, id);
      await startBot(interaction.guildId, fresh);
      await interaction.editReply(controlView(interaction.guildId, fresh));
    }),

    delete: guard(async (interaction) => {
      if (!cfgOf(interaction.guildId).bots.length) return reply.error(interaction, 'No bots.');
      return interaction.reply(eph(simple('Pick a bot to delete (it leaves the channel).', 'accent', `${I.trash} Delete Token`), [picker('voicebots:remove', interaction.guildId, 'Select a bot to delete')]));
    }),

    remove: guard(async (interaction) => {
      const bot = findBot(interaction.guildId, interaction.values[0]);
      if (!bot) return reply.error(interaction, 'That bot is gone.');
      await manager.stop(bot.id);
      store.update(interaction.guildId, 'voicebots', (c) => { c.bots = c.bots.filter((b) => b.id !== bot.id); });
      logger.info(`voice bot ${bot.name} removed by ${interaction.user.tag}`);
      return interaction.update(eph(simple(`${I.success} Deleted **${bot.name}** and wiped its token.`, 'success'), []));
    }),
  },
  actions: {
    startAll: {
      label: 'تشغيل كل البوتات',
      async run(guild) {
        const bots = cfgOf(guild.id).bots;
        for (const b of bots) await startBot(guild.id, b);
        return `تم تشغيل ${bots.length} بوت`;
      },
    },
    stopAll: {
      label: 'إيقاف كل البوتات',
      danger: true,
      async run(guild) {
        const bots = cfgOf(guild.id).bots;
        for (const b of bots) {
          update(guild.id, b.id, { running: false });
          await manager.stop(b.id);
        }
        return `تم إيقاف ${bots.length} بوت`;
      },
    },
  },
  dashboard: [
    {
      title: 'بوتات الفويس',
      icon: 'voice',
      description: 'إضافة التوكنات والتحكم (تشغيل/موسيقى) من ديسكورد بالأمر /بوتات_الفويس (عشان التوكن ما يمر بالموقع). زر Play Music يشغّل من يوتيوب بصوت صافي بدون عوازل. من هنا تشغل/توقف الكل من تبويب الإجراءات.',
      fields: [],
    },
  ],
  // Bring back every bot that was running before a restart.
  async ready(client) {
    for (const guild of client.guilds.cache.values()) {
      for (const bot of cfgOf(guild.id).bots.filter((b) => b.running)) {
        manager.start(bot).catch((err) => logger.warn(`voice bot ${bot.name}:`, err.message));
      }
    }
  },
};
