const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const store = require('../../core/store');
const { card, simple, emoji, DIVIDER, reply } = require('../../core/theme');
const { fill, memberVars } = require('../../utils/text');

const VARS_HELP = '`{user}` منشن • `{username}` الاسم • `{server}` السيرفر • `{count}` عدد الأعضاء';

function welcomePayload(member, cfg) {
  const { embed, files } = card({
    title: `${emoji.gate} أهلاً بك في ${member.guild.name}`,
    description: `${fill(cfg.message, memberVars(member))}\n${DIVIDER}`,
    thumbnail: member.user.displayAvatarURL({ size: 256 }),
    image: cfg.image ? 'welcome' : undefined,
    footer: `Sword • العضو رقم ${member.guild.memberCount}`,
  });
  return { content: cfg.mention ? `${member}` : undefined, embeds: [embed], files };
}

async function onJoin(member) {
  const cfg = store.get(member.guild.id, 'welcome');
  if (cfg.channelId) {
    const channel = member.guild.channels.cache.get(cfg.channelId);
    await channel?.send(welcomePayload(member, cfg)).catch(() => null);
  }
  if (cfg.dm.enabled && !member.user.bot) {
    await member.send({ embeds: [simple(fill(cfg.dm.message, memberVars(member)), 'primary', `${emoji.sword} ${member.guild.name}`)] }).catch(() => null);
  }
}

async function onLeave(member) {
  const cfg = store.get(member.guild.id, 'welcome');
  if (!cfg.leave.channelId) return;
  const channel = member.guild.channels.cache.get(cfg.leave.channelId);
  await channel?.send({
    embeds: [simple(fill(cfg.leave.message, memberVars(member)), 'warn').setThumbnail(member.user.displayAvatarURL())],
  }).catch(() => null);
}

const textChannel = (o, required = true) =>
  o.setName('channel').setDescription('الروم').setRequired(required).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

const data = new SlashCommandBuilder()
  .setName('welcome')
  .setDescription('إعدادات الترحيب والمغادرة')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('channel').setDescription('روم الترحيب').addChannelOption((o) => textChannel(o)))
  .addSubcommand((s) => s.setName('message').setDescription('رسالة الترحيب (\\n لسطر جديد)')
    .addStringOption((o) => o.setName('text').setDescription('النص — المتغيرات: {user} {username} {server} {count}').setRequired(true).setMaxLength(1500)))
  .addSubcommand((s) => s.setName('style').setDescription('شكل رسالة الترحيب')
    .addBooleanOption((o) => o.setName('image').setDescription('صورة بانر Sword').setRequired(true))
    .addBooleanOption((o) => o.setName('mention').setDescription('منشن العضو فوق الإمبد')))
  .addSubcommand((s) => s.setName('dm').setDescription('رسالة خاص للعضو الجديد')
    .addBooleanOption((o) => o.setName('enabled').setDescription('تفعيل').setRequired(true))
    .addStringOption((o) => o.setName('text').setDescription('النص').setMaxLength(1500)))
  .addSubcommand((s) => s.setName('leave').setDescription('رسالة المغادرة')
    .addChannelOption((o) => textChannel(o))
    .addStringOption((o) => o.setName('text').setDescription('النص').setMaxLength(1500)))
  .addSubcommand((s) => s.setName('test').setDescription('تجربة رسالة الترحيب عليك'))
  .addSubcommand((s) => s.setName('disable').setDescription('إيقاف الترحيب والمغادرة'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const o = interaction.options;
  const set = (fn) => store.update(interaction.guildId, 'welcome', fn);
  const text = () => o.getString('text')?.replace(/\\n/g, '\n');

  switch (sub) {
    case 'channel':
      set((cfg) => { cfg.channelId = o.getChannel('channel').id; });
      return reply.success(interaction, `روم الترحيب صار ${o.getChannel('channel')}`);
    case 'message':
      set((cfg) => { cfg.message = text(); });
      return reply.success(interaction, `تم تحديث رسالة الترحيب.\n${VARS_HELP}`);
    case 'style':
      set((cfg) => {
        cfg.image = o.getBoolean('image');
        cfg.mention = o.getBoolean('mention') ?? cfg.mention;
      });
      return reply.success(interaction, 'تم تحديث شكل الترحيب.');
    case 'dm':
      set((cfg) => {
        cfg.dm.enabled = o.getBoolean('enabled');
        if (text()) cfg.dm.message = text();
      });
      return reply.success(interaction, o.getBoolean('enabled') ? 'تم تفعيل رسالة الخاص.' : 'تم إيقاف رسالة الخاص.');
    case 'leave':
      set((cfg) => {
        cfg.leave.channelId = o.getChannel('channel').id;
        if (text()) cfg.leave.message = text();
      });
      return reply.success(interaction, `رسائل المغادرة بتنرسل في ${o.getChannel('channel')}`);
    case 'test':
      return interaction.reply(welcomePayload(interaction.member, store.get(interaction.guildId, 'welcome')));
    case 'disable':
      set((cfg) => {
        cfg.channelId = null;
        cfg.leave.channelId = null;
        cfg.dm.enabled = false;
      });
      return reply.success(interaction, 'تم إيقاف الترحيب والمغادرة.');
  }
}

module.exports = {
  id: 'welcome',
  name: 'Welcome Plugin',
  nameAr: 'بلوقن الترحيب',
  emoji: '👋',
  description: 'ترحيب بإمبد وبانر Sword، رسالة خاص للعضو الجديد، ورسالة مغادرة.',
  defaults: {
    channelId: null,
    message: 'حيّاك الله {user} في **{server}** ⚔️\nأنت العضو رقم **{count}** — نورت السيرفر!',
    image: true,
    mention: true,
    dm: { enabled: false, message: 'أهلاً {username}! حيّاك في **{server}** ⚔️\nلا تنسى تقرأ القوانين.' },
    leave: { channelId: null, message: '🍂 **{username}** غادر السيرفر... صرنا {count}' },
  },
  commands: [{ data, execute }],
  events: { guildMemberAdd: onJoin, guildMemberRemove: onLeave },
};
