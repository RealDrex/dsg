const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const db = require('../../core/db');
const store = require('../../core/store');
const { card, simple, emoji, DIVIDER, reply } = require('../../core/theme');
const { ts } = require('../../utils/time');
const transcript = require('./transcript');
const { userError } = require('../../core/errors');
const { I, asEmoji, setIcon, text } = require('../../core/icons');

const P = PermissionFlagsBits;
const pad = (n) => String(n).padStart(4, '0');

const q = {
  byChannel: db.prepare("SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'"),
  openFor: db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND owner_id = ? AND status = 'open'"),
  insert: db.prepare('INSERT INTO tickets (guild_id, channel_id, owner_id, number, type, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  claim: db.prepare('UPDATE tickets SET claimed_by = ? WHERE channel_id = ?'),
  close: db.prepare("UPDATE tickets SET status = 'closed', closed_at = ? WHERE channel_id = ?"),
};

const cfgOf = (guildId) => store.get(guildId, 'tickets');
const isStaff = (member, cfg) => member.permissions.has(P.ManageChannels) || member.roles.cache.some((r) => cfg.staffRoles.includes(r.id));

// ── Panel ────────────────────────────────────────────────────────
function panelPayload(cfg) {
  const types = cfg.types.map((t) => `${text(t.emoji)} **${t.label}**\n> ${t.description || ''}`).join('\n');
  const { embed, files } = card({
    title: `${I.ticket} ${cfg.panel.title}`,
    description: `${cfg.panel.description}\n${DIVIDER}\n${types}\n${DIVIDER}\n${emoji.dot} اختر نوع التذكرة من القائمة تحت ${I.down}\n${emoji.dot} لا تفتح أكثر من تذكرة لنفس الموضوع.`,
    image: 'ticket',
    footer: 'Sword • Support Tickets',
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('tickets:open')
    .setPlaceholder('اختر نوع التذكرة')
    .addOptions(cfg.types.map((t) => ({ label: t.label, value: t.id, emoji: asEmoji(t.emoji), description: (t.description || '').slice(0, 100) || undefined })));
  return { embeds: [embed], files, components: [new ActionRowBuilder().addComponents(menu)], attachments: [] };
}

async function refreshPanel(guild, cfg) {
  if (!cfg.panel.channelId || !cfg.panel.messageId) return;
  const message = await guild.channels.cache.get(cfg.panel.channelId)?.messages.fetch(cfg.panel.messageId).catch(() => null);
  if (message) await message.edit(panelPayload(cfg)).catch(() => null);
}

function controls(claimedBy) {
  return new ActionRowBuilder().addComponents(
    setIcon(new ButtonBuilder().setCustomId('tickets:close').setLabel('إغلاق').setStyle(ButtonStyle.Danger), I.lock),
    setIcon(new ButtonBuilder().setCustomId('tickets:claim'), I.claim)
      .setLabel(claimedBy ? `مستلمة: ${claimedBy}`.slice(0, 80) : 'استلام').setStyle(ButtonStyle.Secondary).setDisabled(!!claimedBy),
  );
}

// ── Open ─────────────────────────────────────────────────────────
async function openTicket(interaction, typeId, reason) {
  const { guild, member } = interaction;
  const cfg = cfgOf(guild.id);
  const type = cfg.types.find((t) => t.id === typeId);
  if (!type) return reply.error(interaction, 'نوع التذكرة هذا ما عاد موجود.');

  // Members put under `tblock` by the staff plugin can't open tickets.
  if (store.isEnabled(guild.id, 'staff') && require('../staff/data').tblocked(guild.id, member.id)) {
    return reply.error(interaction, 'أنت ممنوع من فتح التذاكر.');
  }

  const open = q.openFor.all(guild.id, member.id).filter((t) => guild.channels.cache.has(t.channel_id));
  if (open.length >= cfg.maxOpen) {
    return reply.error(interaction, `عندك تذكرة مفتوحة: ${open.map((t) => `<#${t.channel_id}>`).join(' ')}`);
  }

  const number = cfg.counter + 1;
  store.update(guild.id, 'tickets', (c) => { c.counter = number; });

  const staffOverwrites = cfg.staffRoles
    .filter((id) => guild.roles.cache.has(id))
    .map((id) => ({ id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.ManageMessages] }));
  const parent = cfg.categoryId && guild.channels.cache.get(cfg.categoryId);
  const channel = await guild.channels.create({
    name: `ticket-${pad(number)}`,
    type: ChannelType.GuildText,
    parent: parent || undefined,
    topic: `Sword Ticket #${pad(number)} • ${type.label} • ${member.user.tag} (${member.id})`,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [P.ViewChannel] },
      { id: member.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks] },
      { id: guild.members.me.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels, P.EmbedLinks, P.AttachFiles] },
      ...staffOverwrites,
    ],
  });
  q.insert.run(guild.id, channel.id, member.id, number, type.id, Date.now());

  const { embed, files } = card({
    title: `${I.ticket} تذكرة #${pad(number)} — ${type.label}`,
    description: [
      `حيّاك ${member} ${emoji.gate}`,
      cfg.welcomeMessage,
      DIVIDER,
      `${emoji.dot} **النوع:** ${type.emoji} ${type.label}`,
      `${emoji.dot} **فُتحت:** ${ts(Date.now())}`,
      reason ? `${emoji.dot} **الموضوع:**\n> ${reason.replace(/\n/g, '\n> ')}` : null,
    ].filter(Boolean).join('\n'),
    image: 'line',
    footer: `Sword • Ticket #${pad(number)}`,
  });
  const staffPing = cfg.pingStaff ? cfg.staffRoles.map((id) => `<@&${id}>`).join(' ') : '';
  await channel.send({
    content: `${member} ${staffPing}`.trim(),
    embeds: [embed],
    files,
    components: [controls()],
    allowedMentions: { users: [member.id], roles: cfg.pingStaff ? cfg.staffRoles : [] },
  });
  return reply.success(interaction, `تم فتح تذكرتك: ${channel}`);
}

