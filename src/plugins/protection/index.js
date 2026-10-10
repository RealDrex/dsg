const {
  SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder,
  MessageFlags, AuditLogEvent, ChannelType,
} = require('discord.js');
const store = require('../../core/store');
const cases = require('../../core/cases');
const { card, simple, emoji, DIVIDER, reply } = require('../../core/theme');
const { formatDuration } = require('../../utils/time');
const { I, asEmoji } = require('../../core/icons');

const FEATURES = {
  antiSpam: { label: 'مضاد السبام', emoji: I.message, desc: 'تايم أوت لمن يرسل رسائل كثيرة بسرعة' },
  antiLink: { label: 'مضاد الروابط', emoji: I.link, desc: 'حذف روابط الدعوات أو كل الروابط' },
  antiMention: { label: 'مضاد المنشن', emoji: I.mention, desc: 'منع المنشن الجماعي' },
  badWords: { label: 'فلتر الكلمات', emoji: I.muted, desc: 'حذف الرسائل اللي فيها كلمات ممنوعة' },
  antiRaid: { label: 'مضاد الرايد', emoji: I.raid, desc: 'طرد الداخلين وقت دخول جماعي مشبوه' },
  antiNuke: { label: 'مضاد التخريب', emoji: I.nuke, desc: 'سحب رتب من يحذف رومات/رتب أو يبند بكثرة' },
  antiBot: { label: 'مضاد البوتات', emoji: I.bot, desc: 'طرد أي بوت يضيفه شخص مو بالوايت ليست' },
};

const INVITE_RE = /(discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg)\/[\w-]+/i;
const LINK_RE = /https?:\/\/\S+|www\.\S+\.\S+/i;

// Ready-made Arabic profanity list (admins can add/remove from the dashboard).
const DEFAULT_BAD_WORDS = [
  'كس', 'كسم', 'كسمك', 'كسختك', 'قحبه', 'قحاب', 'شرموط', 'شرموطه', 'عاهره', 'زب', 'زبي',
  'طيز', 'منيك', 'منيوك', 'متناك', 'متناكه', 'نيك', 'نياك', 'انيك', 'خول', 'خوله', 'لوطي',
  'زاني', 'زانيه', 'عرص', 'معرص', 'وسخه', 'حقير', 'كلب', 'حيوان', 'يلعن', 'لعنه',
];

