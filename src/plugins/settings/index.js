const {
  SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder,
  MessageFlags, ChannelType, version: djsVersion,
} = require('discord.js');
const store = require('../../core/store');
const { card, simple, emoji, DIVIDER, reply } = require('../../core/theme');
const { describeCommands, usage } = require('../../core/loader');
const { ts } = require('../../utils/time');
const { truncate } = require('../../utils/text');

let commandIndex = null;
const prefixOf = (interaction) => store.get(interaction.guildId, 'core').prefix || '!';
const commandsOf = (client, pluginId) => {
  commandIndex ??= describeCommands(client.plugins);
  return commandIndex.filter((c) => c.plugin === pluginId);
};

function helpMenu(client, selected) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('settings:help')
    .setPlaceholder('⚔️ اختر البلوقن لعرض أوامره')
    .addOptions(
      [...client.plugins.values()].map((p) => ({
        label: p.nameAr,
        description: truncate(p.description, 100),
        value: p.id,
        emoji: p.emoji,
        default: p.id === selected,
      })),
    );
  return new ActionRowBuilder().addComponents(menu);
}

function helpHome(interaction) {
  const { client } = interaction;
  const list = [...client.plugins.values()]
    .map((p) => {
      const state = !p.toggleable || store.isEnabled(interaction.guildId, p.id) ? emoji.on : emoji.off;
      return `${state} ${p.emoji} **${p.nameAr}** — \`${commandsOf(client, p.id).length}\` أمر`;
    })
    .join('\n');
  const { embed, files } = card({
    title: `${emoji.sword} Sword — قائمة الأوامر`,
    description: `أهلاً بك في بوت **Sword** ${emoji.gate}\nاختر بلوقن من القائمة تحت عشان تشوف أوامره بالتفصيل.\n${DIVIDER}\n${list}\n${DIVIDER}\n⌨️ كل أمر يشتغل بالسلاش \`/\` أو بالبريفكس \`${prefixOf(interaction)}\`\nمثال: \`${prefixOf(interaction)}باند @عضو السبب\`\n\`<>\` إجباري  •  \`[]\` اختياري`,
    image: 'banner',
  });
  return { embeds: [embed], files, components: [helpMenu(client)] };
}

function helpPlugin(interaction, pluginId) {
  const { client } = interaction;
  const plugin = client.plugins.get(pluginId);
  const lines = commandsOf(client, pluginId).map((c) => `${emoji.dot} \`${usage(c)}\`\n${c.description}`);
  lines.unshift(`البريفكس: \`${prefixOf(interaction)}\` — مثال: \`${prefixOf(interaction)}${commandsOf(client, pluginId)[0]?.name || ''}\``);
  const { embed, files } = card({
    title: `${plugin.emoji} ${plugin.nameAr}`,
    description: `${plugin.description}\n${DIVIDER}\n${truncate(lines.join('\n\n'), 3800) || 'ما فيه أوامر.'}`,
    image: 'line',
    footer: `${plugin.name} • Sword`,
  });
  return { embeds: [embed], files, components: [helpMenu(client, pluginId)], attachments: [] };
}

function pluginsPanel(interaction) {
  const { client, guildId } = interaction;
  const toggleable = [...client.plugins.values()].filter((p) => p.toggleable);
  const list = toggleable
    .map((p) => `${store.isEnabled(guildId, p.id) ? emoji.on : emoji.off} ${p.emoji} **${p.nameAr}** \`@${p.name}\``)
    .join('\n');
  const menu = new StringSelectMenuBuilder()
    .setCustomId('settings:plugins')
    .setPlaceholder('حدد البلوقنات اللي تبيها شغالة')
    .setMinValues(0)
    .setMaxValues(toggleable.length)
    .addOptions(
      toggleable.map((p) => ({
        label: p.nameAr,
        value: p.id,
        emoji: p.emoji,
        description: p.name,
        default: store.isEnabled(guildId, p.id),
      })),
    );
  const { embed, files } = card({
    title: `${emoji.gate} إدارة البلوقنات`,
    description: `فعّل أو عطّل أي بلوقن من القائمة.\nالمحدد = شغال ${emoji.on}  •  غير المحدد = مقفل ${emoji.off}\n${DIVIDER}\n${list}`,
  });
  return { embeds: [embed], files, components: [new ActionRowBuilder().addComponents(menu)], attachments: [] };
}