// ── Close ────────────────────────────────────────────────────────
async function closeTicket(interaction, reason) {
  const { guild, channel, user } = interaction;
  const ticket = q.byChannel.get(channel.id);
  if (!ticket) return;
  const cfg = cfgOf(guild.id);
  const type = cfg.types.find((t) => t.id === ticket.type);
  const owner = await interaction.client.users.fetch(ticket.owner_id).catch(() => null);

  await channel.send({ embeds: [simple(`${I.lock} التذكرة بتنقفل خلال ثواني...\nبواسطة ${user}`, 'accent')] });
  q.close.run(Date.now(), channel.id);

  const { html, count } = await transcript.build(channel, {
    number: ticket.number, typeLabel: type?.label || ticket.type, ownerTag: owner?.tag || ticket.owner_id,
  });
  const fileName = `ticket-${pad(ticket.number)}.html`;
  const summary = simple([
    `${emoji.dot} **التذكرة:** #${pad(ticket.number)} • ${type ? `${type.emoji} ${type.label}` : ticket.type}`,
    `${emoji.dot} **صاحبها:** <@${ticket.owner_id}>`,
    `${emoji.dot} **استلمها:** ${ticket.claimed_by ? `<@${ticket.claimed_by}>` : '—'}`,
    `${emoji.dot} **قفلها:** ${user}`,
    `${emoji.dot} **السبب:** ${reason || '—'}`,
    `${emoji.dot} **فُتحت:** ${ts(ticket.created_at)} • **الرسائل:** \`${count}\``,
  ].join('\n'), 'primary', `${I.archive} تذكرة مغلقة`);

  const log = cfg.logChannelId && guild.channels.cache.get(cfg.logChannelId);
  if (log) await log.send({ embeds: [summary], files: [new AttachmentBuilder(Buffer.from(html), { name: fileName })], allowedMentions: { parse: [] } }).catch(() => null);
  if (owner && cfg.dmTranscript) {
    await owner.send({ embeds: [summary], files: [new AttachmentBuilder(Buffer.from(html), { name: fileName })] }).catch(() => null);
  }
  setTimeout(() => channel.delete(`Ticket closed by ${user.tag}`).catch(() => null), 5000);
}

