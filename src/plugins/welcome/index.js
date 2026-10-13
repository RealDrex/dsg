const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const store = require('../../core/store');
const { card, simple, emoji, DIVIDER, reply, file } = require('../../core/theme');
const { fill, memberVars } = require('../../utils/text');
const { userError } = require('../../core/errors');
const { I } = require('../../core/icons');

const VARS_HELP = '`{user}` منشن • `{username}` الاسم • `{server}` السيرفر • `{count}` عدد الأعضاء';

// Wrap a Latin/mixed token in isolate marks so it doesn't scramble the RTL line.
const iso = (s) => `⁨${s}⁩`;

function welcomePayload(member, cfg) {
  const vars = { ...memberVars(member), server: iso(member.guild.name) };
  let text = fill(cfg.message, vars);
  const users = cfg.mention ? [member.id] : [];
  if (cfg.ownerId) {
    text += `\n${I.crown} ${iso(`<@${cfg.ownerId}>`)}`;
    users.push(cfg.ownerId);
  }
  const payload = { content: text, allowedMentions: { users } };
  if (cfg.image) payload.files = [file('welcome')];
  return payload;
}

async function onJoin(member) {
  const cfg = store.get(member.guild.id, 'welcome');
  if (cfg.channelId) {
    const channel = member.guild.channels.cache.get(cfg.channelId);
    await channel?.send(welcomePayload(member, cfg)).catch(() => null);
  }
  if (cfg.dm.enabled && !member.user.bot) {
    await member.send({ content: `${emoji.sword} **${member.guild.name}**\n${fill(cfg.dm.message, memberVars(member))}` }).catch(() => null);
  }
}

async function onLeave(member) {
  const cfg = store.get(member.guild.id, 'welcome');
  if (!cfg.leave.channelId) return;
  const channel = member.guild.channels.cache.get(cfg.leave.channelId);
  await channel?.send({ content: fill(cfg.leave.message, memberVars(member)), allowedMentions: { parse: [] } }).catch(() => null);
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
    .addBooleanOption((o) => o.setName('mention').setDescription('منشن العضو الجديد')))
  .addSubcommand((s) => s.setName('owner').setDescription('منشن الأونرشيب في رسالة الترحيب')
    .addUserOption((o) => o.setName('user').setDescription('الأونر — فاضي = إلغاء المنشن')))
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
    case 'owner': {
      const u = o.getUser('user');
      set((cfg) => { cfg.ownerId = u?.id || ''; });
      return reply.success(interaction, u ? `بيتمنشن الأونرشيب ${u} بكل ترحيب.` : 'تم إلغاء منشن الأونرشيب.');
    }
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
  name: 'Welcome',
  nameAr: 'الترحيب',
  emoji: I.welcome,
  description: 'ترحيب بإمبد وبانر Sword، رسالة خاص للعضو الجديد، ورسالة مغادرة.',
  defaults: {
    channelId: null,
    message: 'حيّاك الله {user} في ⁨Sword⁩',
    ownerId: '',
    image: true,
    mention: true,
    dm: { enabled: false, message: 'أهلاً {username}! حيّاك في **{server}**\nلا تنسى تقرأ القوانين.' },
    leave: { channelId: null, message: '**{username}** غادر السيرفر... صرنا {count}' },
  },
  dashboard: [
    {
      title: 'الترحيب', icon: 'welcome',
      description: 'المتغيرات: {user} منشن • {username} الاسم • {server} السيرفر • {count} عدد الأعضاء',
      fields: [
        { key: 'channelId', type: 'channel', label: 'روم الترحيب', hint: 'فاضي = الترحيب مقفل' },
        { key: 'message', type: 'textarea', label: 'رسالة الترحيب', max: 1500 },
        { key: 'image', type: 'bool', label: 'بانر WELCOME الساموراي' },
        { key: 'mention', type: 'bool', label: 'منشن العضو الجديد' },
        { key: 'ownerId', type: 'text', label: 'آيدي الأونرشيب (ينمنشن بكل ترحيب)', hint: 'فاضي = بدون منشن' },
      ],
    },
    {
      title: 'رسالة الخاص', icon: 'mail',
      fields: [
        { key: 'dm.enabled', type: 'bool', label: 'إرسال رسالة خاص للعضو الجديد' },
        { key: 'dm.message', type: 'textarea', label: 'نص رسالة الخاص', max: 1500 },
      ],
    },
    {
      title: 'المغادرة', icon: 'leave',
      fields: [
        { key: 'leave.channelId', type: 'channel', label: 'روم المغادرة', hint: 'فاضي = مقفل' },
        { key: 'leave.message', type: 'textarea', label: 'رسالة المغادرة', max: 1500 },
      ],
    },
  ],
  actions: {
    test: {
      label: 'تجربة الترحيب',
      description: 'يرسل رسالة ترحيب تجريبية في روم الترحيب باسم البوت',
      async run(guild) {
        const cfg = store.get(guild.id, 'welcome');
        const channel = cfg.channelId && guild.channels.cache.get(cfg.channelId);
        if (!channel) throw userError('حدد روم الترحيب واحفظ أول');
        await channel.send(welcomePayload(guild.members.me, cfg));
        return `تم الإرسال في #${channel.name}`;
      },
    },
  },
  commands: [{ data, execute }],
  events: { guildMemberAdd: onJoin, guildMemberRemove: onLeave },
};
