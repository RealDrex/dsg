const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const store = require('../../core/store');
const { card, emoji, DIVIDER, reply } = require('../../core/theme');
const { canManageRole } = require('../../utils/perms');

const CUSTOM_EMOJI = /^<a?:\w+:(\d+)>$/;
const emojiKey = (text) => text.match(CUSTOM_EMOJI)?.[1] || text;
const reactionKey = (reaction) => reaction.emoji.id || reaction.emoji.name;

// ── Reaction roles ───────────────────────────────────────────────
async function onReaction(reaction, user, added) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const { message } = reaction;
  if (!message.guild) return;
  const cfg = store.get(message.guild.id, 'rolesassigner');
  const match = cfg.reactions.find((r) => r.messageId === message.id && r.emoji === reactionKey(reaction));
  if (!match) return;
  const member = await message.guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  if (added) await member.roles.add(match.roleId, 'Sword Reaction Role').catch(() => null);
  else await member.roles.remove(match.roleId, 'Sword Reaction Role').catch(() => null);
}

// ── Role panels (buttons / select menu) ──────────────────────────
function renderPanel(panel) {
  const lines = panel.roles.map((r) => `${r.emoji || emoji.dot} <@&${r.roleId}>${r.label ? ` — ${r.label}` : ''}`);
  const { embed, files } = card({
    title: `🎭 ${panel.title}`,
    description: `${panel.description || 'اختر رتبتك من الأزرار تحت 👇'}\n${DIVIDER}\n${lines.join('\n') || '*ما فيه رتب للحين*'}`,
    image: 'roles',
    footer: `Sword • ${panel.single ? 'رتبة وحدة فقط' : 'تقدر تختار أكثر من رتبة'}`,
  });
  const components = [];
  if (panel.roles.length && panel.mode === 'select') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`rolesassigner:sel:${panel.id}`)
      .setPlaceholder('🎭 اختر رتبك')
      .setMinValues(0)
      .setMaxValues(panel.single ? 1 : panel.roles.length)
      .addOptions(panel.roles.map((r) => ({ label: r.label || r.name || 'Role', value: r.roleId, emoji: r.emoji || undefined })));
    components.push(new ActionRowBuilder().addComponents(menu));
  } else if (panel.roles.length) {
    for (let i = 0; i < panel.roles.length; i += 5) {
      components.push(new ActionRowBuilder().addComponents(panel.roles.slice(i, i + 5).map((r) => {
        const button = new ButtonBuilder()
          .setCustomId(`rolesassigner:btn:${panel.id}:${r.roleId}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel(r.label || r.name || 'Role');
        if (r.emoji) button.setEmoji(r.emoji);
        return button;
      })));
    }
  }
  return { embeds: [embed], files, components, attachments: [] };
}

async function refreshPanel(guild, panel) {
  const channel = guild.channels.cache.get(panel.channelId);
  const message = await channel?.messages.fetch(panel.messageId).catch(() => null);
  if (!message) return false;
  await message.edit(renderPanel(panel));
  return true;
}

async function applyRoles(interaction, panel, wanted) {
  const member = interaction.member;
  const me = interaction.guild.members.me;
  const panelIds = panel.roles.map((r) => r.roleId).filter((id) => interaction.guild.roles.cache.get(id)?.position < me.roles.highest.position);
  const add = [...wanted].filter((id) => panelIds.includes(id) && !member.roles.cache.has(id));
  const remove = panelIds.filter((id) => !wanted.has(id) && member.roles.cache.has(id));
  if (add.length) await member.roles.add(add, 'Sword Role Panel');
  if (remove.length) await member.roles.remove(remove, 'Sword Role Panel');
  const parts = [];
  if (add.length) parts.push(`➕ ${add.map((id) => `<@&${id}>`).join(' ')}`);
  if (remove.length) parts.push(`➖ ${remove.map((id) => `<@&${id}>`).join(' ')}`);
  return reply.success(interaction, parts.join('\n') || 'ما تغير شي.');
}

const panelOpt = (o) => o.setName('panel').setDescription('رقم البانل').setRequired(true).setAutocomplete(true);

const reactionData = new SlashCommandBuilder()
  .setName('reactionrole')
  .setDescription('رتب بالرياكشن على رسالة')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((s) => s.setName('add').setDescription('ربط إيموجي برتبة على رسالة')
    .addStringOption((o) => o.setName('message_id').setDescription('آيدي الرسالة').setRequired(true))
    .addStringOption((o) => o.setName('emoji').setDescription('الإيموجي').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('الرتبة').setRequired(true))
    .addChannelOption((o) => o.setName('channel').setDescription('روم الرسالة (الافتراضي: الحالي)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
  .addSubcommand((s) => s.setName('remove').setDescription('إزالة ربط')
    .addStringOption((o) => o.setName('message_id').setDescription('آيدي الرسالة').setRequired(true))
    .addStringOption((o) => o.setName('emoji').setDescription('الإيموجي').setRequired(true)))
  .addSubcommand((s) => s.setName('list').setDescription('عرض كل الرياكشن رولز'));

async function reactionCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const { guildId } = interaction;
  if (sub === 'list') {
    const list = store.get(guildId, 'rolesassigner').reactions;
    const body = list.map((r) => `${r.emoji.match(/^\d+$/) ? `<:e:${r.emoji}>` : r.emoji} ← <@&${r.roleId}> • [الرسالة](https://discord.com/channels/${guildId}/${r.channelId}/${r.messageId})`);
    return reply.info(interaction, `🎭 **الرياكشن رولز (${list.length})**\n${DIVIDER}\n${body.join('\n') || '—'}`);
  }
  const messageId = interaction.options.getString('message_id').trim();
  const rawEmoji = interaction.options.getString('emoji').trim();
  const key = emojiKey(rawEmoji);
  if (sub === 'remove') {
    store.update(guildId, 'rolesassigner', (cfg) => {
      cfg.reactions = cfg.reactions.filter((r) => !(r.messageId === messageId && r.emoji === key));
    });
    return reply.success(interaction, 'تمت الإزالة.');
  }
  const role = interaction.options.getRole('role');
  const problem = canManageRole(interaction, role);
  if (problem) return reply.error(interaction, problem);
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return reply.error(interaction, `ما لقيت الرسالة في ${channel}.`);
  try {
    await message.react(rawEmoji);
  } catch {
    return reply.error(interaction, 'ما قدرت أستخدم هذا الإيموجي (لازم يكون من سيرفر البوت فيه).');
  }
  store.update(guildId, 'rolesassigner', (cfg) => {
    cfg.reactions = cfg.reactions.filter((r) => !(r.messageId === messageId && r.emoji === key));
    cfg.reactions.push({ channelId: channel.id, messageId, emoji: key, roleId: role.id });
  });
  return reply.success(interaction, `${rawEmoji} ← ${role} على [الرسالة](${message.url})`);
}

const panelData = new SlashCommandBuilder()
  .setName('rolepanel')
  .setDescription('بانل رتب بأزرار أو قائمة اختيار')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((s) => s.setName('create').setDescription('إنشاء بانل جديد')
    .addStringOption((o) => o.setName('title').setDescription('العنوان').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('mode').setDescription('الشكل').addChoices({ name: '🔘 أزرار', value: 'buttons' }, { name: '📜 قائمة اختيار', value: 'select' }))
    .addStringOption((o) => o.setName('description').setDescription('الوصف (\\n لسطر جديد)').setMaxLength(1500))
    .addBooleanOption((o) => o.setName('single').setDescription('رتبة وحدة بس لكل عضو'))
    .addChannelOption((o) => o.setName('channel').setDescription('الروم').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
  .addSubcommand((s) => s.setName('add').setDescription('إضافة رتبة للبانل')
    .addIntegerOption(panelOpt)
    .addRoleOption((o) => o.setName('role').setDescription('الرتبة').setRequired(true))
    .addStringOption((o) => o.setName('label').setDescription('اسم الزر (الافتراضي اسم الرتبة)').setMaxLength(80))
    .addStringOption((o) => o.setName('emoji').setDescription('إيموجي')))
  .addSubcommand((s) => s.setName('remove').setDescription('إزالة رتبة من البانل')
    .addIntegerOption(panelOpt)
    .addRoleOption((o) => o.setName('role').setDescription('الرتبة').setRequired(true)))
  .addSubcommand((s) => s.setName('delete').setDescription('حذف بانل').addIntegerOption(panelOpt))
  .addSubcommand((s) => s.setName('list').setDescription('عرض البانلات'));

async function panelCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const o = interaction.options;
  const { guild, guildId } = interaction;
  const cfg = store.get(guildId, 'rolesassigner');

  if (sub === 'list') {
    const list = Object.values(cfg.panels).map((p) => `\`#${p.id}\` **${p.title}** • ${p.roles.length} رتبة • <#${p.channelId}>`);
    return reply.info(interaction, `🎭 **بانلات الرتب**\n${DIVIDER}\n${list.join('\n') || '—'}`);
  }

  if (sub === 'create') {
    const channel = o.getChannel('channel') || interaction.channel;
    const panel = {
      id: cfg.nextPanel,
      channelId: channel.id,
      messageId: null,
      title: o.getString('title'),
      description: o.getString('description')?.replace(/\\n/g, '\n') || null,
      mode: o.getString('mode') || 'buttons',
      single: o.getBoolean('single') ?? false,
      roles: [],
    };
    const message = await channel.send(renderPanel(panel));
    panel.messageId = message.id;
    store.update(guildId, 'rolesassigner', (c) => {
      c.panels[panel.id] = panel;
      c.nextPanel += 1;
    });
    return reply.success(interaction, `تم إنشاء البانل \`#${panel.id}\` في ${channel}.\nأضف رتب بـ \`/بانل_رتب إضافة لوحة:${panel.id}\``);
  }

  const panel = cfg.panels[o.getInteger('panel')];
  if (!panel) return reply.error(interaction, 'ما لقيت بانل بهذا الرقم.');

  if (sub === 'delete') {
    const message = await guild.channels.cache.get(panel.channelId)?.messages.fetch(panel.messageId).catch(() => null);
    await message?.delete().catch(() => null);
    store.update(guildId, 'rolesassigner', (c) => { delete c.panels[panel.id]; });
    return reply.success(interaction, `تم حذف البانل \`#${panel.id}\``);
  }

  const role = o.getRole('role');
  if (sub === 'add') {
    const problem = canManageRole(interaction, role);
    if (problem) return reply.error(interaction, problem);
    if (panel.roles.length >= 25) return reply.error(interaction, 'البانل وصل الحد الأقصى (25 رتبة).');
    panel.roles = panel.roles.filter((r) => r.roleId !== role.id);
    panel.roles.push({ roleId: role.id, name: role.name, label: o.getString('label') || role.name, emoji: o.getString('emoji') || null });
  } else {
    panel.roles = panel.roles.filter((r) => r.roleId !== role.id);
  }
  store.save(guildId, 'rolesassigner', cfg);
  try {
    if (!(await refreshPanel(guild, panel))) return reply.error(interaction, 'رسالة البانل انحذفت. احذفه وسوّ واحد جديد.');
  } catch {
    if (sub === 'add') {
      panel.roles = panel.roles.filter((r) => r.roleId !== role.id);
      store.save(guildId, 'rolesassigner', cfg);
    }
    return reply.error(interaction, 'ما قدرت أحدث البانل — تأكد إن الإيموجي صحيح.');
  }
  return reply.success(interaction, sub === 'add' ? `تمت إضافة ${role} للبانل \`#${panel.id}\`` : `تمت إزالة ${role} من البانل`);
}

async function panelAutocomplete(interaction) {
  const focused = String(interaction.options.getFocused());
  const panels = Object.values(store.get(interaction.guildId, 'rolesassigner').panels);
  await interaction.respond(
    panels.filter((p) => `${p.id} ${p.title}`.includes(focused)).slice(0, 25)
      .map((p) => ({ name: `#${p.id} — ${p.title}`.slice(0, 100), value: p.id })),
  );
}

module.exports = {
  id: 'rolesassigner',
  name: 'Rolesassigner Plugin',
  nameAr: 'بلوقن الرياكشن والسلكت رول',
  emoji: '🎭',
  description: 'رتب بالرياكشن، وبانلات رتب بأزرار أو قائمة اختيار بثيم Sword.',
  defaults: { reactions: [], panels: {}, nextPanel: 1 },
  commands: [
    { data: reactionData, execute: reactionCommand },
    { data: panelData, execute: panelCommand, autocomplete: panelAutocomplete },
  ],
  dashboard: [
    {
      title: '🎭 البانلات والرياكشن رولز',
      description: 'البانلات تنشأ من ديسكورد عشان تختار مكانها: /بانل_رتب إنشاء ثم /بانل_رتب إضافة. والرياكشن رولز بـ /رتب_رياكشن إضافة. تقدر تحذفها من هنا.',
      fields: [
        {
          key: 'reactions', type: 'list', label: 'الرياكشن رولز', addLabel: null, max: 200,
          fields: [
            { key: 'channelId', type: 'channel', label: 'الروم' },
            { key: 'messageId', type: 'text', label: 'آيدي الرسالة', pattern: '^\\d{17,20}$', required: true },
            { key: 'emoji', type: 'text', label: 'الإيموجي', max: 64, required: true },
            { key: 'roleId', type: 'role', label: 'الرتبة', required: true },
          ],
        },
      ],
    },
  ],
  events: {
    messageReactionAdd: (reaction, user) => onReaction(reaction, user, true),
    messageReactionRemove: (reaction, user) => onReaction(reaction, user, false),
  },
  components: {
    async btn(interaction, [panelId, roleId]) {
      const panel = store.get(interaction.guildId, 'rolesassigner').panels[panelId];
      if (!panel) return reply.error(interaction, 'هذا البانل ما عاد موجود.');
      const has = interaction.member.roles.cache.has(roleId);
      const wanted = new Set(panel.single ? [] : panel.roles.map((r) => r.roleId).filter((id) => interaction.member.roles.cache.has(id)));
      if (has) wanted.delete(roleId);
      else wanted.add(roleId);
      return applyRoles(interaction, panel, wanted);
    },
    async sel(interaction, [panelId]) {
      const panel = store.get(interaction.guildId, 'rolesassigner').panels[panelId];
      if (!panel) return reply.error(interaction, 'هذا البانل ما عاد موجود.');
      return applyRoles(interaction, panel, new Set(interaction.values));
    },
  },
};