// ── Commands ─────────────────────────────────────────────────────
const typeOpt = (o) => o.setName('type').setDescription('النوع').setRequired(true).setAutocomplete(true);

const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('نظام التذاكر')
  .addSubcommand((s) => s.setName('setup').setDescription('إعداد التذاكر (للإدارة)')
    .addChannelOption((o) => o.setName('category').setDescription('الكاتقوري اللي تنفتح فيه التذاكر').setRequired(true).addChannelTypes(ChannelType.GuildCategory))
    .addRoleOption((o) => o.setName('staff').setDescription('رتبة فريق الدعم').setRequired(true))
    .addChannelOption((o) => o.setName('logs').setDescription('روم الترانسكربت واللوق').addChannelTypes(ChannelType.GuildText))
    .addIntegerOption((o) => o.setName('max_open').setDescription('أقصى عدد تذاكر مفتوحة للعضو').setMinValue(1).setMaxValue(5))
    .addBooleanOption((o) => o.setName('ping_staff').setDescription('منشن فريق الدعم عند فتح تذكرة'))
    .addBooleanOption((o) => o.setName('dm_transcript').setDescription('إرسال الترانسكربت لصاحب التذكرة')))
  .addSubcommand((s) => s.setName('panel').setDescription('إرسال بانل التذاكر (للإدارة)')
    .addChannelOption((o) => o.setName('channel').setDescription('الروم').addChannelTypes(ChannelType.GuildText))
    .addStringOption((o) => o.setName('title').setDescription('العنوان').setMaxLength(100))
    .addStringOption((o) => o.setName('description').setDescription('الوصف (\\n لسطر جديد)').setMaxLength(1500)))
  .addSubcommandGroup((g) => g.setName('type').setDescription('أنواع التذاكر (للإدارة)')
    .addSubcommand((s) => s.setName('add').setDescription('إضافة نوع')
      .addStringOption((o) => o.setName('label').setDescription('الاسم').setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName('emoji').setDescription('الأيقونة: اسم أيقونة مثل support أو إيموجي').setRequired(true))
      .addStringOption((o) => o.setName('description').setDescription('الوصف').setMaxLength(100)))
    .addSubcommand((s) => s.setName('remove').setDescription('حذف نوع').addStringOption(typeOpt))
    .addSubcommand((s) => s.setName('list').setDescription('عرض الأنواع')))
  .addSubcommand((s) => s.setName('close').setDescription('إغلاق التذكرة الحالية')
    .addStringOption((o) => o.setName('reason').setDescription('السبب').setMaxLength(300)))
  .addSubcommand((s) => s.setName('claim').setDescription('استلام التذكرة الحالية'))
  .addSubcommand((s) => s.setName('add').setDescription('إضافة عضو للتذكرة')
    .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true)))
  .addSubcommand((s) => s.setName('remove').setDescription('إزالة عضو من التذكرة')
    .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true)))
  .addSubcommand((s) => s.setName('rename').setDescription('تغيير اسم التذكرة')
    .addStringOption((o) => o.setName('name').setDescription('الاسم الجديد').setRequired(true).setMaxLength(90)));

async function claim(interaction) {
  const cfg = cfgOf(interaction.guildId);
  const ticket = q.byChannel.get(interaction.channelId);
  if (!ticket) return reply.error(interaction, 'هذا الروم مو تذكرة.');
  if (!isStaff(interaction.member, cfg)) return reply.error(interaction, 'الاستلام لفريق الدعم فقط.');
  if (ticket.claimed_by) return reply.error(interaction, `التذكرة مستلمة من <@${ticket.claimed_by}>`);
  q.claim.run(interaction.user.id, interaction.channelId);
  const name = interaction.member.displayName;
  if (interaction.isButton()) await interaction.message.edit({ components: [controls(name)] }).catch(() => null);
  return interaction.reply({ embeds: [simple(`${I.claim} ${interaction.user} استلم التذكرة وبيساعدك الحين.`, 'success')] });
}