const commands = [
  {
    data: new SlashCommandBuilder().setName('help').setDescription('قائمة أوامر Sword مقسمة حسب البلوقنات'),
    async execute(interaction) {
      await interaction.reply({ ...helpHome(interaction), flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('plugins')
      .setDescription('تشغيل وإيقاف بلوقنات البوت')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(interaction) {
      await interaction.reply({ ...pluginsPanel(interaction), flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('prefix')
      .setDescription('تغيير بريفكس البوت (مثل ! أو . أو -)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption((o) => o.setName('value').setDescription('البريفكس الجديد (حتى 5 حروف)').setRequired(true).setMaxLength(5)),
    async execute(interaction) {
      const value = interaction.options.getString('value').trim();
      if (!value || /\s/.test(value)) return reply.error(interaction, 'البريفكس ما يكون فاضي أو فيه مسافة.');
      store.update(interaction.guildId, 'core', (cfg) => { cfg.prefix = value; });
      return reply.success(interaction, `البريفكس صار \`${value}\`\nمثال: \`${value}مساعدة\` أو \`${value}باند @عضو\``, { hidden: false });
    },
  },
  {
    data: new SlashCommandBuilder().setName('ping').setDescription('سرعة استجابة البوت'),
    async execute(interaction) {
      const sent = Date.now();
      await interaction.reply({ embeds: [simple('🏓 ...')], flags: MessageFlags.Ephemeral });
      const roundtrip = Date.now() - sent;
      await interaction.editReply({
        embeds: [simple(`${emoji.sword} **Pong!**\nالبوت: \`${roundtrip}ms\`  •  الاتصال: \`${Math.round(interaction.client.ws.ping)}ms\``)],
      });
    },
  },
  {
    data: new SlashCommandBuilder().setName('botinfo').setDescription('معلومات عن بوت Sword'),
    async execute(interaction) {
      const { client } = interaction;
      const { embed, files } = card({
        title: `${emoji.sword} Sword Bot`,
        description: `بوت سستم متكامل لسيرفر **Sword** ${emoji.gate}\n${DIVIDER}`,
        fields: [
          { name: '⏱️ شغال من', value: ts(Date.now() - client.uptime), inline: true },
          { name: '📶 البنق', value: `\`${Math.round(client.ws.ping)}ms\``, inline: true },
          { name: '🧩 البلوقنات', value: `\`${client.plugins.size}\``, inline: true },
          { name: '⌨️ الأوامر', value: `\`${client.commands.size}\``, inline: true },
          { name: '🏯 السيرفرات', value: `\`${client.guilds.cache.size}\``, inline: true },
          { name: '📦 المكتبة', value: `\`discord.js v${djsVersion}\``, inline: true },
        ],
        image: 'banner',
      });
      await interaction.reply({ embeds: [embed], files });
    },
  },
  {
    data: new SlashCommandBuilder().setName('serverinfo').setDescription('معلومات السيرفر'),
    async execute(interaction) {
      const { guild } = interaction;
      const channels = guild.channels.cache;
      const { embed } = card({
        title: `${emoji.gate} ${guild.name}`,
        brand: false,
        thumbnail: guild.iconURL({ size: 256 }) || undefined,
        fields: [
          { name: '👑 المالك', value: `<@${guild.ownerId}>`, inline: true },
          { name: '📅 تأسس', value: ts(guild.createdAt, 'D'), inline: true },
          { name: '🆔 الآيدي', value: `\`${guild.id}\``, inline: true },
          { name: '👥 الأعضاء', value: `\`${guild.memberCount}\``, inline: true },
          { name: '💎 البوستات', value: `\`${guild.premiumSubscriptionCount || 0}\` (لفل ${guild.premiumTier})`, inline: true },
          { name: '🎭 الرتب', value: `\`${guild.roles.cache.size - 1}\``, inline: true },
          {
            name: '💬 الرومات',
            value: `كتابي \`${channels.filter((c) => c.type === ChannelType.GuildText).size}\` • صوتي \`${channels.filter((c) => c.type === ChannelType.GuildVoice).size}\` • كاتقوري \`${channels.filter((c) => c.type === ChannelType.GuildCategory).size}\``,
          },
        ],
        footer: 'Sword • Server Info',
        image: guild.bannerURL({ size: 1024 }) || undefined,
      });
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('userinfo')
      .setDescription('معلومات عضو')
      .addUserOption((o) => o.setName('user').setDescription('العضو')),
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      const member = interaction.options.getMember('user') || (user.id === interaction.user.id ? interaction.member : null);
      const roles = member?.roles.cache.filter((r) => r.id !== interaction.guildId).sort((a, b) => b.position - a.position);
      const fields = [
        { name: '🆔 الآيدي', value: `\`${user.id}\``, inline: true },
        { name: '📅 إنشاء الحساب', value: ts(user.createdAt, 'D'), inline: true },
      ];
      if (member) {
        fields.push({ name: '📥 دخل السيرفر', value: ts(member.joinedAt, 'D'), inline: true });
        fields.push({ name: `🎭 الرتب (${roles.size})`, value: truncate(roles.map((r) => `${r}`).join(' '), 1000) || 'لا يوجد' });
      }
      const { embed } = card({
        title: `${emoji.blade} ${user.username}`,
        brand: false,
        thumbnail: user.displayAvatarURL({ size: 256 }),
        fields,
        color: member?.displayColor || 'primary',
        footer: 'Sword • User Info',
      });
      await interaction.reply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('avatar')
      .setDescription('صورة حساب عضو')
      .addUserOption((o) => o.setName('user').setDescription('العضو')),
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      const { embed } = card({
        title: `🖼️ ${user.username}`,
        brand: false,
        image: user.displayAvatarURL({ size: 1024 }),
        description: `[تحميل الصورة](${user.displayAvatarURL({ size: 4096 })})`,
      });
      await interaction.reply({ embeds: [embed] });
    },
  },
];

module.exports = {
  id: 'settings',
  name: 'Bot Settings',
  nameAr: 'إعدادات البوت',
  emoji: '⚙️',
  description: 'قائمة الأوامر، البريفكس، تشغيل وإيقاف البلوقنات، ومعلومات عامة عن البوت والسيرفر.',
  configKey: 'core',
  dashboard: [
    {
      title: 'البريفكس',
      description: 'كل أوامر السلاش تشتغل كذلك بالبريفكس، مثل !باند @عضو أو !مساعدة',
      fields: [
        { key: 'prefix', type: 'text', label: 'البريفكس', max: 5, required: true, pattern: '^\\S{1,5}$', hint: 'حرف أو رمز بدون مسافات، مثل ! أو . أو -' },
      ],
    },
  ],
  toggleable: false,
  commands,
  components: {
    async help(interaction) {
      await interaction.update(helpPlugin(interaction, interaction.values[0]));
    },
    async plugins(interaction) {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return reply.error(interaction, 'تحتاج صلاحية Manage Server.');
      }
      const selected = new Set(interaction.values);
      for (const plugin of interaction.client.plugins.values()) {
        if (plugin.toggleable) store.setEnabled(interaction.guildId, plugin.id, selected.has(plugin.id));
      }
      await interaction.update(pluginsPanel(interaction));
    },
  },
};