// Normalise Arabic for matching: drop diacritics/tatweel, unify letter forms,
// and collapse 3+ repeats (so "كسسس" == "كس").
function normalizeAr(s) {
  return String(s || '').toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/(.)\1{2,}/g, '$1');
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A banned word hits only as a whole token (bounded by non-letters/digits), so
// clean words like "اعلايك" or "مكسب" aren't flagged by a short banned word.
function hasBadWord(content, words) {
  const text = normalizeAr(content);
  if (!text) return false;
  return words.some((w) => {
    const nw = normalizeAr(w);
    if (!nw) return false;
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(nw)}($|[^\\p{L}\\p{N}])`, 'u').test(text);
  });
}

const spamTracker = new Map(); // guild:user -> [timestamps]
const joinTracker = new Map(); // guild -> [timestamps]
const raidUntil = new Map(); // guild -> timestamp
const nukeTracker = new Map(); // guild:executor -> [timestamps]

function track(map, key, windowMs) {
  const now = Date.now();
  const list = (map.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  map.set(key, list);
  return list.length;
}

const cfgOf = (guildId) => store.get(guildId, 'protection');

function isWhitelisted(member, cfg) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  if (cfg.whitelist.users.includes(member.id)) return true;
  return member.roles?.cache?.some((r) => cfg.whitelist.roles.includes(r.id)) ?? false;
}

const bypassFilters = (member, cfg) =>
  isWhitelisted(member, cfg) || member.permissions.has(PermissionFlagsBits.ManageMessages);

function alert(guild, title, description) {
  guild.client.emit('swordProtection', guild, { title, description });
}

async function warnInChannel(message, text) {
  await message.delete().catch(() => null);
  const notice = await message.channel.send({ content: `${message.author}`, embeds: [simple(`${emoji.error} ${text}`, 'error')] }).catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => null), 6000);
}

// Delete the message, then tell the author privately (in DM) why.
async function warnDM(message, text) {
  await message.delete().catch(() => null);
  await message.author.send({ embeds: [simple(`${emoji.error} ${text}\nالسيرفر: **${message.guild.name}**`, 'error')] }).catch(() => null);
}

async function punish(member, minutes, reason) {
  if (!member.moderatable) return;
  await member.timeout(minutes * 60_000, `Sword Protection: ${reason}`).catch(() => null);
  cases.create(member.guild, { action: 'auto', userId: member.id, modId: member.client.user.id, reason, duration: minutes * 60_000 });
}

async function onMessage(message) {
  if (!message.inGuild() || message.author.bot || !message.member) return;
  const cfg = cfgOf(message.guildId);
  if (cfg.ignoredChannels.includes(message.channelId) || bypassFilters(message.member, cfg)) return;
  const f = cfg.features;
  const content = message.content || '';

  if (f.badWords && cfg.words.length && hasBadWord(content, cfg.words)) {
    return warnDM(message, 'رسالتك فيها كلمة ممنوعة، انحذفت.');
  }

  if (f.antiLink && (cfg.links.invitesOnly ? INVITE_RE.test(content) : LINK_RE.test(content))) {
    return warnInChannel(message, cfg.links.invitesOnly ? 'ممنوع نشر روابط سيرفرات.' : 'ممنوع نشر الروابط هنا.');
  }

  if (f.antiMention) {
    const count = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 5 : 0);
    if (count >= cfg.mentions.max) {
      await warnInChannel(message, 'ممنوع المنشن الجماعي.');
      await punish(message.member, 10, `منشن جماعي (${count})`);
      return alert(message.guild, `${I.mention} منشن جماعي`, `${message.author} منشن \`${count}\` في ${message.channel} — تايم أوت 10 دقائق.`);
    }
  }

  if (f.antiSpam) {
    const key = `${message.guildId}:${message.author.id}`;
    const count = track(spamTracker, key, cfg.spam.seconds * 1000);
    if (count >= cfg.spam.messages) {
      spamTracker.delete(key);
      const recent = await message.channel.messages.fetch({ limit: 30 }).catch(() => null);
      if (recent) await message.channel.bulkDelete(recent.filter((m) => m.author.id === message.author.id), true).catch(() => null);
      if (cfg.spam.action === 'kick' && message.member.kickable) {
        await message.member.kick('Sword Protection: سبام');
        cases.create(message.guild, { action: 'auto', userId: message.author.id, modId: message.client.user.id, reason: 'سبام — طرد' });
      } else {
        await punish(message.member, cfg.spam.minutes, 'سبام');
      }
      await message.channel.send({ embeds: [simple(`${emoji.error} ${message.author} تم معاقبته بسبب السبام.`, 'error')] })
        .then((m) => setTimeout(() => m.delete().catch(() => null), 6000)).catch(() => null);
      alert(message.guild, `${I.message} سبام`, `${message.author} أرسل \`${count}\` رسائل خلال ${cfg.spam.seconds} ثواني في ${message.channel}.`);
    }
  }
}

async function onJoin(member) {
  const cfg = cfgOf(member.guild.id);
  const { guild } = member;

  if (cfg.features.antiBot && member.user.bot) {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 3 }).catch(() => null);
    const entry = logs?.entries.find((e) => e.target?.id === member.id);
    const adder = entry?.executor ? await guild.members.fetch(entry.executor.id).catch(() => null) : null;
    if (!isWhitelisted(adder, cfg) && member.kickable) {
      await member.kick('Sword Protection: بوت غير مصرح');
      alert(guild, `${I.bot} بوت غير مصرح`, `تم طرد البوت ${member.user.tag}${adder ? ` اللي أضافه ${adder}` : ''}.`);
    }
    return;
  }

  if (!cfg.features.antiRaid || member.user.bot) return;
  const now = Date.now();
  if ((raidUntil.get(guild.id) || 0) > now) {
    await member.send({ embeds: [simple(`${I.raid} سيرفر **${guild.name}** في وضع الحماية من الرايد حالياً، حاول تدخل بعد شوي.`, 'warn')] }).catch(() => null);
    if (member.kickable) await member.kick('Sword Protection: وضع الرايد');
    return;
  }
  const joins = track(joinTracker, guild.id, cfg.raid.seconds * 1000);
  if (joins >= cfg.raid.joins) {
    raidUntil.set(guild.id, now + cfg.raid.minutes * 60_000);
    joinTracker.delete(guild.id);
    alert(guild, `${I.siren} رايد!`, `دخل \`${joins}\` عضو خلال ${cfg.raid.seconds} ثانية.\nتم تفعيل وضع الرايد لمدة **${cfg.raid.minutes} دقائق** — أي أحد يدخل بينطرد.`);
  }
}