async function execute(interaction) {
  const o = interaction.options;
  const group = o.getSubcommandGroup();
  const sub = o.getSubcommand();
  const { guild, guildId, member } = interaction;
  const cfg = cfgOf(guildId);
  const adminOnly = ['setup', 'panel'].includes(sub) || group === 'type';
  if (adminOnly && !member.permissions.has(P.ManageGuild)) return reply.error(interaction, 'تحتاج صلاحية Manage Server.');

  if (group === 'type') {
    if (sub === 'list') {
      return reply.info(interaction, `${I.ticket} **أنواع التذاكر**\n${DIVIDER}\n${cfg.types.map((t) => `${text(t.emoji)} **${t.label}** — ${t.description || ''}`).join('\n') || '—'}`);
    }
    if (sub === 'add') {
      if (cfg.types.length >= 25) return reply.error(interaction, 'الحد الأقصى 25 نوع.');
      store.update(guildId, 'tickets', (c) => {
        c.types.push({ id: Date.now().toString(36), label: o.getString('label'), emoji: o.getString('emoji'), description: o.getString('description') || '' });
      });
    } else {
      store.update(guildId, 'tickets', (c) => { c.types = c.types.filter((t) => t.id !== o.getString('type')); });
      if (!cfgOf(guildId).types.length) return reply.error(interaction, 'لازم يبقى نوع واحد على الأقل — أضف نوع جديد.');
    }
    await refreshPanel(guild, cfgOf(guildId));
    return reply.success(interaction, sub === 'add' ? 'تمت إضافة النوع وتحديث البانل.' : 'تم حذف النوع وتحديث البانل.');
  }

  switch (sub) {
    case 'setup':
      store.update(guildId, 'tickets', (c) => {
        c.categoryId = o.getChannel('category').id;
        c.staffRoles = [o.getRole('staff').id];
        c.logChannelId = o.getChannel('logs')?.id ?? c.logChannelId;
        c.maxOpen = o.getInteger('max_open') ?? c.maxOpen;
        c.pingStaff = o.getBoolean('ping_staff') ?? c.pingStaff;
        c.dmTranscript = o.getBoolean('dm_transcript') ?? c.dmTranscript;
      });
      return reply.success(interaction, `تم إعداد التذاكر ${emoji.sword}\nالحين أرسل البانل بـ \`/تذكرة لوحة\``);
    case 'panel': {
      const channel = o.getChannel('channel') || interaction.channel;
      store.update(guildId, 'tickets', (c) => {
        if (o.getString('title')) c.panel.title = o.getString('title');
        if (o.getString('description')) c.panel.description = o.getString('description').replace(/\\n/g, '\n');
      });
      const message = await channel.send(panelPayload(cfgOf(guildId)));
      store.update(guildId, 'tickets', (c) => {
        c.panel.channelId = channel.id;
        c.panel.messageId = message.id;
      });
      return reply.success(interaction, `تم إرسال بانل التذاكر في ${channel}`);
    }
    case 'claim':
      return claim(interaction);
  }

  const ticket = q.byChannel.get(interaction.channelId);
  if (!ticket) return reply.error(interaction, 'هذا الأمر يشتغل داخل تذكرة فقط.');
  const staff = isStaff(member, cfg);

  switch (sub) {
    case 'close':
      if (!staff && ticket.owner_id !== member.id) return reply.error(interaction, 'ما تقدر تقفل هذي التذكرة.');
      await interaction.reply({ embeds: [simple(`${I.lock} جاري الإغلاق...`)], flags: MessageFlags.Ephemeral });
      return closeTicket(interaction, o.getString('reason'));
    case 'add':
    case 'remove': {
      if (!staff) return reply.error(interaction, 'لفريق الدعم فقط.');
      const user = o.getUser('user');
      if (sub === 'add') {
        await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
      } else {
        if (user.id === ticket.owner_id) return reply.error(interaction, 'ما تقدر تشيل صاحب التذكرة.');
        await interaction.channel.permissionOverwrites.delete(user.id);
      }
      return interaction.reply({ embeds: [simple(sub === 'add' ? `${I.plus} تمت إضافة ${user} للتذكرة.` : `${I.minus} تمت إزالة ${user} من التذكرة.`)] });
    }
    case 'rename':
      if (!staff) return reply.error(interaction, 'لفريق الدعم فقط.');
      await interaction.channel.setName(o.getString('name'));
      return reply.success(interaction, 'تم تغيير الاسم.');
  }
}

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const types = cfgOf(interaction.guildId).types;
  await interaction.respond(types.filter((t) => t.label.toLowerCase().includes(focused)).slice(0, 25)
    .map((t) => ({ name: t.label.slice(0, 100), value: t.id })));
}

