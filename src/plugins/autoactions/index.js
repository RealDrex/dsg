const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const store = require('../../core/store');
const { file, emoji, DIVIDER, reply } = require('../../core/theme');
const { fill } = require('../../utils/text');
const { I } = require('../../core/icons');

const MATCH = {
  exact: { label: 'مطابق تماماً', test: (text, t) => text === t },
  contains: { label: 'يحتوي', test: (text, t) => text.includes(t) },
  starts: { label: 'يبدأ بـ', test: (text, t) => text.startsWith(t) },
};

async function onMessage(message) {
  if (!message.inGuild() || message.author.bot) return;
  const cfg = store.get(message.guildId, 'autoactions');
  const text = message.content.trim().toLowerCase();

  const rule = text && cfg.replies.find((r) => MATCH[r.match]?.test(text, r.trigger));
  if (rule) {
    const content = fill(rule.response, { user: `${message.author}`, username: message.author.username, server: message.guild.name });
    const payload = { content };
    if (rule.reply) await message.reply(payload).catch(() => null);
    else await message.channel.send(payload).catch(() => null);
  }

  const react = cfg.reactions.find((r) => r.channelId === message.channelId);
  if (react) for (const e of react.emojis) await message.react(e).catch(() => null);

  if (cfg.lines.channels.includes(message.channelId)) {
    const payload = cfg.lines.image ? { content: cfg.lines.image } : { files: [file('line')] };
    await message.channel.send(payload).catch(() => null);
  }
}

const textChannel = (o) => o.setName('channel').setDescription('الروم').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
const P = PermissionFlagsBits.ManageGuild;

const replyData = new SlashCommandBuilder()
  .setName('autoreply')
  .setDescription('الردود التلقائية')
  .setDefaultMemberPermissions(P)
  .addSubcommand((s) => s.setName('add').setDescription('إضافة رد تلقائي')
    .addStringOption((o) => o.setName('trigger').setDescription('الكلمة اللي تشغّل الرد').setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName('response').setDescription('الرد — {user} {username} {server} و \\n لسطر جديد').setRequired(true).setMaxLength(1800))
    .addStringOption((o) => o.setName('match').setDescription('طريقة المطابقة').addChoices(
      { name: 'مطابق تماماً', value: 'exact' }, { name: 'يحتوي', value: 'contains' }, { name: 'يبدأ بـ', value: 'starts' }))
    .addBooleanOption((o) => o.setName('reply').setDescription('رد على الرسالة نفسها (Reply)')))
  .addSubcommand((s) => s.setName('remove').setDescription('حذف رد تلقائي')
    .addStringOption((o) => o.setName('trigger').setDescription('الكلمة').setRequired(true).setAutocomplete(true)))
  .addSubcommand((s) => s.setName('list').setDescription('عرض الردود التلقائية'));

async function replyCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const o = interaction.options;
  const { guildId } = interaction;
  if (sub === 'list') {
    const list = store.get(guildId, 'autoactions').replies;
    const body = list.map((r) => `${emoji.dot} \`${r.trigger}\` (${MATCH[r.match].label}) ← ${r.response.slice(0, 60)}`);
    return reply.info(interaction, `${I.message} **الردود التلقائية (${list.length})**\n${DIVIDER}\n${body.join('\n') || '—'}`);
  }
  const trigger = o.getString('trigger').trim().toLowerCase();
  store.update(guildId, 'autoactions', (cfg) => {
    cfg.replies = cfg.replies.filter((r) => r.trigger !== trigger);
    if (sub === 'add') {
      cfg.replies.push({
        trigger,
        response: o.getString('response').replace(/\\n/g, '\n'),
        match: o.getString('match') || 'exact',
        reply: o.getBoolean('reply') ?? true,
      });
    }
  });
  return reply.success(interaction, sub === 'add' ? `تمت إضافة الرد على \`${trigger}\`` : `تم حذف الرد \`${trigger}\``);
}

const reactData = new SlashCommandBuilder()
  .setName('autoreact')
  .setDescription('رياكشن تلقائي على كل رسالة في روم')
  .setDefaultMemberPermissions(P)
  .addSubcommand((s) => s.setName('add').setDescription('تحديد إيموجيات لروم')
    .addChannelOption(textChannel)
    .addStringOption((o) => o.setName('emojis').setDescription('الإيموجيات مفصولة بمسافة (حد أقصى 5)').setRequired(true)))
  .addSubcommand((s) => s.setName('remove').setDescription('إيقاف الرياكشن في روم').addChannelOption(textChannel))
  .addSubcommand((s) => s.setName('list').setDescription('عرض رومات الرياكشن'));

async function reactCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const { guildId } = interaction;
  if (sub === 'list') {
    const list = store.get(guildId, 'autoactions').reactions;
    return reply.info(interaction, `${I.react} **الرياكشن التلقائي**\n${DIVIDER}\n${list.map((r) => `<#${r.channelId}> ← ${r.emojis.join(' ')}`).join('\n') || '—'}`);
  }
  const channel = interaction.options.getChannel('channel');
  const emojis = sub === 'add' ? interaction.options.getString('emojis').split(/\s+/).filter(Boolean).slice(0, 5) : [];
  store.update(guildId, 'autoactions', (cfg) => {
    cfg.reactions = cfg.reactions.filter((r) => r.channelId !== channel.id);
    if (emojis.length) cfg.reactions.push({ channelId: channel.id, emojis });
  });
  return reply.success(interaction, emojis.length ? `${channel} ← ${emojis.join(' ')}` : `تم إيقاف الرياكشن في ${channel}`);
}

