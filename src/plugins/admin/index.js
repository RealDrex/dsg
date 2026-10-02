const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const store = require('../../core/store');
const cases = require('../../core/cases');
const { simple, emoji, reply, colors } = require('../../core/theme');
const { checkTarget, canManageRole } = require('../../utils/perms');
const { parseDuration, formatDuration, ts } = require('../../utils/time');
const { truncate } = require('../../utils/text');

const P = PermissionFlagsBits;
const MAX_TIMEOUT = 28 * 86_400_000;

const reasonOpt = (o) => o.setName('reason').setDescription('السبب').setMaxLength(400);
const NO_REASON = 'بدون سبب';

// Public confirmation embed for a moderation action.
function actionEmbed(entry, user, moderator) {
  const meta = cases.ACTIONS[entry.action];
  const lines = [
    `${emoji.dot} **العضو:** ${user} \`${user.id}\``,
    `${emoji.dot} **المشرف:** ${moderator}`,
    `${emoji.dot} **السبب:** ${entry.reason || NO_REASON}`,
  ];
  if (entry.duration) lines.push(`${emoji.dot} **المدة:** ${formatDuration(entry.duration)}`);
  return simple(lines.join('\n'), entry.action.startsWith('un') ? 'success' : 'accent', `${meta.emoji} ${meta.label} • قضية #${entry.number}`)
    .setThumbnail(user.displayAvatarURL());
}

async function notify(user, guild, entry) {
  const meta = cases.ACTIONS[entry.action];
  const text = [`${meta.emoji} **${meta.label}** في سيرفر **${guild.name}**`, `السبب: ${entry.reason || NO_REASON}`];
  if (entry.duration) text.push(`المدة: ${formatDuration(entry.duration)}`);
  await user.send({ embeds: [simple(text.join('\n'), 'accent')] }).catch(() => null);
}

async function applyWarnPunishment(interaction, member) {
  const cfg = store.get(interaction.guildId, 'admin').warnPunish;
  if (!cfg.enabled) return null;
  const count = cases.forUser(interaction.guildId, member.id, 'warn').length;
  if (count < cfg.at || count % cfg.at !== 0) return null;
  const reason = `وصل ${count} تحذيرات`;
  if (cfg.action === 'timeout') await member.timeout(cfg.duration, reason);
  else if (cfg.action === 'kick') await member.kick(reason);
  else if (cfg.action === 'ban') await member.ban({ reason });
  const entry = cases.create(interaction.guild, {
    action: cfg.action, userId: member.id, modId: interaction.client.user.id, reason,
    duration: cfg.action === 'timeout' ? cfg.duration : null,
  });
  return entry;
}

async function setChannelPerm(interaction, perms, done) {
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, perms, {
    reason: `${interaction.user.tag}: ${interaction.options.getString('reason') || NO_REASON}`,
  });
  await interaction.reply({ embeds: [simple(`${done} ${channel}`, 'primary')] });
}

