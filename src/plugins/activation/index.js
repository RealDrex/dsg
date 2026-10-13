// Activation (نظام التفعيل): new members get the SOWRD gate role and can only see
// the activation category. They open an activation ticket, staff talk to them and
// press "تفعيل" to lift the SOWRD role so the rest of the server appears.
const {
  PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const store = require('../../core/store');
const { reply, emoji } = require('../../core/theme');
const { I, setIcon } = require('../../core/icons');
const { normalize } = require('../../core/i18n');
const data = require('./data');
const art = require('./art');

const P = PermissionFlagsBits;
const ID = 'activation';
const pad = (n) => String(n).padStart(4, '0');

const cfgOf = (g) => store.get(g, ID);
const canActivate = (member, cfg) => !!cfg.staffRole && member.roles.cache.has(cfg.staffRole);
const canManage = (member, cfg) => canActivate(member, cfg) || member.permissions.has(P.ManageChannels);

// ── banners / panels ─────────────────────────────────────────────────
async function ticketPanelPayload() {
  const file = new AttachmentBuilder(await art.banner('ACTIVATION SOWRD', 'افتح تذكرة التفعيل عشان ننشّط حسابك'), { name: 'activation.png' });
  const row = new ActionRowBuilder().addComponents(
    setIcon(new ButtonBuilder().setCustomId('activation:open').setLabel('فتح تذكرة التفعيل').setStyle(ButtonStyle.Success), I.ticket),
  );
  return { files: [file], components: [row] };
}

async function activatePanelPayload() {
  const file = new AttachmentBuilder(await art.banner('ACTIVATION PANEL', 'اضغط تفعيل وحط العضو اللي تبي تنشّطه'), { name: 'activation-panel.png' });
  const row = new ActionRowBuilder().addComponents(
    setIcon(new ButtonBuilder().setCustomId('activation:panel').setLabel('تفعيل').setStyle(ButtonStyle.Success), I.unlock),
  );
  return { files: [file], components: [row] };
}

function ticketControls() {
  return new ActionRowBuilder().addComponents(
    setIcon(new ButtonBuilder().setCustomId('activation:activate').setLabel('تفعيل').setStyle(ButtonStyle.Success), I.unlock),
    setIcon(new ButtonBuilder().setCustomId('activation:add').setLabel('إضافة').setStyle(ButtonStyle.Secondary), I.plus),
    setIcon(new ButtonBuilder().setCustomId('activation:remove').setLabel('إزالة').setStyle(ButtonStyle.Secondary), I.minus),
    setIcon(new ButtonBuilder().setCustomId('activation:close').setLabel('إغلاق').setStyle(ButtonStyle.Danger), I.lock),
  );
}

// ── core actions ─────────────────────────────────────────────────────
function resolveId(str) {
  const m = String(str || '').match(/\d{15,20}/);
  return m ? m[0] : null;
}

async function activateMember(guild, target, cfg) {
  if (!cfg.sowrdRole || !guild.roles.cache.get(cfg.sowrdRole)) throw new Error('رتبة SOWRD مو محددة أو مو موجودة.');
  if (!target.roles.cache.has(cfg.sowrdRole)) return { already: true };
  await target.roles.remove(cfg.sowrdRole, 'تفعيل العضو');
  const log = cfg.logChannelId && guild.channels.cache.get(cfg.logChannelId);
  if (log) log.send({ content: `${I.unlock} تم تفعيل ${target} \`${target.id}\``, allowedMentions: { parse: [] } }).catch(() => null);
  return { ok: true };
}

async function openTicket(interaction) {
  const { guild, member } = interaction;
  const cfg = cfgOf(guild.id);
  const existing = data.openForOwner(guild.id, member.id).filter((t) => guild.channels.cache.has(t.channel_id));
  if (existing.length) return reply.error(interaction, `عندك تذكرة تفعيل مفتوحة: <#${existing[0].channel_id}>`);

  const number = cfg.counter + 1;
  store.update(guild.id, ID, (c) => { c.counter = number; });
  const parent = cfg.category && guild.channels.cache.get(cfg.category);
  const staffAllow = cfg.staffRole && guild.roles.cache.has(cfg.staffRole)
    ? [{ id: cfg.staffRole, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.ManageMessages] }] : [];
  const channel = await guild.channels.create({
    name: `تفعيل-${pad(number)}`,
    type: ChannelType.GuildText,
    parent: parent || undefined,
    topic: `Activation #${pad(number)} • ${member.user.tag} (${member.id})`,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [P.ViewChannel] },
      { id: member.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles] },
      { id: guild.members.me.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels, P.AttachFiles] },
      ...staffAllow,
    ],
  });
  data.open(guild.id, channel.id, member.id, number);

  const ping = cfg.staffRole && guild.roles.cache.get(cfg.staffRole) ? `<@&${cfg.staffRole}>` : '';
  await channel.send({
    content: `${member} ${ping}\nحيّاك في تذكرة التفعيل — عرّفنا عن نفسك ومن وين عرفت السيرفر وبنفعّلك.`,
    components: [ticketControls()],
    allowedMentions: { users: [member.id], roles: cfg.staffRole ? [cfg.staffRole] : [] },
  });
  return reply.success(interaction, `تم فتح تذكرتك: ${channel}`);
}