// Anti-nuke: find who did a destructive action through the audit log and count it.
async function onDestructive(guild, type, targetId, label) {
  const cfg = cfgOf(guild.id);
  if (!cfg.features.antiNuke) return;
  const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(() => null);
  const entry = logs?.entries.find((e) => (!targetId || e.targetId === targetId) && Date.now() - e.createdTimestamp < 10_000);
  const executor = entry?.executor;
  if (!executor || executor.id === guild.client.user.id) return;
  const member = await guild.members.fetch(executor.id).catch(() => null);
  if (!member || isWhitelisted(member, cfg)) return;

  const count = track(nukeTracker, `${guild.id}:${executor.id}`, cfg.nuke.seconds * 1000);
  if (count < cfg.nuke.limit) return;
  nukeTracker.delete(`${guild.id}:${executor.id}`);

  const me = guild.members.me;
  let result;
  if (member.user.bot && member.kickable) {
    await member.kick('Sword Anti-Nuke');
    result = 'تم طرد البوت';
  } else {
    const removable = member.roles.cache.filter((r) => r.id !== guild.id && !r.managed && r.position < me.roles.highest.position);
    await member.roles.remove(removable, 'Sword Anti-Nuke').catch(() => null);
    result = `تم سحب \`${removable.size}\` رتبة منه`;
  }
  cases.create(guild, { action: 'auto', userId: member.id, modId: guild.client.user.id, reason: `Anti-Nuke: ${label} ×${count}` });
  alert(guild, `${I.nuke} محاولة تخريب!`, `${member} سوّى **${label}** \`${count}\` مرات خلال ${cfg.nuke.seconds} ثانية.\n${result}.`);
}

function panel(interaction) {
  const cfg = cfgOf(interaction.guildId);
  const list = Object.entries(FEATURES)
    .map(([key, f]) => `${cfg.features[key] ? emoji.on : emoji.off} ${f.emoji} **${f.label}** — ${f.desc}`)
    .join('\n');
  const settings = [
    `${I.message} السبام: \`${cfg.spam.messages}\` رسائل / \`${cfg.spam.seconds}s\` ← ${cfg.spam.action === 'kick' ? 'طرد' : `تايم أوت ${cfg.spam.minutes}m`}`,
    `${I.link} الروابط: ${cfg.links.invitesOnly ? 'روابط الدعوات فقط' : 'كل الروابط'}`,
    `${I.mention} المنشن: الحد \`${cfg.mentions.max}\``,
    `${I.raid} الرايد: \`${cfg.raid.joins}\` دخول / \`${cfg.raid.seconds}s\` ← قفل \`${cfg.raid.minutes}m\``,
    `${I.nuke} التخريب: \`${cfg.nuke.limit}\` إجراءات / \`${cfg.nuke.seconds}s\``,
    `${I.muted} الكلمات الممنوعة: \`${cfg.words.length}\``,
    `${I.whitelist} الوايت ليست: \`${cfg.whitelist.users.length}\` عضو • \`${cfg.whitelist.roles.length}\` رتبة`,
  ].join('\n');
  const menu = new StringSelectMenuBuilder()
    .setCustomId('protection:toggle')
    .setPlaceholder('حدد الحمايات المفعلة')
    .setMinValues(0)
    .setMaxValues(Object.keys(FEATURES).length)
    .addOptions(Object.entries(FEATURES).map(([key, f]) => ({
      label: f.label, value: key, emoji: asEmoji(f.emoji), description: f.desc, default: !!cfg.features[key],
    })));
  const { embed, files } = card({
    title: 'لوحة الحماية', icon: 'protection',
    description: `${list}\n${DIVIDER}\n${settings}`,
  });
  return { embeds: [embed], files, components: [new ActionRowBuilder().addComponents(menu)], attachments: [] };
}

