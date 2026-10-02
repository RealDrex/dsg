const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../core/db');
const store = require('../../core/store');
const { card, simple, emoji, DIVIDER, reply, bar } = require('../../core/theme');
const { fill, memberVars } = require('../../utils/text');
const { I } = require('../../core/icons');

// XP needed to go from `level` to `level + 1`.
const need = (level) => 5 * level ** 2 + 50 * level + 100;

const q = {
  get: db.prepare('SELECT * FROM levels WHERE guild_id = ? AND user_id = ?'),
  upsert: db.prepare(`INSERT INTO levels (guild_id, user_id, xp, level, messages, voice_minutes) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET xp = excluded.xp, level = excluded.level, messages = excluded.messages, voice_minutes = excluded.voice_minutes`),
  rank: db.prepare('SELECT COUNT(*) + 1 AS pos FROM levels WHERE guild_id = ? AND (level > ? OR (level = ? AND xp > ?))'),
  reset: db.prepare('DELETE FROM levels WHERE guild_id = ? AND user_id = ?'),
};

const TOP = {
  xp: { label: 'المستوى', order: 'level DESC, xp DESC', show: (r) => `لفل \`${r.level}\` • \`${r.xp}\` XP` },
  messages: { label: 'الرسائل', order: 'messages DESC', show: (r) => `\`${r.messages}\` رسالة` },
  voice: { label: 'الفويس', order: 'voice_minutes DESC', show: (r) => `\`${Math.floor(r.voice_minutes / 60)}h ${r.voice_minutes % 60}m\`` },
};

const row = (guildId, userId) => q.get.get(guildId, userId) || { guild_id: guildId, user_id: userId, xp: 0, level: 0, messages: 0, voice_minutes: 0 };

function addXp(guildId, userId, amount, { messages = 0, voice = 0 } = {}) {
  const r = row(guildId, userId);
  const before = r.level;
  r.xp += amount;
  while (r.xp >= need(r.level)) {
    r.xp -= need(r.level);
    r.level += 1;
  }
  q.upsert.run(guildId, userId, r.xp, r.level, r.messages + messages, r.voice_minutes + voice);
  return { before, after: r.level };
}

async function syncRewards(member, level, cfg) {
  const me = member.guild.members.me;
  const usable = cfg.rewards
    .filter((rw) => member.guild.roles.cache.get(rw.roleId)?.position < me.roles.highest.position)
    .sort((a, b) => a.level - b.level);
  const earned = usable.filter((rw) => rw.level <= level);
  const keep = cfg.stackRewards ? earned : earned.slice(-1);
  const add = keep.filter((rw) => !member.roles.cache.has(rw.roleId)).map((rw) => rw.roleId);
  const remove = usable.filter((rw) => !keep.includes(rw) && member.roles.cache.has(rw.roleId)).map((rw) => rw.roleId);
  if (add.length) await member.roles.add(add, 'Sword Levels').catch(() => null);
  if (remove.length) await member.roles.remove(remove, 'Sword Levels').catch(() => null);
  return add;
}

async function levelUp(member, level, channel, cfg) {
  const added = await syncRewards(member, level, cfg);
  if (!cfg.announce) return;
  const target = (cfg.channelId && member.guild.channels.cache.get(cfg.channelId)) || channel;
  const text = fill(cfg.message, { ...memberVars(member), level });
  const rewardText = added.length ? `\n${I.gift} حصلت على: ${added.map((id) => `<@&${id}>`).join(' ')}` : '';
  await target?.send({ content: `${member}`, embeds: [simple(`${I.levelUp} ${text}${rewardText}`, 'primary', `${I.sword} Level Up!`).setThumbnail(member.user.displayAvatarURL())] }).catch(() => null);
}

const cooldowns = new Map();

async function onMessage(message) {
  if (!message.inGuild() || message.author.bot || !message.member) return;
  const cfg = store.get(message.guildId, 'activity');
  if (cfg.ignoredChannels.includes(message.channelId)) return;
  if (message.member.roles.cache.some((r) => cfg.ignoredRoles.includes(r.id))) return;

  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  if (now - (cooldowns.get(key) || 0) < cfg.cooldown * 1000) {
    db.prepare('UPDATE levels SET messages = messages + 1 WHERE guild_id = ? AND user_id = ?').run(message.guildId, message.author.id);
    return;
  }
  cooldowns.set(key, now);
  const amount = cfg.xpMin + Math.floor(Math.random() * (cfg.xpMax - cfg.xpMin + 1));
  const { before, after } = addXp(message.guildId, message.author.id, amount, { messages: 1 });
  if (after > before) await levelUp(message.member, after, message.channel, cfg);
}

