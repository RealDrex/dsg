const {
  SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder,
  MessageFlags, ChannelType, version: djsVersion,
} = require('discord.js');
const store = require('../../core/store');
const { card, simple, emoji, DIVIDER, reply } = require('../../core/theme');
const { describeCommands, usage } = require('../../core/loader');
const { ts } = require('../../utils/time');
const { truncate } = require('../../utils/text');
const updater = require('../../core/updater');
const config = require('../../config');
const { ButtonBuilder, ButtonStyle } = require('discord.js');

const isOwner = (interaction) => config.ownerIds.includes(interaction.user.id) || interaction.guild?.ownerId === interaction.user.id;

const UPDATE_TEXT = {
  'up-to-date': 'البوت على آخر نسخة',
  'no-git': 'التحديث التلقائي يحتاج تثبيت البوت عن طريق **git clone** — شوف README',
  'no-upstream': 'الفرع الحالي مو مربوط بـ GitHub (git branch --set-upstream-to)',
  'fetch-failed': 'ما قدرت أوصل لـ GitHub',
  busy: 'فيه تحديث شغال الحين',
  dirty: 'فيه ملفات معدلة يدوياً على الخادم — ما أقدر أحدث فوقها',
  failed: 'النسخة الجديدة فشلت الفحص — رجعت للنسخة السابقة',
};
const { I, asEmoji, setIcon } = require('../../core/icons');

let commandIndex = null;
const prefixOf = (interaction) => store.get(interaction.guildId, 'core').prefix || '!';
const commandsOf = (client, pluginId) => {
  commandIndex ??= describeCommands(client.plugins);
  return commandIndex.filter((c) => c.plugin === pluginId);
};