const data = new SlashCommandBuilder()
  .setName('protection')
  .setDescription('إعدادات نظام الحماية')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) => s.setName('panel').setDescription('لوحة الحماية: عرض الحالة وتفعيل/إيقاف الحمايات'))
  .addSubcommand((s) => s.setName('spam').setDescription('إعداد مضاد السبام')
    .addIntegerOption((o) => o.setName('messages').setDescription('عدد الرسائل').setRequired(true).setMinValue(3).setMaxValue(20))
    .addIntegerOption((o) => o.setName('seconds').setDescription('خلال كم ثانية').setRequired(true).setMinValue(2).setMaxValue(60))
    .addStringOption((o) => o.setName('action').setDescription('العقوبة').addChoices({ name: 'تايم أوت', value: 'timeout' }, { name: 'طرد', value: 'kick' }))
    .addIntegerOption((o) => o.setName('minutes').setDescription('مدة التايم أوت بالدقائق').setMinValue(1).setMaxValue(10080)))
  .addSubcommand((s) => s.setName('links').setDescription('إعداد مضاد الروابط')
    .addStringOption((o) => o.setName('mode').setDescription('وش ينمنع').setRequired(true)
      .addChoices({ name: 'روابط الدعوات فقط', value: 'invites' }, { name: 'كل الروابط', value: 'all' })))
  .addSubcommand((s) => s.setName('mentions').setDescription('الحد الأقصى للمنشن في رسالة')
    .addIntegerOption((o) => o.setName('max').setDescription('العدد').setRequired(true).setMinValue(2).setMaxValue(50)))
  .addSubcommand((s) => s.setName('raid').setDescription('إعداد مضاد الرايد')
    .addIntegerOption((o) => o.setName('joins').setDescription('عدد الداخلين').setRequired(true).setMinValue(3).setMaxValue(100))
    .addIntegerOption((o) => o.setName('seconds').setDescription('خلال كم ثانية').setRequired(true).setMinValue(3).setMaxValue(300))
    .addIntegerOption((o) => o.setName('minutes').setDescription('مدة وضع الرايد بالدقائق').setMinValue(1).setMaxValue(120)))
  .addSubcommand((s) => s.setName('nuke').setDescription('إعداد مضاد التخريب')
    .addIntegerOption((o) => o.setName('limit').setDescription('عدد الإجراءات (حذف روم/رتبة، باند، طرد)').setRequired(true).setMinValue(2).setMaxValue(20))
    .addIntegerOption((o) => o.setName('seconds').setDescription('خلال كم ثانية').setRequired(true).setMinValue(5).setMaxValue(600)))
  .addSubcommand((s) => s.setName('ignore').setDescription('استثناء روم من فلاتر الرسائل (تبديل)')
    .addChannelOption((o) => o.setName('channel').setDescription('الروم').setRequired(true).addChannelTypes(ChannelType.GuildText)))
  .addSubcommandGroup((g) => g.setName('whitelist').setDescription('الوايت ليست (مستثنى من الحماية)')
    .addSubcommand((s) => s.setName('add').setDescription('إضافة عضو أو رتبة')
      .addMentionableOption((o) => o.setName('target').setDescription('عضو أو رتبة').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('إزالة عضو أو رتبة')
      .addMentionableOption((o) => o.setName('target').setDescription('عضو أو رتبة').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('عرض الوايت ليست')))
  .addSubcommandGroup((g) => g.setName('words').setDescription('الكلمات الممنوعة')
    .addSubcommand((s) => s.setName('add').setDescription('إضافة كلمة (أو كلمات مفصولة بفاصلة)')
      .addStringOption((o) => o.setName('word').setDescription('الكلمة').setRequired(true).setMaxLength(500)))
    .addSubcommand((s) => s.setName('remove').setDescription('حذف كلمة')
      .addStringOption((o) => o.setName('word').setDescription('الكلمة').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('عرض الكلمات الممنوعة')));

async function execute(interaction) {
  const { guildId } = interaction;
  const group = interaction.options.getSubcommandGroup();
  const sub = interaction.options.getSubcommand();
  const o = interaction.options;
  const set = (fn) => store.update(guildId, 'protection', fn);

  if (group === 'whitelist') {
    if (sub === 'list') {
      const cfg = cfgOf(guildId);
      const users = cfg.whitelist.users.map((id) => `<@${id}>`).join(' ') || '—';
      const roles = cfg.whitelist.roles.map((id) => `<@&${id}>`).join(' ') || '—';
      return reply.info(interaction, `${I.whitelist} **الوايت ليست**\n${DIVIDER}\n**الأعضاء:** ${users}\n**الرتب:** ${roles}`);
    }
    const target = o.getMentionable('target');
    const key = interaction.guild.roles.cache.has(target.id) ? 'roles' : 'users';
    set((cfg) => {
      cfg.whitelist[key] = cfg.whitelist[key].filter((id) => id !== target.id);
      if (sub === 'add') cfg.whitelist[key].push(target.id);
    });
    return reply.success(interaction, sub === 'add' ? `تمت إضافة ${target} للوايت ليست.` : `تمت إزالة ${target} من الوايت ليست.`);
  }

  if (group === 'words') {
    if (sub === 'list') {
      const words = cfgOf(guildId).words;
      return reply.info(interaction, `${I.muted} **الكلمات الممنوعة (${words.length})**\n${DIVIDER}\n${words.map((w) => `||${w}||`).join(' • ') || '—'}`);
    }
    const words = o.getString('word').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
    set((cfg) => {
      cfg.words = cfg.words.filter((w) => !words.includes(w));
      if (sub === 'add') cfg.words.push(...words);
      if (sub === 'add') cfg.features.badWords = true;
    });
    return reply.success(interaction, sub === 'add' ? `تمت إضافة \`${words.length}\` كلمة وتفعيل الفلتر.` : 'تم الحذف.');
  }

  switch (sub) {
    case 'panel':
      return interaction.reply({ ...panel(interaction), flags: MessageFlags.Ephemeral });
    case 'spam':
      set((cfg) => {
        cfg.spam.messages = o.getInteger('messages');
        cfg.spam.seconds = o.getInteger('seconds');
        cfg.spam.action = o.getString('action') || cfg.spam.action;
        cfg.spam.minutes = o.getInteger('minutes') || cfg.spam.minutes;
        cfg.features.antiSpam = true;
      });
      return reply.success(interaction, 'تم تحديث مضاد السبام وتفعيله.');
    case 'links':
      set((cfg) => {
        cfg.links.invitesOnly = o.getString('mode') === 'invites';
        cfg.features.antiLink = true;
      });
      return reply.success(interaction, 'تم تحديث مضاد الروابط وتفعيله.');
    case 'mentions':
      set((cfg) => {
        cfg.mentions.max = o.getInteger('max');
        cfg.features.antiMention = true;
      });
      return reply.success(interaction, `الحد الأقصى للمنشن صار \`${o.getInteger('max')}\`.`);
    case 'raid':
      set((cfg) => {
        cfg.raid.joins = o.getInteger('joins');
        cfg.raid.seconds = o.getInteger('seconds');
        cfg.raid.minutes = o.getInteger('minutes') || cfg.raid.minutes;
        cfg.features.antiRaid = true;
      });
      return reply.success(interaction, `تم تفعيل مضاد الرايد. وضع الرايد يستمر ${formatDuration(cfgOf(guildId).raid.minutes * 60_000)}.`);
    case 'nuke':
      set((cfg) => {
        cfg.nuke.limit = o.getInteger('limit');
        cfg.nuke.seconds = o.getInteger('seconds');
        cfg.features.antiNuke = true;
      });
      return reply.success(interaction, 'تم تفعيل مضاد التخريب. تأكد إن رتبة البوت فوق رتب المشرفين.');
    case 'ignore': {
      const channel = o.getChannel('channel');
      let ignored;
      set((cfg) => {
        ignored = !cfg.ignoredChannels.includes(channel.id);
        cfg.ignoredChannels = cfg.ignoredChannels.filter((id) => id !== channel.id);
        if (ignored) cfg.ignoredChannels.push(channel.id);
      });
      return reply.success(interaction, ignored ? `${channel} صار مستثنى من الفلاتر.` : `${channel} رجع تحت الحماية.`);
    }
  }
}

module.exports = {
  id: 'protection',
  name: 'Protection',
  nameAr: 'الحماية',
  emoji: I.protection,
  description: 'مضاد سبام، روابط، منشن، كلمات ممنوعة، رايد، تخريب (Anti-Nuke) وبوتات.',
  defaults: {
    features: { antiSpam: true, antiLink: true, antiMention: true, badWords: false, antiRaid: false, antiNuke: false, antiBot: false },
    spam: { messages: 6, seconds: 5, action: 'timeout', minutes: 10 },
    links: { invitesOnly: true },
    mentions: { max: 6 },
    words: [...DEFAULT_BAD_WORDS],
    raid: { joins: 8, seconds: 10, minutes: 5 },
    nuke: { limit: 3, seconds: 30 },
    whitelist: { users: [], roles: [] },
    ignoredChannels: [],
  },
  dashboard: [
    {
      title: 'الحمايات المفعلة',
      fields: Object.entries(FEATURES).map(([key, f]) => ({ key: `features.${key}`, type: 'bool', label: f.label, hint: f.desc })),
    },
    {
      title: 'مضاد السبام', icon: 'message',
      fields: [
        { key: 'spam.messages', type: 'number', label: 'عدد الرسائل', min: 3, max: 20 },
        { key: 'spam.seconds', type: 'number', label: 'خلال (ثواني)', min: 2, max: 60 },
        { key: 'spam.action', type: 'select', label: 'العقوبة', options: [{ value: 'timeout', label: 'تايم أوت' }, { value: 'kick', label: 'طرد' }] },
        { key: 'spam.minutes', type: 'number', label: 'مدة التايم أوت (دقائق)', min: 1, max: 10080 },
      ],
    },
    {
      title: 'الروابط والمنشن', icon: 'link',
      fields: [
        { key: 'links.invitesOnly', type: 'bool', label: 'منع روابط الدعوات فقط', hint: 'إذا طفيته ينمنع أي رابط' },
        { key: 'mentions.max', type: 'number', label: 'أقصى منشن في رسالة', min: 2, max: 50 },
      ],
    },
    {
      title: 'الرايد والتخريب', icon: 'raid',
      fields: [
        { key: 'raid.joins', type: 'number', label: 'عدد الداخلين = رايد', min: 3, max: 100 },
        { key: 'raid.seconds', type: 'number', label: 'خلال (ثواني)', min: 3, max: 300 },
        { key: 'raid.minutes', type: 'number', label: 'مدة وضع الرايد (دقائق)', min: 1, max: 120 },
        { key: 'nuke.limit', type: 'number', label: 'عدد الإجراءات التخريبية', min: 2, max: 20 },
        { key: 'nuke.seconds', type: 'number', label: 'خلال (ثواني)', min: 5, max: 600 },
      ],
    },
    {
      title: 'الاستثناءات والكلمات', icon: 'whitelist',
      fields: [
        { key: 'whitelist.roles', type: 'roles', label: 'رتب الوايت ليست' },
        { key: 'whitelist.users', type: 'tags', label: 'أعضاء الوايت ليست (آيديات)', snowflake: true, hint: 'الصق آيدي العضو واضغط Enter' },
        { key: 'ignoredChannels', type: 'channels', label: 'رومات مستثناة من فلاتر الرسائل' },
        { key: 'words', type: 'tags', label: 'الكلمات الممنوعة', lowercase: true, max: 300 },
      ],
    },
  ],
  commands: [{ data, execute }],
  actions: {
    loadWords: {
      label: 'تحميل قائمة كلمات ممنوعة جاهزة',
      description: 'يضيف قائمة شتائم عربية جاهزة لفلتر الكلمات (بدون تكرار) ويشغّل الفلتر',
      run(guild) {
        let added = 0;
        store.update(guild.id, 'protection', (cfg) => {
          const have = new Set(cfg.words);
          for (const w of DEFAULT_BAD_WORDS) if (!have.has(w)) { cfg.words.push(w); added += 1; }
          cfg.features.badWords = true;
        });
        return `تمت إضافة \`${added}\` كلمة وتفعيل الفلتر`;
      },
    },
  },
  components: {
    async toggle(interaction) {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return reply.error(interaction, 'للأدمن فقط.');
      const selected = new Set(interaction.values);
      store.update(interaction.guildId, 'protection', (cfg) => {
        for (const key of Object.keys(FEATURES)) cfg.features[key] = selected.has(key);
      });
      await interaction.update(panel(interaction));
    },
  },
  events: {
    messageCreate: onMessage,
    guildMemberAdd: onJoin,
    channelDelete: (channel) => channel.guild && onDestructive(channel.guild, AuditLogEvent.ChannelDelete, channel.id, 'حذف روم'),
    roleDelete: (role) => onDestructive(role.guild, AuditLogEvent.RoleDelete, role.id, 'حذف رتبة'),
    guildBanAdd: (ban) => onDestructive(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id, 'باند'),
    guildMemberRemove: (member) => onDestructive(member.guild, AuditLogEvent.MemberKick, member.id, 'طرد'),
  },
};