// Every minute: XP for members actively talking in voice (not alone, not deafened).
function voiceTick(client) {
  for (const guild of client.guilds.cache.values()) {
    if (!store.isEnabled(guild.id, 'activity')) continue;
    const cfg = store.get(guild.id, 'activity');
    if (!cfg.voiceXp) continue;
    for (const state of guild.voiceStates.cache.values()) {
      const { member, channel } = state;
      if (!member || member.user.bot || !channel || channel.id === guild.afkChannelId) continue;
      if (state.selfDeaf || state.serverDeaf) continue;
      if (channel.members.filter((m) => !m.user.bot).size < 2) continue;
      const { before, after } = addXp(guild.id, member.id, cfg.voiceXp, { voice: 1 });
      if (after > before) levelUp(member, after, null, cfg).catch(() => null);
    }
  }
}

const data = new SlashCommandBuilder().setName('rank').setDescription('مستواك أو مستوى عضو')
  .addUserOption((o) => o.setName('user').setDescription('العضو'));

async function rank(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  if (user.bot) return reply.error(interaction, `البوتات ما عندها لفلات ${I.bot}`);
  const r = row(interaction.guildId, user.id);
  const pos = q.rank.get(interaction.guildId, r.level, r.level, r.xp).pos;
  const next = need(r.level);
  const { embed, files } = card({
    title: `${emoji.sword} ${user.username}`,
    thumbnail: user.displayAvatarURL({ size: 256 }),
    description: [
      `**المستوى** \`${r.level}\`  •  **الترتيب** \`#${pos}\``,
      DIVIDER,
      `${bar(r.xp, next)}  \`${r.xp} / ${next} XP\``,
      DIVIDER,
      `${I.message} الرسائل: \`${r.messages}\`  •  ${I.voice} الفويس: \`${Math.floor(r.voice_minutes / 60)}h ${r.voice_minutes % 60}m\``,
    ].join('\n'),
    image: 'line',
    footer: 'Sword • Rank',
  });
  await interaction.reply({ embeds: [embed], files });
}

const topData = new SlashCommandBuilder().setName('top').setDescription('قائمة أفضل 10 أعضاء تفاعلاً')
  .addStringOption((o) => o.setName('type').setDescription('حسب').addChoices(
    { name: 'المستوى', value: 'xp' }, { name: 'الرسائل', value: 'messages' }, { name: 'الفويس', value: 'voice' },
  ));

