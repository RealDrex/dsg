const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const store = require('../../core/store');
const { card, DIVIDER, reply } = require('../../core/theme');
const { userError } = require('../../core/errors');
const { I, asEmoji } = require('../../core/icons');

const PALETTE = [
  ['قرمزي', 0xdc143c], ['أحمر', 0xff4d4d], ['برتقالي', 0xff8c42], ['ذهبي', 0xffd166], ['أصفر', 0xfff275],
  ['ليموني', 0xb5e550], ['أخضر', 0x3ddc84], ['زمردي', 0x10b981], ['فيروزي', 0x2dd4bf], ['سماوي', 0x38bdf8],
  ['أزرق', 0x3b82f6], ['نيلي', 0x6366f1], ['بنفسجي', 0x8b5cf6], ['أرجواني', 0xc084fc], ['وردي', 0xf472b6],
  ['زهري', 0xfb7185], ['بني', 0xb7793e], ['فضي', 0xd4d4d4], ['رمادي', 0x8a8a8a], ['أبيض', 0xfafafa],
];

// Closest coloured-circle emoji for a role colour (used in the select menu).
const CIRCLES = [
  [I.dotRed, 0xdd2e44], [I.dotOrange, 0xf4900c], [I.dotYellow, 0xfdcb58], [I.dotGreen, 0x78b159], [I.dotBlue, 0x55acee],
  [I.dotPurple, 0xaa8ed6], [I.dotBrown, 0xc1694f], [I.dotBlack, 0x31373d], [I.dotWhite, 0xe6e7e8],
];
const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
function circleFor(color) {
  const [r, g, b] = rgb(color);
  return CIRCLES.reduce((best, [e, c]) => {
    const [r2, g2, b2] = rgb(c);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    return d < best.d ? { e, d } : best;
  }, { e: I.dotWhite, d: Infinity }).e;
}

const MAX = 24; // 25 select options minus "remove colour"

const liveRoles = (guild, cfg) => cfg.roles.map((id) => guild.roles.cache.get(id)).filter(Boolean);

function panelPayload(guild) {
  const roles = liveRoles(guild, store.get(guild.id, 'colors'));
  const grid = roles.map((r, i) => `\`${String(i + 1).padStart(2, '0')}\` ${r}`).join('\n');
  const { embed, files } = card({
    title: 'علبة الألوان', icon: 'colors',
    description: `اختر لون اسمك من القائمة تحت ${I.down}\n${DIVIDER}\n${grid || '*ما فيه ألوان للحين*'}\n${DIVIDER}`,
    image: 'colors',
    footer: 'Sword • Colors',
  });
  const components = [];
  if (roles.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('colors:pick')
      .setPlaceholder('اختر لونك')
      .addOptions([
        ...roles.map((r) => ({ label: r.name.replace(/^🎨\s*/u, '').slice(0, 100) || r.name, value: r.id, emoji: asEmoji(circleFor(r.color)) })),
        { label: 'إزالة اللون', value: 'none', emoji: asEmoji(I.close) },
      ]);
    components.push(new ActionRowBuilder().addComponents(menu));
  }
  return { embeds: [embed], files, components, attachments: [] };
}

async function refreshPanel(guild) {
  const { panel } = store.get(guild.id, 'colors');
  if (!panel.messageId) return;
  const message = await guild.channels.cache.get(panel.channelId)?.messages.fetch(panel.messageId).catch(() => null);
  if (message) await message.edit(panelPayload(guild)).catch(() => null);
}

async function createColors(guild, wanted) {
  const cfg = store.get(guild.id, 'colors');
  const me = guild.members.me;
  const count = Math.min(wanted, MAX - liveRoles(guild, cfg).length, PALETTE.length);
  if (count <= 0) return 0;
  const created = [];
  for (const [name, color] of PALETTE.slice(0, count)) {
    const role = await guild.roles.create({
      name, colors: { primaryColor: color }, permissions: [], mentionable: false, reason: 'Sword Colors',
    });
    // Directly under the bot's role so the colour wins over other roles.
    await role.setPosition(me.roles.highest.position - 1).catch(() => null);
    created.push(role.id);
  }
  store.update(guild.id, 'colors', (c) => {
    c.roles.push(...created);
    c.created.push(...created);
  });
  await refreshPanel(guild);
  return created.length;
}