module.exports = {
  id: 'tickets',
  name: 'Tickets',
  nameAr: 'التذاكر',
  emoji: I.ticket,
  description: 'تذاكر ببانل وشعار Sword، أنواع متعددة، استلام، وترانسكربت HTML بثيم السيرفر.',
  defaults: {
    categoryId: null,
    staffRoles: [],
    logChannelId: null,
    maxOpen: 1,
    pingStaff: true,
    dmTranscript: true,
    askReason: true,
    counter: 0,
    welcomeMessage: 'اكتب مشكلتك أو طلبك بالتفصيل وبيرد عليك فريق الدعم بأقرب وقت.',
    panel: {
      title: 'تذاكر Sword',
      description: 'تحتاج مساعدة؟ فريق **Sword** حاضر لك.',
      channelId: null,
      messageId: null,
    },
    types: [
      { id: 'support', label: 'الدعم الفني', emoji: 'support', description: 'مشكلة أو خلل تحتاج فيه مساعدة' },
      { id: 'report', label: 'بلاغ عن عضو', emoji: 'report', description: 'بلّغ عن مخالفة مع الدليل' },
      { id: 'question', label: 'استفسار عام', emoji: 'question', description: 'أي سؤال عن السيرفر' },
      { id: 'partner', label: 'شراكة وتعاون', emoji: 'partner', description: 'طلبات الشراكة والإعلانات' },
    ],
  },
  commands: [{ data, execute, autocomplete }],
  dashboard: [
    {
      title: 'الإعداد', icon: 'settings',
      fields: [
        { key: 'categoryId', type: 'category', label: 'كاتقوري التذاكر', hint: 'المكان اللي تنفتح فيه رومات التذاكر' },
        { key: 'staffRoles', type: 'roles', label: 'رتب فريق الدعم', max: 10 },
        { key: 'logChannelId', type: 'channel', label: 'روم الترانسكربت واللوق' },
        { key: 'maxOpen', type: 'number', label: 'أقصى تذاكر مفتوحة للعضو', min: 1, max: 5 },
        { key: 'pingStaff', type: 'bool', label: 'منشن فريق الدعم عند فتح تذكرة' },
        { key: 'dmTranscript', type: 'bool', label: 'إرسال الترانسكربت لصاحب التذكرة' },
        { key: 'askReason', type: 'bool', label: 'سؤال العضو عن موضوع التذكرة قبل الفتح' },
      ],
    },
    {
      title: 'البانل والرسائل', icon: 'ticket',
      fields: [
        { key: 'panel.title', type: 'text', label: 'عنوان البانل', max: 100, required: true },
        { key: 'panel.description', type: 'textarea', label: 'وصف البانل', max: 1500 },
        { key: 'welcomeMessage', type: 'textarea', label: 'رسالة الترحيب داخل التذكرة', max: 1000 },
      ],
    },
    {
      title: 'أنواع التذاكر', icon: 'folder',
      description: 'تظهر كقائمة اختيار في البانل (حد أقصى 25)',
      fields: [
        {
          key: 'types', type: 'list', label: 'الأنواع', addLabel: 'إضافة نوع', max: 25, idKey: 'id',
          fields: [
            { key: 'emoji', type: 'icon', label: 'الأيقونة', required: true },
            { key: 'label', type: 'text', label: 'الاسم', max: 80, required: true },
            { key: 'description', type: 'text', label: 'الوصف', max: 100 },
          ],
        },
      ],
    },
  ],
  validate(cfg) {
    if (!cfg.types.length) throw userError('لازم يكون فيه نوع تذكرة واحد على الأقل');
  },
  async dashboardSaved(guild) {
    await refreshPanel(guild, cfgOf(guild.id));
  },
  actions: {
    sendPanel: {
      label: 'إرسال بانل التذاكر',
      description: 'يرسل البانل ببانر TICKETS وشعار Sword في الروم اللي تختاره',
      params: [{ key: 'channelId', type: 'channel', label: 'الروم' }],
      async run(guild, { channelId }) {
        const channel = channelId && guild.channels.cache.get(channelId);
        if (!channel) throw userError('اختر الروم');
        const message = await channel.send(panelPayload(cfgOf(guild.id)));
        store.update(guild.id, 'tickets', (c) => { c.panel.channelId = channel.id; c.panel.messageId = message.id; });
        return `تم إرسال البانل في #${channel.name}`;
      },
    },
  },
  components: {
    async open(interaction) {
      const typeId = interaction.values[0];
      const cfg = cfgOf(interaction.guildId);
      // Reset the select so the same option can be picked again.
      interaction.message.edit({ components: interaction.message.components }).catch(() => null);
      if (!cfg.askReason) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return openTicket(interaction, typeId);
      }
      const type = cfg.types.find((t) => t.id === typeId);
      const modal = new ModalBuilder()
        .setCustomId(`tickets:modal:${typeId}`)
        .setTitle(`${type?.label || 'تذكرة جديدة'}`.slice(0, 45))
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('وش موضوع التذكرة؟')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('اكتب التفاصيل هنا...')
            .setRequired(false)
            .setMaxLength(1000),
        ));
      return interaction.showModal(modal);
    },
    async modal(interaction, [typeId]) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return openTicket(interaction, typeId, interaction.fields.getTextInputValue('reason')?.trim());
    },
    async close(interaction) {
      const ticket = q.byChannel.get(interaction.channelId);
      if (!ticket) return reply.error(interaction, 'التذكرة مقفلة.');
      if (!isStaff(interaction.member, cfgOf(interaction.guildId)) && ticket.owner_id !== interaction.user.id) {
        return reply.error(interaction, 'ما تقدر تقفل هذي التذكرة.');
      }
      return interaction.reply({
        embeds: [simple(`${I.lock} متأكد تبي تقفل التذكرة؟`)],
        components: [new ActionRowBuilder().addComponents(
          setIcon(new ButtonBuilder().setCustomId('tickets:confirm').setLabel('إغلاق').setStyle(ButtonStyle.Danger), I.lock),
          new ButtonBuilder().setCustomId('tickets:cancel').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
        )],
        flags: MessageFlags.Ephemeral,
      });
    },
    async confirm(interaction) {
      await interaction.update({ embeds: [simple(`${I.lock} جاري الإغلاق...`)], components: [] });
      return closeTicket(interaction);
    },
    async cancel(interaction) {
      return interaction.update({ embeds: [simple('تم الإلغاء.')], components: [] });
    },
    claim,
  },
  events: {
    channelDelete(channel) {
      if (q.byChannel.get(channel.id)) q.close.run(Date.now(), channel.id);
    },
  },
};