async function top(interaction) {
  const type = interaction.options.getString('type') || 'xp';
  const t = TOP[type];
  const rows = db.prepare(`SELECT * FROM levels WHERE guild_id = ? ORDER BY ${t.order} LIMIT 10`).all(interaction.guildId);
  const medals = [`${I.gold}`, `${I.silver}`, `${I.bronze}`];
  const body = rows.length
    ? rows.map((r, i) => `${medals[i] || `\`#${i + 1}\``} <@${r.user_id}> — ${t.show(r)}`).join('\n')
    : 'ما فيه تفاعل للحين.';
  const { embed, files } = card({ title: `${I.trophy} التوب — ${t.label}`, description: `${body}\n${DIVIDER}`, image: 'line' });
  await interaction.reply({ embeds: [embed], files, allowedMentions: { parse: [] } });
}

const adminData = new SlashCommandBuilder()
  .setName('levels')
  .setDescription('إعدادات نظام اللفلات')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommandGroup((g) => g.setName('reward').setDescription('رتب المكافآت')
    .addSubcommand((s) => s.setName('add').setDescription('رتبة عند الوصول للفل')
      .addIntegerOption((o) => o.setName('level').setDescription('اللفل').setRequired(true).setMinValue(1).setMaxValue(500))
      .addRoleOption((o) => o.setName('role').setDescription('الرتبة').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('حذف مكافأة لفل')
      .addIntegerOption((o) => o.setName('level').setDescription('اللفل').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('عرض المكافآت'))
    .addSubcommand((s) => s.setName('stack').setDescription('يحتفظ العضو بكل رتب المكافآت أو آخر وحدة بس')
      .addBooleanOption((o) => o.setName('enabled').setDescription('تجميع الرتب').setRequired(true))))
  .addSubcommand((s) => s.setName('announce').setDescription('رسائل اللفل أب')
    .addBooleanOption((o) => o.setName('enabled').setDescription('تفعيل الرسائل').setRequired(true))
    .addChannelOption((o) => o.setName('channel').setDescription('روم مخصص (فاضي = نفس الروم)').addChannelTypes(ChannelType.GuildText))
    .addStringOption((o) => o.setName('message').setDescription('النص — {user} {level} {username}').setMaxLength(500)))
  .addSubcommand((s) => s.setName('xp').setDescription('معدلات الـ XP')
    .addIntegerOption((o) => o.setName('min').setDescription('أقل XP للرسالة').setRequired(true).setMinValue(1).setMaxValue(500))
    .addIntegerOption((o) => o.setName('max').setDescription('أعلى XP للرسالة').setRequired(true).setMinValue(1).setMaxValue(500))
    .addIntegerOption((o) => o.setName('cooldown').setDescription('ثواني بين كل XP').setMinValue(0).setMaxValue(3600))
    .addIntegerOption((o) => o.setName('voice').setDescription('XP لكل دقيقة فويس (0 = إيقاف)').setMinValue(0).setMaxValue(500)))
  .addSubcommand((s) => s.setName('ignore').setDescription('منع XP في روم أو لرتبة (تبديل)')
    .addChannelOption((o) => o.setName('channel').setDescription('الروم').addChannelTypes(ChannelType.GuildText))
    .addRoleOption((o) => o.setName('role').setDescription('الرتبة')))
  .addSubcommand((s) => s.setName('set').setDescription('تحديد لفل عضو')
    .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true))
    .addIntegerOption((o) => o.setName('level').setDescription('اللفل').setRequired(true).setMinValue(0).setMaxValue(1000)))
  .addSubcommand((s) => s.setName('reset').setDescription('تصفير لفل عضو')
    .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true)));

async function admin(interaction) {
  const { guildId } = interaction;
  const o = interaction.options;
  const group = o.getSubcommandGroup();
  const sub = o.getSubcommand();
  const set = (fn) => store.update(guildId, 'activity', fn);

  if (group === 'reward') {
    if (sub === 'list') {
      const cfg = store.get(guildId, 'activity');
      const list = [...cfg.rewards].sort((a, b) => a.level - b.level).map((rw) => `${emoji.dot} لفل \`${rw.level}\` ← <@&${rw.roleId}>`);
      return reply.info(interaction, `${I.gift} **مكافآت اللفلات** (${cfg.stackRewards ? 'تجميع' : 'آخر رتبة فقط'})\n${DIVIDER}\n${list.join('\n') || '—'}`);
    }
    if (sub === 'stack') {
      set((cfg) => { cfg.stackRewards = o.getBoolean('enabled'); });
      return reply.success(interaction, o.getBoolean('enabled') ? 'الأعضاء يحتفظون بكل رتب المكافآت.' : 'العضو ياخذ آخر رتبة مكافأة بس.');
    }
    const level = o.getInteger('level');
    const role = o.getRole('role');
    set((cfg) => {
      cfg.rewards = cfg.rewards.filter((rw) => rw.level !== level);
      if (sub === 'add') cfg.rewards.push({ level, roleId: role.id });
    });
    return reply.success(interaction, sub === 'add' ? `لفل \`${level}\` ← ${role}` : `تم حذف مكافأة لفل \`${level}\``);
  }

  switch (sub) {
    case 'announce':
      set((cfg) => {
        cfg.announce = o.getBoolean('enabled');
        cfg.channelId = o.getChannel('channel')?.id || null;
        if (o.getString('message')) cfg.message = o.getString('message');
      });
      return reply.success(interaction, 'تم تحديث رسائل اللفل أب.');
    case 'xp': {
      const [min, max] = [o.getInteger('min'), o.getInteger('max')].sort((a, b) => a - b);
      set((cfg) => {
        cfg.xpMin = min;
        cfg.xpMax = max;
        cfg.cooldown = o.getInteger('cooldown') ?? cfg.cooldown;
        cfg.voiceXp = o.getInteger('voice') ?? cfg.voiceXp;
      });
      const cfg = store.get(guildId, 'activity');
      return reply.success(interaction, `XP الرسالة: \`${min}-${max}\` كل \`${cfg.cooldown}s\` • الفويس: \`${cfg.voiceXp}\`/دقيقة`);
    }
    case 'ignore': {
      const channel = o.getChannel('channel');
      const role = o.getRole('role');
      if (!channel && !role) return reply.error(interaction, 'حدد روم أو رتبة.');
      const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
      set((cfg) => {
        if (channel) cfg.ignoredChannels = toggle(cfg.ignoredChannels, channel.id);
        if (role) cfg.ignoredRoles = toggle(cfg.ignoredRoles, role.id);
      });
      const cfg = store.get(guildId, 'activity');
      return reply.info(interaction, `${I.forbid} **بدون XP**\nالرومات: ${cfg.ignoredChannels.map((id) => `<#${id}>`).join(' ') || '—'}\nالرتب: ${cfg.ignoredRoles.map((id) => `<@&${id}>`).join(' ') || '—'}`);
    }
    case 'set': {
      const user = o.getUser('user');
      const r = row(guildId, user.id);
      q.upsert.run(guildId, user.id, 0, o.getInteger('level'), r.messages, r.voice_minutes);
      const member = o.getMember('user');
      if (member) await syncRewards(member, o.getInteger('level'), store.get(guildId, 'activity'));
      return reply.success(interaction, `لفل ${user} صار \`${o.getInteger('level')}\``, { hidden: false });
    }
    case 'reset':
      q.reset.run(guildId, o.getUser('user').id);
      return reply.success(interaction, `تم تصفير ${o.getUser('user')}`, { hidden: false });
  }
}

