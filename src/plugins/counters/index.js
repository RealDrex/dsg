const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const store = require('../../core/store');
const { emoji, DIVIDER, reply } = require('../../core/theme');
const logger = require('../../core/logger');

const TYPES = {
  members: { label: 'كل الأعضاء', template: '👥・الأعضاء: {count}', count: (g) => g.memberCount },
  humans: { label: 'البشر', template: '👤・الأعضاء: {count}', count: (g) => g.members.cache.filter((m) => !m.user.bot).size },
  bots: { label: 'البوتات', template: '🤖・البوتات: {count}', count: (g) => g.members.cache.filter((m) => m.user.bot).size },
  voice: { label: 'المتواجدين بالفويس', template: '🔊・بالفويس: {count}', count: (g) => g.voiceStates.cache.filter((v) => v.channelId).size },
  boosts: { label: 'البوستات', template: '💎・البوستات: {count}', count: (g) => g.premiumSubscriptionCount || 0 },
  roles: { label: 'الرتب', template: '🎭・الرتب: {count}', count: (g) => g.roles.cache.size - 1 },
  channels: { label: 'الرومات', template: '💬・الرومات: {count}', count: (g) => g.channels.cache.filter((c) => c.type !== ChannelType.GuildCategory).size },
};

const nameFor = (guild, counter) => (counter.template || TYPES[counter.type].template).replace('{count}', TYPES[counter.type].count(guild).toLocaleString('en-US'));

async function refresh(guild) {
  const cfg = store.get(guild.id, 'counters');
  for (const counter of cfg.counters) {
    const channel = guild.channels.cache.get(counter.channelId);
    const name = nameFor(guild, counter);
    if (channel && channel.name !== name) await channel.setName(name, 'Sword Counters').catch(() => null);
  }
}

// Channel renames are limited to 2 per 10 minutes, so refresh on a slow interval.
async function tick(client) {
  for (const guild of client.guilds.cache.values()) {
    if (!store.isEnabled(guild.id, 'counters') || !store.get(guild.id, 'counters').counters.length) continue;
    await refresh(guild).catch((err) => logger.warn('counters:', err.message));
  }
}

const data = new SlashCommandBuilder()
  .setName('counter')
  .setDescription('رومات العدادات (إحصائيات السيرفر)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .addSubcommand((s) => s.setName('create').setDescription('إنشاء عداد جديد')
    .addStringOption((o) => o.setName('type').setDescription('وش يعد').setRequired(true)
      .addChoices(...Object.entries(TYPES).map(([value, t]) => ({ name: t.label, value }))))
    .addStringOption((o) => o.setName('template').setDescription('شكل الاسم — استخدم {count} للرقم').setMaxLength(90)))
  .addSubcommand((s) => s.setName('remove').setDescription('حذف عداد')
    .addChannelOption((o) => o.setName('channel').setDescription('روم العداد').setRequired(true).addChannelTypes(ChannelType.GuildVoice)))
  .addSubcommand((s) => s.setName('refresh').setDescription('تحديث العدادات الحين'))
  .addSubcommand((s) => s.setName('list').setDescription('عرض العدادات'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const { guild } = interaction;
  const cfg = store.get(guild.id, 'counters');

  if (sub === 'list') {
    const list = cfg.counters.map((c) => `${emoji.dot} <#${c.channelId}> — ${TYPES[c.type].label}`);
    return reply.info(interaction, `📊 **العدادات**\n${DIVIDER}\n${list.join('\n') || '—'}\n\n*تتحدث تلقائياً كل 10 دقائق (حد ديسكورد).*`);
  }
  if (sub === 'refresh') {
    await interaction.deferReply({ flags: 64 });
    await refresh(guild);
    return reply.success(interaction, 'تم تحديث العدادات.');
  }
  if (sub === 'remove') {
    const channel = interaction.options.getChannel('channel');
    if (!cfg.counters.some((c) => c.channelId === channel.id)) return reply.error(interaction, 'هذا الروم مو عداد.');
    store.update(guild.id, 'counters', (c) => { c.counters = c.counters.filter((x) => x.channelId !== channel.id); });
    await channel.delete('Sword Counters').catch(() => null);
    return reply.success(interaction, 'تم حذف العداد.');
  }

  await interaction.deferReply({ flags: 64 });
  if (sub === 'create' && ['humans', 'bots'].includes(interaction.options.getString('type'))) await guild.members.fetch().catch(() => null);
  let category = cfg.categoryId && guild.channels.cache.get(cfg.categoryId);
  if (!category) {
    category = await guild.channels.create({ name: '📊 Sword Stats', type: ChannelType.GuildCategory, position: 0 });
    store.update(guild.id, 'counters', (c) => { c.categoryId = category.id; });
  }
  const counter = { type: interaction.options.getString('type'), template: interaction.options.getString('template') || null };
  if (counter.template && !counter.template.includes('{count}')) counter.template += ' {count}';
  const channel = await guild.channels.create({
    name: nameFor(guild, counter),
    type: ChannelType.GuildVoice,
    parent: category,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.Connect] },
      { id: guild.members.me.id, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ViewChannel] },
    ],
  });
  counter.channelId = channel.id;
  store.update(guild.id, 'counters', (c) => { c.counters.push(counter); });
  return reply.success(interaction, `تم إنشاء العداد ${channel}`);
}

module.exports = {
  id: 'counters',
  name: 'Counters Plugin',
  nameAr: 'بلوقن العدادات',
  emoji: '📊',
  description: 'رومات فويس تعرض عدد الأعضاء، البوتات، الفويس، البوستات وغيرها وتتحدث تلقائياً.',
  defaults: { categoryId: null, counters: [] },
  commands: [{ data, execute }],
  async ready(client) {
    for (const guild of client.guilds.cache.values()) {
      const cfg = store.get(guild.id, 'counters');
      if (cfg.counters.some((c) => ['humans', 'bots'].includes(c.type))) await guild.members.fetch().catch(() => null);
    }
    await tick(client);
    setInterval(() => tick(client), 10 * 60_000).unref();
  },
};