const channelOpt = (o) =>
  o.setName('channel').setDescription('الروم (الافتراضي: الحالي)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement);

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('باند لعضو (حتى لو مو داخل السيرفر)')
      .setDefaultMemberPermissions(P.BanMembers)
      .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true))
      .addStringOption(reasonOpt)
      .addIntegerOption((o) =>
        o.setName('delete').setDescription('حذف رسائله السابقة').addChoices(
          { name: 'لا تحذف', value: 0 }, { name: 'آخر ساعة', value: 3600 },
          { name: 'آخر يوم', value: 86400 }, { name: 'آخر 7 أيام', value: 604800 },
        )),
    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const member = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason');
      const problem = checkTarget(interaction, member, 'باند');
      if (problem) return reply.error(interaction, problem);
      const entry = { action: 'ban', userId: user.id, modId: interaction.user.id, reason };
      if (member) await notify(user, interaction.guild, entry);
      await interaction.guild.members.ban(user, {
        reason: `${interaction.user.tag}: ${reason || NO_REASON}`,
        deleteMessageSeconds: interaction.options.getInteger('delete') || 0,
      });
      await interaction.reply({ embeds: [actionEmbed(cases.create(interaction.guild, entry), user, interaction.user)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('unban')
      .setDescription('فك الباند عن عضو بالآيدي')
      .setDefaultMemberPermissions(P.BanMembers)
      .addStringOption((o) => o.setName('user_id').setDescription('آيدي العضو').setRequired(true))
      .addStringOption(reasonOpt),
    async execute(interaction) {
      const id = interaction.options.getString('user_id').replace(/\D/g, '');
      const reason = interaction.options.getString('reason');
      const ban = await interaction.guild.bans.fetch(id).catch(() => null);
      if (!ban) return reply.error(interaction, 'هذا العضو مو مبند.');
      await interaction.guild.members.unban(id, `${interaction.user.tag}: ${reason || NO_REASON}`);
      const entry = cases.create(interaction.guild, { action: 'unban', userId: id, modId: interaction.user.id, reason });
      await interaction.reply({ embeds: [actionEmbed(entry, ban.user, interaction.user)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('طرد عضو من السيرفر')
      .setDefaultMemberPermissions(P.KickMembers)
      .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true))
      .addStringOption(reasonOpt),
    async execute(interaction) {
      const member = interaction.options.getMember('user');
      if (!member) return reply.error(interaction, 'العضو مو موجود في السيرفر.');
      const problem = checkTarget(interaction, member, 'طرد');
      if (problem) return reply.error(interaction, problem);
      const reason = interaction.options.getString('reason');
      const entry = { action: 'kick', userId: member.id, modId: interaction.user.id, reason };
      await notify(member.user, interaction.guild, entry);
      await member.kick(`${interaction.user.tag}: ${reason || NO_REASON}`);
      await interaction.reply({ embeds: [actionEmbed(cases.create(interaction.guild, entry), member.user, interaction.user)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('timeout')
      .setDescription('تايم أوت (ميوت) لعضو لمدة محددة')
      .setDefaultMemberPermissions(P.ModerateMembers)
      .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('المدة مثل 10m أو 2h أو 1d (حد أقصى 28d)').setRequired(true))
      .addStringOption(reasonOpt),
    async execute(interaction) {
      const member = interaction.options.getMember('user');
      if (!member) return reply.error(interaction, 'العضو مو موجود في السيرفر.');
      const problem = checkTarget(interaction, member, 'تايم أوت');
      if (problem) return reply.error(interaction, problem);
      const duration = parseDuration(interaction.options.getString('duration'));
      if (!duration || duration > MAX_TIMEOUT) return reply.error(interaction, 'مدة غير صحيحة. أمثلة: `10m` `2h` `1d` (أقصى شي 28d).');
      const reason = interaction.options.getString('reason');
      await member.timeout(duration, `${interaction.user.tag}: ${reason || NO_REASON}`);
      const entry = cases.create(interaction.guild, { action: 'timeout', userId: member.id, modId: interaction.user.id, reason, duration });
      await notify(member.user, interaction.guild, entry);
      await interaction.reply({ embeds: [actionEmbed(entry, member.user, interaction.user)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('untimeout')
      .setDescription('فك التايم أوت عن عضو')
      .setDefaultMemberPermissions(P.ModerateMembers)
      .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true))
      .addStringOption(reasonOpt),
    async execute(interaction) {
      const member = interaction.options.getMember('user');
      if (!member?.isCommunicationDisabled()) return reply.error(interaction, 'العضو ما عليه تايم أوت.');
      const reason = interaction.options.getString('reason');
      await member.timeout(null, `${interaction.user.tag}: ${reason || NO_REASON}`);
      const entry = cases.create(interaction.guild, { action: 'untimeout', userId: member.id, modId: interaction.user.id, reason });
      await interaction.reply({ embeds: [actionEmbed(entry, member.user, interaction.user)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('warn')
      .setDescription('تحذير عضو')
      .setDefaultMemberPermissions(P.ModerateMembers)
      .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true))
      .addStringOption((o) => reasonOpt(o).setRequired(true)),
    async execute(interaction) {
      const member = interaction.options.getMember('user');
      if (!member) return reply.error(interaction, 'العضو مو موجود في السيرفر.');
      const problem = checkTarget(interaction, member, 'تحذير');
      if (problem) return reply.error(interaction, problem);
      const reason = interaction.options.getString('reason');
      const entry = cases.create(interaction.guild, { action: 'warn', userId: member.id, modId: interaction.user.id, reason });
      await notify(member.user, interaction.guild, entry);
      const total = cases.forUser(interaction.guildId, member.id, 'warn').length;
      const embed = actionEmbed(entry, member.user, interaction.user).addFields({ name: 'مجموع تحذيراته', value: `\`${total}\``, inline: true });
      await interaction.reply({ embeds: [embed] });
      const auto = await applyWarnPunishment(interaction, member).catch(() => null);
      if (auto) await interaction.followUp({ embeds: [actionEmbed(auto, member.user, interaction.client.user)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('warnings')
      .setDescription('إدارة التحذيرات')
      .setDefaultMemberPermissions(P.ModerateMembers)
      .addSubcommand((s) => s.setName('list').setDescription('عرض تحذيرات عضو')
        .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true)))
      .addSubcommand((s) => s.setName('remove').setDescription('حذف تحذير برقم القضية')
        .addIntegerOption((o) => o.setName('case').setDescription('رقم القضية').setRequired(true).setMinValue(1)))
      .addSubcommand((s) => s.setName('clear').setDescription('مسح كل تحذيرات عضو')
        .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true)))
      .addSubcommand((s) => s.setName('punish').setDescription('عقوبة تلقائية عند وصول عدد معين من التحذيرات')
        .addIntegerOption((o) => o.setName('count').setDescription('عدد التحذيرات (0 = إيقاف)').setRequired(true).setMinValue(0).setMaxValue(20))
        .addStringOption((o) => o.setName('action').setDescription('العقوبة').setRequired(true)
          .addChoices({ name: 'تايم أوت', value: 'timeout' }, { name: 'طرد', value: 'kick' }, { name: 'باند', value: 'ban' }))
        .addStringOption((o) => o.setName('duration').setDescription('مدة التايم أوت مثل 1h'))),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const { guildId } = interaction;
      if (sub === 'list') {
        const user = interaction.options.getUser('user');
        const list = cases.forUser(guildId, user.id, 'warn');
        const body = list.length
          ? list.slice(0, 15).map((w) => `**#${w.number}** • ${ts(w.created_at)} • <@${w.mod_id}>\n${emoji.dot} ${truncate(w.reason || NO_REASON, 150)}`).join('\n\n')
          : 'ما عنده أي تحذير ✨';
        return interaction.reply({
          embeds: [simple(body, 'primary', `⚠️ تحذيرات ${user.username} (${list.length})`).setThumbnail(user.displayAvatarURL())],
        });
      }
      if (sub === 'remove') {
        const number = interaction.options.getInteger('case');
        const found = cases.byNumber(guildId, number);
        if (!found || found.action !== 'warn') return reply.error(interaction, 'ما لقيت تحذير بهذا الرقم.');
        cases.remove(guildId, number);
        return reply.success(interaction, `تم حذف التحذير **#${number}** عن <@${found.user_id}>`, { hidden: false });
      }
      if (sub === 'clear') {
        const user = interaction.options.getUser('user');
        const removed = cases.clearWarnings(guildId, user.id);
        return reply.success(interaction, `تم مسح \`${removed}\` تحذير عن ${user}`, { hidden: false });
      }
      const count = interaction.options.getInteger('count');
      const action = interaction.options.getString('action');
      const duration = parseDuration(interaction.options.getString('duration') || '1h');
      if (action === 'timeout' && (!duration || duration > MAX_TIMEOUT)) return reply.error(interaction, 'مدة غير صحيحة.');
      store.update(guildId, 'admin', (cfg) => {
        cfg.warnPunish = { enabled: count > 0, at: count || 3, action, duration };
      });
      return reply.success(interaction, count > 0
        ? `كل \`${count}\` تحذيرات = **${cases.ACTIONS[action].label}**${action === 'timeout' ? ` لمدة ${formatDuration(duration)}` : ''}`
        : 'تم إيقاف العقوبة التلقائية.');
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('history')
      .setDescription('سجل العقوبات الكامل لعضو')
      .setDefaultMemberPermissions(P.ModerateMembers)
      .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true)),
    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const list = cases.forUser(interaction.guildId, user.id);
      const body = list.length
        ? list.slice(0, 20).map((c) => `${cases.ACTIONS[c.action]?.emoji || '•'} **#${c.number}** ${cases.ACTIONS[c.action]?.label || c.action} • ${ts(c.created_at)}\n${emoji.dot} ${truncate(c.reason || NO_REASON, 120)}`).join('\n')
        : 'سجله نظيف ✨';
      await interaction.reply({ embeds: [simple(body, 'primary', `📜 سجل ${user.username} (${list.length})`).setThumbnail(user.displayAvatarURL())] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('clear')
      .setDescription('مسح رسائل من الروم')
      .setDefaultMemberPermissions(P.ManageMessages)
      .addIntegerOption((o) => o.setName('amount').setDescription('العدد (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
      .addUserOption((o) => o.setName('user').setDescription('مسح رسائل عضو معين فقط'))
      .addBooleanOption((o) => o.setName('bots').setDescription('مسح رسائل البوتات فقط')),
    async execute(interaction) {
      const amount = interaction.options.getInteger('amount');
      const user = interaction.options.getUser('user');
      const botsOnly = interaction.options.getBoolean('bots');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let messages = await interaction.channel.messages.fetch({ limit: 100 });
      if (user) messages = messages.filter((m) => m.author.id === user.id);
      if (botsOnly) messages = messages.filter((m) => m.author.bot);
      const deleted = await interaction.channel.bulkDelete([...messages.values()].slice(0, amount), true);
      await interaction.editReply({ embeds: [simple(`🧹 تم مسح \`${deleted.size}\` رسالة.${deleted.size < amount ? '\n(الرسائل الأقدم من 14 يوم ما تنمسح)' : ''}`, 'success')] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('lock')
      .setDescription('قفل الروم عن الأعضاء')
      .setDefaultMemberPermissions(P.ManageChannels)
      .addChannelOption(channelOpt)
      .addStringOption(reasonOpt),
    execute: (i) => setChannelPerm(i, { SendMessages: false, Connect: false, SendMessagesInThreads: false }, '🔒 تم قفل'),
  },
  {
    data: new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('فتح الروم للأعضاء')
      .setDefaultMemberPermissions(P.ManageChannels)
      .addChannelOption(channelOpt)
      .addStringOption(reasonOpt),
    execute: (i) => setChannelPerm(i, { SendMessages: null, Connect: null, SendMessagesInThreads: null }, '🔓 تم فتح'),
  },
  {
    data: new SlashCommandBuilder()
      .setName('hide')
      .setDescription('إخفاء الروم عن الأعضاء')
      .setDefaultMemberPermissions(P.ManageChannels)
      .addChannelOption(channelOpt)
      .addStringOption(reasonOpt),
    execute: (i) => setChannelPerm(i, { ViewChannel: false }, '🙈 تم إخفاء'),
  },
  {
    data: new SlashCommandBuilder()
      .setName('show')
      .setDescription('إظهار الروم للأعضاء')
      .setDefaultMemberPermissions(P.ManageChannels)
      .addChannelOption(channelOpt)
      .addStringOption(reasonOpt),
    execute: (i) => setChannelPerm(i, { ViewChannel: null }, '👁️ تم إظهار'),
  },
  {
    data: new SlashCommandBuilder()
      .setName('slowmode')
      .setDescription('وضع البطء في الروم')
      .setDefaultMemberPermissions(P.ManageChannels)
      .addStringOption((o) => o.setName('duration').setDescription('مثل 5s أو 1m أو 0 للإيقاف').setRequired(true))
      .addChannelOption((o) => o.setName('channel').setDescription('الروم').addChannelTypes(ChannelType.GuildText)),
    async execute(interaction) {
      const raw = interaction.options.getString('duration');
      const ms = raw === '0' ? 0 : parseDuration(raw.match(/^\d+$/) ? `${raw}s` : raw);
      if (ms == null || ms > 21_600_000) return reply.error(interaction, 'مدة غير صحيحة (أقصى شي 6h).');
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      await channel.setRateLimitPerUser(Math.floor(ms / 1000));
      await interaction.reply({ embeds: [simple(ms ? `🐢 وضع البطء في ${channel}: **${formatDuration(ms)}**` : `⚡ تم إيقاف وضع البطء في ${channel}`)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('nick')
      .setDescription('تغيير لقب عضو')
      .setDefaultMemberPermissions(P.ManageNicknames)
      .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true))
      .addStringOption((o) => o.setName('nickname').setDescription('اللقب الجديد (فاضي = إعادة تعيين)').setMaxLength(32)),
    async execute(interaction) {
      const member = interaction.options.getMember('user');
      if (!member) return reply.error(interaction, 'العضو مو موجود.');
      if (member.id !== interaction.user.id) {
        const problem = checkTarget(interaction, member, 'تغيير اللقب');
        if (problem) return reply.error(interaction, problem);
      }
      const nick = interaction.options.getString('nickname');
      await member.setNickname(nick || null, `by ${interaction.user.tag}`);
      return reply.success(interaction, nick ? `تم تغيير لقب ${member} إلى **${nick}**` : `تم إعادة لقب ${member}`, { hidden: false });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('role')
      .setDescription('إعطاء وسحب الرتب')
      .setDefaultMemberPermissions(P.ManageRoles)
      .addSubcommand((s) => s.setName('add').setDescription('إعطاء رتبة لعضو')
        .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('الرتبة').setRequired(true)))
      .addSubcommand((s) => s.setName('remove').setDescription('سحب رتبة من عضو')
        .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('الرتبة').setRequired(true)))
      .addSubcommand((s) => s.setName('info').setDescription('معلومات رتبة')
        .addRoleOption((o) => o.setName('role').setDescription('الرتبة').setRequired(true))),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const role = interaction.options.getRole('role');
      if (sub === 'info') {
        return interaction.reply({
          embeds: [simple([
            `${emoji.dot} **الاسم:** ${role}`, `${emoji.dot} **الآيدي:** \`${role.id}\``,
            `${emoji.dot} **اللون:** \`${role.hexColor}\``, `${emoji.dot} **الأعضاء:** \`${role.members.size}\``,
            `${emoji.dot} **الترتيب:** \`${role.position}\``, `${emoji.dot} **أُنشئت:** ${ts(role.createdAt, 'D')}`,
          ].join('\n'), role.color || colors.primary, '🎭 معلومات الرتبة')],
        });
      }
      const member = interaction.options.getMember('user');
      if (!member) return reply.error(interaction, 'العضو مو موجود.');
      const problem = canManageRole(interaction, role);
      if (problem) return reply.error(interaction, problem);
      if (sub === 'add') {
        await member.roles.add(role, `by ${interaction.user.tag}`);
        return reply.success(interaction, `تم إعطاء ${role} لـ ${member}`, { hidden: false });
      }
      await member.roles.remove(role, `by ${interaction.user.tag}`);
      return reply.success(interaction, `تم سحب ${role} من ${member}`, { hidden: false });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('say')
      .setDescription('إرسال رسالة باسم البوت')
      .setDefaultMemberPermissions(P.ManageMessages)
      .addStringOption((o) => o.setName('message').setDescription('الرسالة (استخدم \\n لسطر جديد)').setRequired(true).setMaxLength(2000))
      .addChannelOption((o) => o.setName('channel').setDescription('الروم').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addBooleanOption((o) => o.setName('embed').setDescription('داخل إمبد بثيم Sword')),
    async execute(interaction) {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const text = interaction.options.getString('message').replace(/\\n/g, '\n');
      const payload = interaction.options.getBoolean('embed')
        ? { embeds: [simple(text)] }
        : { content: text };
      await channel.send({ ...payload, allowedMentions: { parse: [] } });
      return reply.success(interaction, `تم الإرسال في ${channel}`);
    },
  },
];

module.exports = {
  id: 'admin',
  name: 'Admin Plugin',
  nameAr: 'بلوقن الإدارة',
  emoji: '👤',
  description: 'باند، طرد، تايم أوت، تحذيرات بعقوبات تلقائية، مسح، قفل وإخفاء الرومات، والرتب.',
  defaults: {
    warnPunish: { enabled: true, at: 3, action: 'timeout', duration: 3_600_000 },
  },
  dashboard: [
    {
      title: '⚠️ العقوبة التلقائية للتحذيرات',
      fields: [
        { key: 'warnPunish.enabled', type: 'bool', label: 'تفعيل العقوبة التلقائية' },
        { key: 'warnPunish.at', type: 'number', label: 'كل كم تحذير', min: 1, max: 20 },
        { key: 'warnPunish.action', type: 'select', label: 'العقوبة', options: [{ value: 'timeout', label: 'تايم أوت' }, { value: 'kick', label: 'طرد' }, { value: 'ban', label: 'باند' }] },
        { key: 'warnPunish.duration', type: 'number', label: 'مدة التايم أوت (دقائق)', min: 1, max: 40320, scale: 60_000 },
      ],
    },
  ],
  commands,
};