async function lockRooms(guild, cfg) {
  if (!cfg.sowrdRole || !guild.roles.cache.get(cfg.sowrdRole)) throw new Error('رتبة SOWRD مو موجودة.');
  let denied = 0; let allowed = 0;
  for (const ch of guild.channels.cache.values()) {
    const inKeep = ch.id === cfg.category || ch.parentId === cfg.category;
    try {
      await ch.permissionOverwrites.edit(cfg.sowrdRole, { ViewChannel: inKeep }, { reason: 'إعداد نظام التفعيل' });
      if (inKeep) allowed += 1; else denied += 1;
    } catch { /* skip channels we can't edit */ }
  }
  return { denied, allowed };
}

// ── text commands: ac/  acp/  aclock/  تفعيل <target> ────────────────
async function onMessage(message) {
  if (!message.inGuild() || message.author.bot || !message.member || !message.content) return;
  const cfg = cfgOf(message.guildId);
  const parts = message.content.trim().split(/\s+/);
  const first = parts[0];
  const bare = first.replace(/^[!\-#.+]/, '');
  const low = bare.toLowerCase();
  const admin = message.member.permissions.has(P.ManageGuild);

  if (low === 'ac/' || low === 'ac') {
    if (!admin) return;
    await message.channel.send(await ticketPanelPayload()).catch(() => null);
    message.delete().catch(() => null);
    return;
  }
  if (low === 'acp/' || low === 'acp') {
    if (!admin) return;
    await message.channel.send(await activatePanelPayload()).catch(() => null);
    message.delete().catch(() => null);
    return;
  }
  if (low === 'aclock/' || low === 'aclock') {
    if (!admin) return;
    const res = await lockRooms(message.guild, cfg).catch((e) => ({ error: e.message }));
    const txt = res.error ? `${emoji.error} ${res.error}` : `${I.success} تم إخفاء كل الرومات عن رتبة SOWRD ما عدا كاتوقري التفعيل.\nمخفي: \`${res.denied}\` • ظاهر: \`${res.allowed}\``;
    await message.reply({ content: txt, allowedMentions: { repliedUser: false } }).catch(() => null);
    return;
  }

  if (normalize(bare) === normalize('تفعيل')) {
    if (!canActivate(message.member, cfg)) {
      return void message.reply({ content: `${emoji.error} التفعيل فقط لرتبة التفعيل.`, allowedMentions: { repliedUser: false } }).catch(() => null);
    }
    let id = resolveId(parts.slice(1).join(' '));
    if (!id && message.reference?.messageId) {
      const ref = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
      id = ref?.author?.id || null;
    }
    if (!id) return void message.reply({ content: `${emoji.error} منشن العضو أو حط آيديه أو رد على رسالته.`, allowedMentions: { repliedUser: false } }).catch(() => null);
    const target = await message.guild.members.fetch(id).catch(() => null);
    if (!target) return void message.reply({ content: `${emoji.error} العضو مو موجود بالسيرفر.`, allowedMentions: { repliedUser: false } }).catch(() => null);
    const res = await activateMember(message.guild, target, cfg).catch((e) => ({ error: e.message }));
    const txt = res.error ? `${emoji.error} ${res.error}`
      : res.already ? `${target} أصلاً مفعّل.`
        : `${I.success} تم تفعيل ${target} — صارت الرومات ظاهرة له.`;
    await message.reply({ content: txt, allowedMentions: { users: [target.id] } }).catch(() => null);
  }
}

// ── auto-role on join ────────────────────────────────────────────────
async function onJoin(member) {
  const cfg = cfgOf(member.guild.id);
  if (member.user.bot || !cfg.sowrdRole) return;
  if (member.guild.roles.cache.get(cfg.sowrdRole)) {
    member.roles.add(cfg.sowrdRole, 'نظام التفعيل: رتبة SOWRD تلقائياً').catch(() => null);
  }
}

// ── add/remove member to a ticket (via modal) ────────────────────────
function userModal(action, label) {
  return new ModalBuilder().setCustomId(`activation:${action}`).setTitle(label).addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('user').setLabel('آيدي العضو أو منشنه').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40),
    ),
  );
}

