const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const store = require('../../core/store');
const { DIVIDER, reply } = require('../../core/theme');
const { userError } = require('../../core/errors');
const { I, asEmoji } = require('../../core/icons');
const art = require('../games/art');

// 20 visually DISTINCT colours (not shades) — fixed order, same every time.
// Black uses 0x010101 because Discord treats 0x000000 as "no colour".
const PALETTE = [
  ['أحمر', 0xe6194b], ['برتقالي', 0xf58231], ['أصفر', 0xffe119], ['ليموني', 0xbfef45], ['أخضر', 0x3cb44b],
  ['تركوازي', 0x42d4f4], ['أزرق', 0x4363d8], ['كحلي', 0x1f3a93], ['بنفسجي', 0x911eb4], ['ماجنتا', 0xf032e6],
  ['وردي', 0xff80c0], ['بني', 0x9a6324], ['خمري', 0x800000], ['زيتوني', 0x808000], ['نعناعي', 0x5ff0b0],
  ['لافندر', 0xc9a0ff], ['رمادي', 0xa9a9a9], ['فضي', 0xe8e8e8], ['أبيض', 0xffffff], ['أسود', 0x010101],
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

// The panel is just the palette image + the number picker — no embed box.
async function panelPayload(guild) {
  const roles = liveRoles(guild, store.get(guild.id, 'colors'));
  if (!roles.length) return { content: 'ما فيه ألوان للحين.', embeds: [], files: [], components: [], attachments: [] };
  const files = [];
  try {
    const swatches = roles.map((r, i) => ({ color: r.hexColor && r.hexColor !== '#000000' ? r.hexColor : '#8a8a8a', label: String(i + 1) }));
    files.push(new AttachmentBuilder(await art.paletteBanner(swatches), { name: 'colors.png' }));
  } catch {
    /* no banner if rendering fails */
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId('colors:pick')
    .setPlaceholder('اختر رقم لونك')
    .addOptions([
      ...roles.map((r, i) => ({ label: `${i + 1}`, value: r.id, emoji: asEmoji(circleFor(r.color)) })),
      { label: 'إزالة اللون', value: 'none', emoji: asEmoji(I.close) },
    ]);
  return { content: '', embeds: [], files, components: [new ActionRowBuilder().addComponents(menu)], attachments: [] };
}

async function refreshPanel(guild) {
  const { panel } = store.get(guild.id, 'colors');
  if (!panel.messageId) return;
  const message = await guild.channels.cache.get(panel.channelId)?.messages.fetch(panel.messageId).catch(() => null);
  if (message) await message.edit(await panelPayload(guild)).catch(() => null);
}

async function createColors(guild, wanted) {
  // Start clean: delete every colour role the bot made before (clears the box).
  const old = store.get(guild.id, 'colors').created;
  for (const id of old) {
    const role = guild.roles.cache.get(id);
    if (role) await role.delete('Sword Colors reset').catch(() => null);
  }

  const count = Math.min(wanted, MAX, PALETTE.length);
  const created = [];
  // Named 1..count and left at the bottom of the role list (Discord's default
  // for a new role) so they sit below the staff/admin roles automatically.
  for (let i = 0; i < count; i++) {
    const [, color] = PALETTE[i];
    const role = await guild.roles.create({
      name: String(i + 1), colors: { primaryColor: color }, permissions: [], mentionable: false, reason: 'Sword Colors',
    });
    created.push(role.id);
  }
  // Replace the whole colour list with just the new numbered set.
  store.update(guild.id, 'colors', (c) => {
    c.roles = [...created];
    c.created = [...created];
  });
  await refreshPanel(guild);
  return created.length;
}

const data = new SlashCommandBuilder()
  .setName('colors')
  .setDescription('علبة الألوان — رتب ألوان للأعضاء')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((s) => s.setName('setup').setDescription('يحذف ألوان البوت القديمة وينشئ ألوان مرقمة 1-20 تحت تلقائياً')
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
      const message = await channel.send(await panelPayload(guild));
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

// Quick command: `clo` — wipe old colour roles and create the numbered set.
const clo = {
  data: new SlashCommandBuilder()
    .setName('clo')
    .setDescription('يحذف ألوان البوت القديمة وينشئ ألوان مرقمة 1-20 تحت تلقائياً')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addIntegerOption((o) => o.setName('count').setDescription(`عدد الألوان (1-${PALETTE.length})`).setMinValue(1).setMaxValue(PALETTE.length)),
  aliases: ['clo&', 'كلو', 'ألوان_مرقمة'],
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const created = await createColors(interaction.guild, interaction.options.getInteger('count') || PALETTE.length);
    if (!created) return reply.error(interaction, 'ما قدرت أنشئ الألوان — تأكد إن رتبة البوت فوق.');
    return reply.success(interaction, `تم إنشاء \`${created}\` لون مرقمة (1-${created}) تحت تلقائياً ${I.colors}\nأرسل البانل بـ \`/ألوان لوحة\``);
  },
};

module.exports = {
  id: 'colors',
  name: 'Colors',
  nameAr: 'علبة الألوان',
  emoji: I.colors,
  description: 'رتب ألوان جاهزة وبانل اختيار لون الاسم بشعار Sword.',
  defaults: { roles: [], created: [], panel: { channelId: null, messageId: null } },
  commands: [{ data, execute }, clo],
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
      label: 'إنشاء ألوان مرقمة',
      description: `يحذف ألوان البوت القديمة وينشئ لين ${PALETTE.length} رتبة مرقمة 1-${PALETTE.length} تحت تلقائياً`,
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
        const message = await channel.send(await panelPayload(guild));
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