const data = new SlashCommandBuilder()
  .setName('colors')
  .setDescription('علبة الألوان — رتب ألوان للأعضاء')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((s) => s.setName('setup').setDescription('إنشاء رتب ألوان جاهزة بثيم مرتب')
    .addIntegerOption((o) => o.setName('count').setDescription(`عدد الألوان (1-${PALETTE.length})`).setMinValue(1).setMaxValue(PALETTE.length)))
  .addSubcommand((s) => s.setName('panel').setDescription('إرسال بانل الألوان')
    .addChannelOption((o) => o.setName('channel').setDescription('الروم').addChannelTypes(ChannelType.GuildText)))
  .addSubcommand((s) => s.setName('add').setDescription('إضافة رتبة موجودة كلون')
    .addRoleOption((o) => o.setName('role').setDescription('الرتبة').setRequired(true)))
  .addSubcommand((s) => s.setName('remove').setDescription('إزالة رتبة من الألوان')
    .addRoleOption((o) => o.setName('role').setDescription('الرتبة').setRequired(true)))
  .addSubcommand((s) => s.setName('list').setDescription('عرض الألوان'))
  .addSubcommand((s) => s.setName('reset').setDescription('حذف كل رتب الألوان اللي سواها البوت'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const { guild } = interaction;
  const cfg = store.get(guild.id, 'colors');
  const me = guild.members.me;

  switch (sub) {
    case 'list':
      return reply.info(interaction, `${I.colors} **الألوان (${cfg.roles.length})**\n${DIVIDER}\n${liveRoles(guild, cfg).map((r) => `${circleFor(r.color)} ${r}`).join('\n') || '—'}`);
    case 'panel': {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const message = await channel.send(panelPayload(guild));
      store.update(guild.id, 'colors', (c) => { c.panel = { channelId: channel.id, messageId: message.id }; });
      return reply.success(interaction, `تم إرسال بانل الألوان في ${channel}`);
    }
    case 'add': {
      const role = interaction.options.getRole('role');
      if (role.position >= me.roles.highest.position) return reply.error(interaction, 'الرتبة أعلى من رتبة البوت.');
      if (cfg.roles.length >= MAX) return reply.error(interaction, `الحد الأقصى ${MAX} لون.`);
      store.update(guild.id, 'colors', (c) => { if (!c.roles.includes(role.id)) c.roles.push(role.id); });
      await refreshPanel(guild);
      return reply.success(interaction, `تمت إضافة ${role}`);
    }
    case 'remove': {
      const role = interaction.options.getRole('role');
      store.update(guild.id, 'colors', (c) => { c.roles = c.roles.filter((id) => id !== role.id); });
      await refreshPanel(guild);
      return reply.success(interaction, `تمت إزالة ${role}`);
    }
    case 'setup': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const created = await createColors(guild, interaction.options.getInteger('count') || PALETTE.length);
      if (!created) return reply.error(interaction, 'وصلت الحد الأقصى للألوان.');
      return reply.success(interaction, `تم إنشاء \`${created}\` لون ${I.colors}\nأرسل البانل بـ \`/ألوان لوحة\``);
    }
    case 'reset': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let removed = 0;
      for (const id of cfg.created) {
        const role = guild.roles.cache.get(id);
        if (role && (await role.delete('Sword Colors reset').catch(() => null))) removed += 1;
      }
      store.update(guild.id, 'colors', (c) => {
        c.roles = c.roles.filter((id) => !c.created.includes(id));
        c.created = [];
      });
      await refreshPanel(guild);
      return reply.success(interaction, `تم حذف \`${removed}\` رتبة لون.`);
    }
  }
}

module.exports = {
  id: 'colors',
  name: 'Colors',
  nameAr: 'علبة الألوان',
  emoji: I.colors,
  description: 'رتب ألوان جاهزة وبانل اختيار لون الاسم بشعار Sword.',
  defaults: { roles: [], created: [], panel: { channelId: null, messageId: null } },
  commands: [{ data, execute }],
  dashboard: [
    {
      title: 'رتب الألوان', icon: 'colors',
      description: 'الرتب اللي تظهر في بانل الألوان (حد أقصى 24) — رتب الألوان لازم تكون تحت رتبة البوت',
      fields: [{ key: 'roles', type: 'roles', label: 'الألوان', max: MAX }],
    },
  ],
  async dashboardSaved(guild) {
    await refreshPanel(guild);
  },
  actions: {
    setup: {
      label: 'إنشاء ألوان جاهزة',
      description: `ينشئ لين ${PALETTE.length} رتبة لون بأسماء عربية تحت رتبة البوت`,
      params: [{ key: 'count', type: 'number', label: 'العدد', min: 1, max: PALETTE.length }],
      async run(guild, { count }) {
        const created = await createColors(guild, count || PALETTE.length);
        if (!created) throw userError('وصلت الحد الأقصى للألوان');
        return `تم إنشاء ${created} لون`;
      },
    },
    sendPanel: {
      label: 'إرسال بانل الألوان',
      params: [{ key: 'channelId', type: 'channel', label: 'الروم' }],
      async run(guild, { channelId }) {
        const channel = channelId && guild.channels.cache.get(channelId);
        if (!channel) throw userError('اختر الروم');
        const message = await channel.send(panelPayload(guild));
        store.update(guild.id, 'colors', (c) => { c.panel = { channelId: channel.id, messageId: message.id }; });
        return `تم إرسال البانل في #${channel.name}`;
      },
    },
  },
  components: {
    async pick(interaction) {
      const { guild, member } = interaction;
      const cfg = store.get(guild.id, 'colors');
      const choice = interaction.values[0];
      interaction.message.edit({ components: interaction.message.components }).catch(() => null);
      const current = member.roles.cache.filter((r) => cfg.roles.includes(r.id) && r.id !== choice);
      if (current.size) await member.roles.remove(current, 'Sword Colors');
      if (choice === 'none') return reply.success(interaction, 'تمت إزالة لونك.');
      if (!cfg.roles.includes(choice)) return reply.error(interaction, 'هذا اللون ما عاد موجود.');
      await member.roles.add(choice, 'Sword Colors');
      return reply.success(interaction, `لونك الحين <@&${choice}> ${I.colors}`);
    },
  },
};
