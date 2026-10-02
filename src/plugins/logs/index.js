const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, PermissionsBitField } = require('discord.js');
const store = require('../../core/store');
const cases = require('../../core/cases');
const { colors, emoji, DIVIDER, reply, BRAND } = require('../../core/theme');
const { formatDuration, ts } = require('../../utils/time');
const { truncate } = require('../../utils/text');

const TYPES = {
  messages: { label: 'الرسائل', emoji: '💬', channel: 'سجل-الرسائل' },
  members: { label: 'الأعضاء', emoji: '👥', channel: 'سجل-الأعضاء' },
  moderation: { label: 'الإدارة', emoji: '🔨', channel: 'سجل-الإدارة' },
  server: { label: 'السيرفر (رومات ورتب)', emoji: '🏯', channel: 'سجل-السيرفر' },
  voice: { label: 'الفويس', emoji: '🔊', channel: 'سجل-الفويس' },
  protection: { label: 'الحماية', emoji: '🛡️', channel: 'سجل-الحماية' },
};

const COLOR = { add: colors.success, remove: colors.accent, edit: colors.warn, info: colors.primary };

function log(guild, type, { title, description, color = 'info', user, fields }) {
  const channelId = store.get(guild.id, 'logs').channels[type];
  const channel = channelId && guild.channels.cache.get(channelId);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setColor(COLOR[color] ?? color)
    .setTitle(`${TYPES[type].emoji} ${title}`)
    .setDescription(truncate(description, 4000))
    .setFooter({ text: BRAND })
    .setTimestamp();
  if (user) embed.setAuthor({ name: user.tag || user.username, iconURL: user.displayAvatarURL() });
  if (fields?.length) embed.addFields(fields);
  return channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
}