module.exports = {
  id: ID,
  name: 'Activation',
  nameAr: 'التفعيل',
  emoji: I.unlock,
  description: 'نظام تفعيل: رتبة SOWRD تلقائية للأعضاء الجدد، تذكرة تفعيل، وزر تفعيل يفك الرتبة ويظهر الرومات.',
  defaults: {
    sowrdRole: '760413937581162539',
    category: '1559405080048836608',
    staffRole: '1505729933807194263',
    activatePanelChannel: '1559406871788523630',
    logChannelId: null,
    counter: 0,
  },
  dashboard: [
    {
      title: 'إعداد التفعيل', icon: 'unlock',
      description: 'ac/ يحط بانل فتح التذكرة • acp/ يحط بانل التفعيل • aclock/ يخفي الرومات عن رتبة SOWRD',
      fields: [
        { key: 'sowrdRole', type: 'role', label: 'رتبة SOWRD (تلقائية + تنفك بالتفعيل)' },
        { key: 'category', type: 'category', label: 'كاتوقري تذاكر التفعيل' },
        { key: 'staffRole', type: 'role', label: 'رتبة التفعيل (تنمنشن وتقدر تفعّل بس)' },
        { key: 'activatePanelChannel', type: 'channel', label: 'روم بانل التفعيل' },
        { key: 'logChannelId', type: 'channel', label: 'روم لوق التفعيل' },
      ],
    },
  ],
  actions: {
    ticketPanel: {
      label: 'إرسال بانل فتح التذكرة',
      description: 'يرسل بانر ACTIVATION SOWRD وزر فتح تذكرة التفعيل',
      params: [{ key: 'channelId', type: 'channel', label: 'الروم' }],
      async run(guild, { channelId }) {
        const channel = channelId && guild.channels.cache.get(channelId);
        if (!channel) throw new Error('اختر الروم');
        await channel.send(await ticketPanelPayload());
        return `تم إرسال بانل التذاكر في #${channel.name}`;
      },
    },
    activatePanel: {
      label: 'إرسال بانل التفعيل',
      description: 'يرسل بانر ACTIVATION PANEL وزر تفعيل (لرتبة التفعيل)',
      params: [{ key: 'channelId', type: 'channel', label: 'الروم' }],
      async run(guild, { channelId }) {
        const channel = (channelId && guild.channels.cache.get(channelId))
          || guild.channels.cache.get(cfgOf(guild.id).activatePanelChannel);
        if (!channel) throw new Error('اختر الروم');
        await channel.send(await activatePanelPayload());
        return `تم إرسال بانل التفعيل في #${channel.name}`;
      },
    },
    lockRooms: {
      label: 'إخفاء الرومات عن SOWRD',
      description: 'يخلي رتبة SOWRD ما تشوف إلا كاتوقري التفعيل (للأعضاء الحاليين والجدد)',
      async run(guild) {
        const res = await lockRooms(guild, cfgOf(guild.id));
        return `تم — مخفي ${res.denied} روم، ظاهر ${res.allowed}.`;
      },
    },
  },
  events: {
    messageCreate: onMessage,
    guildMemberAdd: onJoin,
    channelDelete(channel) { if (data.byChannel(channel.id)) data.close(channel.id); },
  },
  components: {
    async open(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return openTicket(interaction);
    },
    async activate(interaction) {
      const cfg = cfgOf(interaction.guildId);
      if (!canActivate(interaction.member, cfg)) return reply.error(interaction, 'التفعيل فقط لرتبة التفعيل.');
      const t = data.byChannel(interaction.channelId);
      if (!t) return reply.error(interaction, 'هذا مو روم تذكرة تفعيل.');
      const target = await interaction.guild.members.fetch(t.owner_id).catch(() => null);
      if (!target) return reply.error(interaction, 'صاحب التذكرة مو موجود بالسيرفر.');
      const res = await activateMember(interaction.guild, target, cfg).catch((e) => ({ error: e.message }));
      if (res.error) return reply.error(interaction, res.error);
      await interaction.reply({ content: `${I.success} تم تفعيل ${target} — صارت الرومات ظاهرة له. التذكرة بتنقفل.`, allowedMentions: { users: [target.id] } });
      data.close(interaction.channelId);
      setTimeout(() => interaction.channel?.delete('activation done').catch(() => null), 5000);
    },
    async add(interaction) {
      if (!canManage(interaction.member, cfgOf(interaction.guildId))) return reply.error(interaction, 'لرتبة التفعيل / الإدارة فقط.');
      return interaction.showModal(userModal('addsubmit', 'إضافة عضو للتذكرة'));
    },
    async remove(interaction) {
      if (!canManage(interaction.member, cfgOf(interaction.guildId))) return reply.error(interaction, 'لرتبة التفعيل / الإدارة فقط.');
      return interaction.showModal(userModal('removesubmit', 'إزالة عضو من التذكرة'));
    },
    async addsubmit(interaction) {
      const id = resolveId(interaction.fields.getTextInputValue('user'));
      const target = id && await interaction.guild.members.fetch(id).catch(() => null);
      if (!target) return reply.error(interaction, 'العضو مو موجود.');
      await interaction.channel.permissionOverwrites.edit(target.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
      return interaction.reply({ content: `${I.plus} تمت إضافة ${target} للتذكرة.`, allowedMentions: { users: [target.id] } });
    },
    async removesubmit(interaction) {
      const id = resolveId(interaction.fields.getTextInputValue('user'));
      const t = data.byChannel(interaction.channelId);
      if (id && t && id === t.owner_id) return reply.error(interaction, 'ما تقدر تشيل صاحب التذكرة.');
      if (!id) return reply.error(interaction, 'آيدي غير صحيح.');
      await interaction.channel.permissionOverwrites.delete(id).catch(() => null);
      return interaction.reply({ content: `${I.minus} تمت إزالة <@${id}> من التذكرة.`, allowedMentions: { parse: [] } });
    },
    async close(interaction) {
      const t = data.byChannel(interaction.channelId);
      if (!t) return reply.error(interaction, 'التذكرة مقفلة.');
      if (!canManage(interaction.member, cfgOf(interaction.guildId)) && t.owner_id !== interaction.user.id) {
        return reply.error(interaction, 'ما تقدر تقفل هذي التذكرة.');
      }
      await interaction.reply({ content: `${I.lock} جاري الإغلاق...` });
      data.close(interaction.channelId);
      setTimeout(() => interaction.channel?.delete(`closed by ${interaction.user.tag}`).catch(() => null), 3000);
    },
    async panel(interaction) {
      if (!canActivate(interaction.member, cfgOf(interaction.guildId))) return reply.error(interaction, 'التفعيل فقط لرتبة التفعيل.');
      return interaction.showModal(userModal('panelsubmit', 'تفعيل عضو'));
    },
    async panelsubmit(interaction) {
      const cfg = cfgOf(interaction.guildId);
      const id = resolveId(interaction.fields.getTextInputValue('user'));
      const target = id && await interaction.guild.members.fetch(id).catch(() => null);
      if (!target) return reply.error(interaction, 'العضو مو موجود بالسيرفر.');
      const res = await activateMember(interaction.guild, target, cfg).catch((e) => ({ error: e.message }));
      if (res.error) return reply.error(interaction, res.error);
      return interaction.reply({ content: res.already ? `${target} أصلاً مفعّل.` : `${I.success} تم تفعيل ${target}.`, flags: MessageFlags.Ephemeral });
    },
  },
};