module.exports = {
  id: 'activity',
  name: 'Activity Plugin',
  nameAr: 'بلوقن الرانك والتفاعل',
  emoji: I.activity,
  description: 'لفلات بالرسائل والفويس، رتب مكافآت، رسائل لفل أب، وتوب التفاعل.',
  defaults: {
    xpMin: 15,
    xpMax: 25,
    cooldown: 60,
    voiceXp: 10,
    announce: true,
    channelId: null,
    message: 'مبروك {user}! وصلت لفل **{level}**',
    rewards: [],
    stackRewards: true,
    ignoredChannels: [],
    ignoredRoles: [],
  },
  commands: [
    { data, execute: rank },
    { data: topData, execute: top },
    { data: adminData, execute: admin },
  ],
  dashboard: [
    {
      title: 'الخبرة (XP)', icon: 'sword',
      fields: [
        { key: 'xpMin', type: 'number', label: 'أقل XP للرسالة', min: 1, max: 500 },
        { key: 'xpMax', type: 'number', label: 'أعلى XP للرسالة', min: 1, max: 500 },
        { key: 'cooldown', type: 'number', label: 'الانتظار بين كل XP (ثواني)', min: 0, max: 3600 },
        { key: 'voiceXp', type: 'number', label: 'XP لكل دقيقة فويس (0 = إيقاف)', min: 0, max: 500 },
      ],
    },
    {
      title: 'رسائل اللفل أب', icon: 'levelUp',
      fields: [
        { key: 'announce', type: 'bool', label: 'تفعيل رسائل اللفل أب' },
        { key: 'channelId', type: 'channel', label: 'روم مخصص', hint: 'فاضي = نفس الروم اللي تفاعل فيه العضو' },
        { key: 'message', type: 'textarea', label: 'الرسالة', max: 500, hint: '{user} {username} {level}' },
      ],
    },
    {
      title: 'رتب المكافآت', icon: 'gift',
      fields: [
        { key: 'stackRewards', type: 'bool', label: 'يحتفظ العضو بكل رتب المكافآت', hint: 'إذا طفيته ياخذ آخر رتبة بس' },
        {
          key: 'rewards', type: 'list', label: 'المكافآت', addLabel: 'إضافة مكافأة', max: 50,
          fields: [
            { key: 'level', type: 'number', label: 'اللفل', min: 1, max: 500 },
            { key: 'roleId', type: 'role', label: 'الرتبة', required: true },
          ],
        },
      ],
    },
    {
      title: 'بدون XP', icon: 'forbid',
      fields: [
        { key: 'ignoredChannels', type: 'channels', label: 'رومات ما تعطي XP' },
        { key: 'ignoredRoles', type: 'roles', label: 'رتب ما تاخذ XP' },
      ],
    },
  ],
  validate(cfg) {
    if (cfg.xpMin > cfg.xpMax) [cfg.xpMin, cfg.xpMax] = [cfg.xpMax, cfg.xpMin];
    cfg.rewards = cfg.rewards.filter((r) => r.roleId);
  },
  events: { messageCreate: onMessage },
  ready(client) {
    setInterval(() => voiceTick(client), 60_000).unref();
  },
};