const events = {
  messageDelete(message) {
    if (!message.guild || message.author?.bot) return;
    const attachments = message.attachments?.map((a) => a.url).join('\n');
    log(message.guild, 'messages', {
      title: 'رسالة انحذفت',
      color: 'remove',
      user: message.author,
      description: `${emoji.dot} **الكاتب:** ${message.author ?? 'غير معروف'}\n${emoji.dot} **الروم:** ${message.channel}\n${DIVIDER}\n${truncate(message.content, 3000) || '*رسالة غير محفوظة أو بدون نص*'}${attachments ? `\n📎 ${attachments}` : ''}`,
    });
  },
  messageUpdate(before, after) {
    if (!after.guild || after.author?.bot || before.partial || before.content === after.content) return;
    log(after.guild, 'messages', {
      title: 'رسالة تعدلت',
      color: 'edit',
      user: after.author,
      description: `${emoji.dot} **الكاتب:** ${after.author}\n${emoji.dot} **الروم:** ${after.channel} • [الرسالة](${after.url})`,
      fields: [
        { name: 'قبل', value: truncate(before.content, 1000) || '—' },
        { name: 'بعد', value: truncate(after.content, 1000) || '—' },
      ],
    });
  },
  messageDeleteBulk(messages, channel) {
    log(channel.guild, 'messages', {
      title: 'مسح جماعي',
      color: 'remove',
      description: `تم مسح \`${messages.size}\` رسالة من ${channel}`,
    });
  },
  guildMemberAdd(member) {
    const age = Date.now() - member.user.createdTimestamp;
    log(member.guild, 'members', {
      title: 'عضو دخل',
      color: 'add',
      user: member.user,
      description: `${member} \`${member.id}\`\n${emoji.dot} **عمر الحساب:** ${ts(member.user.createdAt)}${age < 7 * 86_400_000 ? `\n${emoji.warn} **حساب جديد!**` : ''}\n${emoji.dot} **عدد الأعضاء:** \`${member.guild.memberCount}\``,
    });
  },
  guildMemberRemove(member) {
    const roles = member.roles?.cache.filter((r) => r.id !== member.guild.id).map((r) => `${r}`).join(' ');
    log(member.guild, 'members', {
      title: 'عضو طلع',
      color: 'remove',
      user: member.user,
      description: `${member.user} \`${member.id}\`\n${emoji.dot} **دخل:** ${member.joinedAt ? ts(member.joinedAt) : 'غير معروف'}\n${emoji.dot} **الرتب:** ${roles || '—'}`,
    });
  },
  guildMemberUpdate(before, after) {
    if (before.partial) return;
    const { guild } = after;
    if (before.nickname !== after.nickname) {
      log(guild, 'members', {
        title: 'تغيير لقب', color: 'edit', user: after.user,
        description: `${after}\n**قبل:** ${before.nickname || '—'}\n**بعد:** ${after.nickname || '—'}`,
      });
    }
    const added = after.roles.cache.filter((r) => !before.roles.cache.has(r.id));
    const removed = before.roles.cache.filter((r) => !after.roles.cache.has(r.id));
    if (added.size || removed.size) {
      log(guild, 'members', {
        title: 'تحديث رتب', color: 'edit', user: after.user,
        description: `${after}${added.size ? `\n➕ ${added.map((r) => `${r}`).join(' ')}` : ''}${removed.size ? `\n➖ ${removed.map((r) => `${r}`).join(' ')}` : ''}`,
      });
    }
  },
  guildBanAdd(ban) {
    log(ban.guild, 'members', { title: 'باند', color: 'remove', user: ban.user, description: `${ban.user} \`${ban.user.id}\`\n${emoji.dot} السبب: ${ban.reason || '—'}` });
  },
  guildBanRemove(ban) {
    log(ban.guild, 'members', { title: 'فك باند', color: 'add', user: ban.user, description: `${ban.user} \`${ban.user.id}\`` });
  },
  channelCreate(channel) {
    if (!channel.guild) return;
    log(channel.guild, 'server', { title: 'روم جديد', color: 'add', description: `${channel} \`${channel.name}\`` });
  },
  channelDelete(channel) {
    if (!channel.guild) return;
    log(channel.guild, 'server', { title: 'روم انحذف', color: 'remove', description: `\`#${channel.name}\`` });
  },
  channelUpdate(before, after) {
    if (!after.guild || before.name === after.name) return;
    log(after.guild, 'server', { title: 'روم تعدل', color: 'edit', description: `${after}\n**قبل:** \`${before.name}\`\n**بعد:** \`${after.name}\`` });
  },
  roleCreate(role) {
    log(role.guild, 'server', { title: 'رتبة جديدة', color: 'add', description: `${role} \`${role.name}\`` });
  },
  roleDelete(role) {
    log(role.guild, 'server', { title: 'رتبة انحذفت', color: 'remove', description: `\`@${role.name}\`` });
  },
  roleUpdate(before, after) {
    const changes = [];
    if (before.name !== after.name) changes.push(`**الاسم:** \`${before.name}\` ← \`${after.name}\``);
    if (before.color !== after.color) changes.push(`**اللون:** \`${before.hexColor}\` ← \`${after.hexColor}\``);
    if (before.permissions.bitfield !== after.permissions.bitfield) {
      const gained = new PermissionsBitField(after.permissions.bitfield & ~before.permissions.bitfield).toArray();
      const lost = new PermissionsBitField(before.permissions.bitfield & ~after.permissions.bitfield).toArray();
      if (gained.length) changes.push(`**صلاحيات جديدة:** \`${gained.join(', ')}\``);
      if (lost.length) changes.push(`**صلاحيات انسحبت:** \`${lost.join(', ')}\``);
    }
    if (changes.length) log(after.guild, 'server', { title: 'رتبة تعدلت', color: 'edit', description: `${after}\n${changes.join('\n')}` });
  },
  voiceStateUpdate(before, after) {
    const member = after.member || before.member;
    if (!member || member.user.bot || before.channelId === after.channelId) return;
    let title;
    let description;
    if (!before.channelId) [title, description] = ['دخل فويس', `${member} دخل ${after.channel}`];
    else if (!after.channelId) [title, description] = ['طلع من فويس', `${member} طلع من ${before.channel}`];
    else [title, description] = ['تنقل بين الرومات', `${member}: ${before.channel} ← ${after.channel}`];
    log(after.guild, 'voice', { title, description, user: member.user, color: !after.channelId ? 'remove' : !before.channelId ? 'add' : 'edit' });
  },
  swordModAction(guild, entry) {
    const meta = cases.ACTIONS[entry.action];
    const lines = [
      `${emoji.dot} **العضو:** <@${entry.userId}> \`${entry.userId}\``,
      `${emoji.dot} **المشرف:** <@${entry.modId}>`,
      `${emoji.dot} **السبب:** ${entry.reason || 'بدون سبب'}`,
    ];
    if (entry.duration) lines.push(`${emoji.dot} **المدة:** ${formatDuration(entry.duration)}`);
    log(guild, 'moderation', { title: `${meta?.label || entry.action} • قضية #${entry.number}`, color: entry.action.startsWith('un') ? 'add' : 'remove', description: lines.join('\n') });
  },
  swordProtection(guild, { title, description }) {
    const cfg = store.get(guild.id, 'logs');
    const type = cfg.channels.protection ? 'protection' : 'moderation';
    log(guild, type, { title, description, color: 'remove' });
  },
};