const lineData = new SlashCommandBuilder()
  .setName('autoline')
  .setDescription('خط فاصل تلقائي بعد كل رسالة (خط سيف Sword)')
  .setDefaultMemberPermissions(P)
  .addSubcommand((s) => s.setName('add').setDescription('تفعيل الخط في روم').addChannelOption(textChannel))
  .addSubcommand((s) => s.setName('remove').setDescription('إيقاف الخط في روم').addChannelOption(textChannel))
  .addSubcommand((s) => s.setName('image').setDescription('صورة خط مخصصة (فاضي = خط سيف Sword)')
    .addStringOption((o) => o.setName('url').setDescription('رابط الصورة')))
  .addSubcommand((s) => s.setName('list').setDescription('عرض رومات الخط'));

async function lineCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const { guildId } = interaction;
  if (sub === 'list') {
    const cfg = store.get(guildId, 'autoactions').lines;
    return reply.info(interaction, `${I.blade} **الخط التلقائي**\n${DIVIDER}\n${cfg.channels.map((id) => `<#${id}>`).join(' ') || '—'}\nالصورة: ${cfg.image || 'خط سيف Sword'}`);
  }
  if (sub === 'image') {
    const url = interaction.options.getString('url');
    if (url && !/^https?:\/\/\S+$/i.test(url)) return reply.error(interaction, 'رابط غير صحيح.');
    store.update(guildId, 'autoactions', (cfg) => { cfg.lines.image = url || null; });
    return reply.success(interaction, url ? 'تم تحديث صورة الخط.' : `رجع خط سيف Sword الافتراضي ${I.sword}`);
  }
  const channel = interaction.options.getChannel('channel');
  store.update(guildId, 'autoactions', (cfg) => {
    cfg.lines.channels = cfg.lines.channels.filter((id) => id !== channel.id);
    if (sub === 'add') cfg.lines.channels.push(channel.id);
  });
  return reply.success(interaction, sub === 'add' ? `تم تفعيل الخط في ${channel}` : `تم إيقاف الخط في ${channel}`);
}

module.exports = {
  id: 'autoactions',
  name: 'Autoactions',
  nameAr: 'الرد والرياكشن والخطوط التلقائية',
  emoji: I.autoactions,
  description: 'ردود تلقائية، رياكشن تلقائي على رومات، وخط سيف فاصل بعد الرسائل.',
  defaults: { replies: [], reactions: [], lines: { channels: [], image: null } },
  commands: [
    {
      data: replyData,
      execute: replyCommand,
      async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const list = store.get(interaction.guildId, 'autoactions').replies;
        await interaction.respond(list.filter((r) => r.trigger.includes(focused)).slice(0, 25).map((r) => ({ name: r.trigger.slice(0, 100), value: r.trigger.slice(0, 100) })));
      },
    },
    { data: reactData, execute: reactCommand },
    { data: lineData, execute: lineCommand },
  ],
  dashboard: [
    {
      title: 'الردود التلقائية', icon: 'message',
      description: 'المتغيرات في الرد: {user} {username} {server}',
      fields: [
        {
          key: 'replies', type: 'list', label: 'الردود', addLabel: 'إضافة رد', max: 100,
          fields: [
            { key: 'trigger', type: 'text', label: 'الكلمة', max: 200, required: true },
            { key: 'response', type: 'textarea', label: 'الرد', max: 1800, required: true },
            { key: 'match', type: 'select', label: 'المطابقة', options: Object.entries(MATCH).map(([value, m]) => ({ value, label: m.label })) },
            { key: 'reply', type: 'bool', label: 'رد على الرسالة نفسها' },
          ],
        },
      ],
    },
    {
      title: 'الرياكشن التلقائي', icon: 'react',
      fields: [
        {
          key: 'reactions', type: 'list', label: 'الرومات', addLabel: 'إضافة روم', max: 50,
          fields: [
            { key: 'channelId', type: 'channel', label: 'الروم', required: true },
            { key: 'emojis', type: 'tags', label: 'الإيموجيات', max: 5, itemMax: 64 },
          ],
        },
      ],
    },
    {
      title: 'الخط التلقائي', icon: 'blade',
      fields: [
        { key: 'lines.channels', type: 'channels', label: 'رومات الخط' },
        { key: 'lines.image', type: 'text', label: 'رابط صورة خط مخصصة', max: 500, nullable: true, pattern: '^https?://\\S+$', hint: 'فاضي = خط سيف Sword' },
      ],
    },
  ],
  validate(cfg) {
    cfg.replies = cfg.replies.map((r) => ({ ...r, trigger: r.trigger.trim().toLowerCase(), match: r.match || 'exact' }));
    cfg.reactions = cfg.reactions.filter((r) => r.channelId && r.emojis.length);
  },
  events: { messageCreate: onMessage },
};