function helpMenu(client, selected) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('settings:help')
    .setPlaceholder('اختر القسم لعرض أوامره')
    .addOptions(
      [...client.plugins.values()].map((p) => ({
        label: p.nameAr,
        description: truncate(p.description, 100),
        value: p.id,
        emoji: asEmoji(p.emoji),
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
  const { content, files } = card({
    title: `${emoji.sword} Sword — قائمة الأوامر`,
    description: `أهلاً بك في بوت **Sword** ${emoji.gate}\nاختر قسم من القائمة تحت عشان تشوف أوامره بالتفصيل.\n${DIVIDER}\n${list}\n${DIVIDER}\n${I.keyboard} كل أمر يشتغل بالسلاش \`/\` أو بالبريفكس \`${prefixOf(interaction)}\`\nمثال: \`${prefixOf(interaction)}باند @عضو السبب\`\n\`<>\` إجباري  •  \`[]\` اختياري`,
    image: 'banner',
  });
  return { content, files, components: [helpMenu(client)] };
}

function helpPlugin(interaction, pluginId) {
  const { client } = interaction;
  const plugin = client.plugins.get(pluginId);
  const lines = commandsOf(client, pluginId).map((c) => `${emoji.dot} \`${usage(c)}\`\n${c.description}`);
  lines.unshift(`البريفكس: \`${prefixOf(interaction)}\` — مثال: \`${prefixOf(interaction)}${commandsOf(client, pluginId)[0]?.name || ''}\``);
  const { content, files } = card({
    title: `${plugin.emoji} ${plugin.nameAr}`,
    description: `${plugin.description}\n${DIVIDER}\n${truncate(lines.join('\n\n'), 3800) || 'ما فيه أوامر.'}`,
    image: 'line',
    footer: `${plugin.name} • Sword`,
  });
  return { content, files, components: [helpMenu(client, pluginId)], attachments: [] };
}

function pluginsPanel(interaction) {
  const { client, guildId } = interaction;
  const toggleable = [...client.plugins.values()].filter((p) => p.toggleable);
  const list = toggleable
    .map((p) => `${store.isEnabled(guildId, p.id) ? emoji.on : emoji.off} ${p.emoji} **${p.nameAr}** \`@${p.name}\``)
    .join('\n');
  const menu = new StringSelectMenuBuilder()
    .setCustomId('settings:plugins')
    .setPlaceholder('حدد الأقسام اللي تبيها شغالة')
    .setMinValues(0)
    .setMaxValues(toggleable.length)
    .addOptions(
      toggleable.map((p) => ({
        label: p.nameAr,
        value: p.id,
        emoji: asEmoji(p.emoji),
        description: p.name,
        default: store.isEnabled(guildId, p.id),
      })),
    );
  const { content, files } = card({
    title: `${emoji.gate} إدارة الأقسام`,
    description: `فعّل أو عطّل أي قسم من القائمة.\nالمحدد = شغال ${emoji.on}  •  غير المحدد = مقفل ${emoji.off}\n${DIVIDER}\n${list}`,
  });
  return { content, files, components: [new ActionRowBuilder().addComponents(menu)], attachments: [] };
}

const commands = [
  {
    data: new SlashCommandBuilder().setName('help').setDescription('قائمة أوامر Sword مقسمة حسب الأقسام'),
    async execute(interaction) {
      await interaction.reply({ ...helpHome(interaction), flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('plugins')
      .setDescription('تشغيل وإيقاف أقسام البوت')
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
    data: new SlashCommandBuilder()
      .setName('update')
      .setDescription('فحص تحديثات البوت وتحديثه (لمالك السيرفر)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
      if (!isOwner(interaction)) return reply.error(interaction, 'للمالك فقط');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const v = await updater.version();
      const result = await updater.check();
      const lines = [`${emoji.dot} **النسخة الحالية:** \`${v.hash}\`${v.date ? ` • ${ts(v.date)}` : ''}`,
        `${emoji.dot} **التحديث التلقائي:** ${process.env.AUTO_UPDATE === 'false' ? `${emoji.off} مقفل` : `${emoji.on} شغال`}`];
      let components = [];
      if (result.status === 'available') {
        lines.push(`${emoji.dot} **فيه تحديث:** ${result.behind} تعديل جديد\n${result.log.map((l) => `> \`${l.slice(0, 7)}\` ${l.slice(8)}`).join('\n')}`);
        components = [new ActionRowBuilder().addComponents(
          setIcon(new ButtonBuilder().setCustomId('settings:doupdate').setLabel('حدّث الحين').setStyle(ButtonStyle.Success), I.fast),
        )];
      } else {
        lines.push(`${emoji.dot} ${UPDATE_TEXT[result.status] || result.status}${result.error ? `\n\`${result.error.slice(0, 200)}\`` : ''}`);
      }
      return interaction.editReply({ content: simple(lines.join('\n'), 'primary', `${I.fast} تحديث البوت`), components });
    },
  },
  {
    data: new SlashCommandBuilder().setName('ping').setDescription('سرعة استجابة البوت'),
    async execute(interaction) {
      const sent = Date.now();
      await interaction.reply({ content: simple(`${I.ping} ...`), flags: MessageFlags.Ephemeral });
      const roundtrip = Date.now() - sent;
      await interaction.editReply({
        content: simple(`${emoji.sword} **Pong!**\nالبوت: \`${roundtrip}ms\`  •  الاتصال: \`${Math.round(interaction.client.ws.ping)}ms\``),
      });
    },
  },
  {
    data: new SlashCommandBuilder().setName('botinfo').setDescription('معلومات عن بوت Sword'),
    async execute(interaction) {
      const { client } = interaction;
      const { content, files } = card({
        title: `${emoji.sword} Sword Bot`,
        description: `بوت سستم متكامل لسيرفر **Sword** ${emoji.gate}\n${DIVIDER}`,
        fields: [
          { name: `${I.clock} شغال من`, value: ts(Date.now() - client.uptime), inline: true },
          { name: `${I.signal} البنق`, value: `\`${Math.round(client.ws.ping)}ms\``, inline: true },
          { name: `${I.puzzle} الأقسام`, value: `\`${client.plugins.size}\``, inline: true },
          { name: `${I.keyboard} الأوامر`, value: `\`${client.commands.size}\``, inline: true },
          { name: `${I.server} السيرفرات`, value: `\`${client.guilds.cache.size}\``, inline: true },
          { name: `${I.package} المكتبة`, value: `\`discord.js v${djsVersion}\``, inline: true },
          { name: `${I.fast} النسخة`, value: `\`${(await updater.version()).hash}\``, inline: true },
        ],
        image: 'banner',
      });
      await interaction.reply({ content, files });
    },
  },
  {
    data: new SlashCommandBuilder().setName('serverinfo').setDescription('معلومات السيرفر'),
    async execute(interaction) {
      const { guild } = interaction;
      const channels = guild.channels.cache;
      const { content } = card({
        title: `${emoji.gate} ${guild.name}`,
        brand: false,
        thumbnail: guild.iconURL({ size: 256 }) || undefined,
        fields: [
          { name: `${I.crown} المالك`, value: `<@${guild.ownerId}>`, inline: true },
          { name: `${I.calendar} تأسس`, value: ts(guild.createdAt, 'D'), inline: true },
          { name: `${I.id} الآيدي`, value: `\`${guild.id}\``, inline: true },
          { name: `${I.users} الأعضاء`, value: `\`${guild.memberCount}\``, inline: true },
          { name: `${I.gem} البوستات`, value: `\`${guild.premiumSubscriptionCount || 0}\` (لفل ${guild.premiumTier})`, inline: true },
          { name: `${I.roles} الرتب`, value: `\`${guild.roles.cache.size - 1}\``, inline: true },
          {
            name: `${I.message} الرومات`,
            value: `كتابي \`${channels.filter((c) => c.type === ChannelType.GuildText).size}\` • صوتي \`${channels.filter((c) => c.type === ChannelType.GuildVoice).size}\` • كاتقوري \`${channels.filter((c) => c.type === ChannelType.GuildCategory).size}\``,
          },
        ],
        footer: 'Sword • Server Info',
        image: guild.bannerURL({ size: 1024 }) || undefined,
      });
      await interaction.reply({ content });
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
        { name: `${I.id} الآيدي`, value: `\`${user.id}\``, inline: true },
        { name: `${I.calendar} إنشاء الحساب`, value: ts(user.createdAt, 'D'), inline: true },
      ];
      if (member) {
        fields.push({ name: `${I.joined} دخل السيرفر`, value: ts(member.joinedAt, 'D'), inline: true });
        fields.push({ name: `${I.roles} الرتب (${roles.size})`, value: truncate(roles.map((r) => `${r}`).join(' '), 1000) || 'لا يوجد' });
      }
      const { content } = card({
        title: `${emoji.blade} ${user.username}`,
        brand: false,
        thumbnail: user.displayAvatarURL({ size: 256 }),
        fields,
        color: member?.displayColor || 'primary',
        footer: 'Sword • User Info',
      });
      await interaction.reply({ content });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('avatar')
      .setDescription('صورة حساب عضو')
      .addUserOption((o) => o.setName('user').setDescription('العضو')),
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      const { content } = card({
        title: `${I.image} ${user.username}`,
        brand: false,
        image: user.displayAvatarURL({ size: 1024 }),
        description: `[تحميل الصورة](${user.displayAvatarURL({ size: 4096 })})`,
      });
      await interaction.reply({ content });
    },
  },
];

module.exports = {
  id: 'settings',
  name: 'Bot Settings',
  nameAr: 'إعدادات البوت',
  emoji: I.settings,
  description: 'قائمة الأوامر، البريفكس، تشغيل وإيقاف الأقسام، ومعلومات عامة عن البوت والسيرفر.',
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
    async doupdate(interaction) {
      if (!isOwner(interaction)) return reply.error(interaction, 'للمالك فقط');
      await interaction.update({ content: simple(`${I.clock} جاري التحديث...`), components: [] });
      const result = await updater.updateAndRestart(interaction.client, { reason: interaction.user.tag });
      const text = result.status === 'updated'
        ? `${emoji.success} تحدّث من \`${result.from}\` إلى \`${result.to}\` — البوت بيرجع خلال ثواني`
        : `${emoji.error} ${UPDATE_TEXT[result.status] || result.status}`;
      return interaction.editReply({ content: simple(text, result.status === 'updated' ? 'success' : 'error') });
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