const typeChoices = Object.entries(TYPES).map(([value, t]) => ({ name: `${t.emoji} ${t.label}`, value }));

const data = new SlashCommandBuilder()
  .setName('logs')
  .setDescription('إعدادات اللوقات (السجلات)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('setup').setDescription('إنشاء كاتقوري لوقات كاملة تلقائياً'))
  .addSubcommand((s) => s.setName('set').setDescription('تحديد روم لنوع لوق')
    .addStringOption((o) => o.setName('type').setDescription('النوع').setRequired(true).addChoices(...typeChoices))
    .addChannelOption((o) => o.setName('channel').setDescription('الروم').setRequired(true).addChannelTypes(ChannelType.GuildText)))
  .addSubcommand((s) => s.setName('disable').setDescription('إيقاف نوع لوق')
    .addStringOption((o) => o.setName('type').setDescription('النوع').setRequired(true).addChoices(...typeChoices)))
  .addSubcommand((s) => s.setName('view').setDescription('عرض إعدادات اللوقات'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const { guild } = interaction;
  if (sub === 'view') {
    const cfg = store.get(guild.id, 'logs');
    const lines = Object.entries(TYPES).map(([key, t]) => `${t.emoji} **${t.label}:** ${cfg.channels[key] ? `<#${cfg.channels[key]}>` : `${emoji.off} مقفل`}`);
    return reply.info(interaction, `📋 **إعدادات اللوقات**\n${DIVIDER}\n${lines.join('\n')}`);
  }
  if (sub === 'set' || sub === 'disable') {
    const type = interaction.options.getString('type');
    const channel = interaction.options.getChannel('channel');
    store.update(guild.id, 'logs', (cfg) => { cfg.channels[type] = channel?.id || null; });
    return reply.success(interaction, channel ? `لوق **${TYPES[type].label}** ← ${channel}` : `تم إيقاف لوق **${TYPES[type].label}**`);
  }
  await interaction.deferReply({ flags: 64 });
  const category = await guild.channels.create({
    name: '📜 Sword Logs',
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
    ],
  });
  const created = {};
  for (const [key, t] of Object.entries(TYPES)) {
    created[key] = (await guild.channels.create({ name: `${t.emoji}・${t.channel}`, parent: category, type: ChannelType.GuildText })).id;
  }
  store.update(guild.id, 'logs', (cfg) => { cfg.channels = created; });
  await interaction.editReply({ embeds: [new EmbedBuilder().setColor(colors.success).setDescription(`${emoji.success} تم إنشاء ${category} مع ${Object.keys(created).length} رومات لوق (مخفية عن الأعضاء).`)] });
}

module.exports = {
  id: 'logs',
  name: 'Logs Plugin',
  nameAr: 'بلوقن اللوقات',
  emoji: '📋',
  description: 'تسجيل الرسائل، الأعضاء، العقوبات، الرومات والرتب، الفويس وتنبيهات الحماية.',
  defaults: { channels: Object.fromEntries(Object.keys(TYPES).map((k) => [k, null])) },
  commands: [{ data, execute }],
  events,
};
