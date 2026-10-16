// Activation (نظام التفعيل): new members get the SOWRD gate role and can only see
// the activation category. They open an activation ticket, staff talk to them and
// press "تفعيل" to lift the SOWRD role so the rest of the server appears.
const {
  PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const store = require('../../core/store');
const { reply } = require('../../core/theme');
const { I, setIcon } = require('../../core/icons');
const { normalize } = require('../../core/i18n');
const crypto = require('node:crypto');
const config = require('../../config');
const logger = require('../../core/logger');
const transcript = require('../tickets/transcript');
const transcripts = require('../../core/transcripts');
const data = require('./data');
const art = require('./art');

const P = PermissionFlagsBits;
const ID = 'activation';
const pad = (n) => String(n).padStart(4, '0');

const cfgOf = (g) => store.get(g, ID);
// The activation role can activate; the server owner and granted users too.
const canActivate = (member, cfg) => member.id === member.guild.ownerId
  || (!!cfg.staffRole && member.roles.cache.has(cfg.staffRole))
  || data.grantHas(member.guild.id, member.id);
const canManage = (member, cfg) => canActivate(member, cfg) || member.permissions.has(P.ManageChannels);

// ── banners / panels ─────────────────────────────────────────────────
// Panel buttons are plain English with no icon (icons live only on ticket buttons).
async function ticketPanelPayload() {
  const file = new AttachmentBuilder(await art.banner('ACTIVATION SOWRD', 'Open a ticket to get activated'), { name: 'activation.png' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('activation:open').setLabel('Open Ticket').setStyle(ButtonStyle.Success),
  );
  return { files: [file], components: [row] };
}

async function activatePanelPayload() {
  const file = new AttachmentBuilder(await art.banner('ACTIVATION PANEL', 'Press Activate and enter the member to activate'), { name: 'activation-panel.png' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('activation:panel').setLabel('Activate').setStyle(ButtonStyle.Success),
  );
  return { files: [file], components: [row] };
}

// Send a panel to a channel and remember its message id (so we don't repost it).
async function sendPanel(guild, channel, which) {
  const payload = which === 'ticket' ? await ticketPanelPayload() : await activatePanelPayload();
  const sent = await channel.send(payload);
  store.update(guild.id, ID, (c) => { c[which === 'ticket' ? 'ticketPanelMsg' : 'activatePanelMsg'] = sent.id; });
  return sent;
}

// On startup: make sure each panel exists in its room, post it if missing.
async function ensurePanel(guild, channelId, which, msgKey) {
  if (!channelId) return;
  // fetch (not cache) so private rooms resolve; a failure means the bot can't see it.
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) { logger.warn(`[activation] روم ${which} (${channelId}) البوت ما يقدر يشوفه — أعطه صلاحية View Channel`); return; }
  const existingId = cfgOf(guild.id)[msgKey];
  if (existingId) {
    const msg = await channel.messages.fetch(existingId).catch(() => null);
    if (msg) return;
  }
  try {
    await sendPanel(guild, channel, which);
    logger.info(`[activation] تم إرسال بنل ${which} في #${channel.name}`);
  } catch (e) {
    logger.warn(`[activation] تعذر إرسال بنل ${which} في ${channelId}: ${e.message}`);
  }
}

async function ready(client) {
  for (const guild of client.guilds.cache.values()) {
    if (!store.isEnabled(guild.id, ID)) continue;
    const cfg = cfgOf(guild.id);
    await ensurePanel(guild, cfg.ticketPanelChannel, 'ticket', 'ticketPanelMsg');
    await ensurePanel(guild, cfg.activatePanelChannel, 'activate', 'activatePanelMsg');
  }
}

// Ticket control buttons keep the SVG icons, English labels.
function ticketControls() {
  return new ActionRowBuilder().addComponents(
    setIcon(new ButtonBuilder().setCustomId('activation:activate').setLabel('Activate').setStyle(ButtonStyle.Success), I.unlock),
    setIcon(new ButtonBuilder().setCustomId('activation:add').setLabel('Add').setStyle(ButtonStyle.Secondary), I.plus),
    setIcon(new ButtonBuilder().setCustomId('activation:remove').setLabel('Remove').setStyle(ButtonStyle.Secondary), I.minus),
    setIcon(new ButtonBuilder().setCustomId('activation:close').setLabel('Close').setStyle(ButtonStyle.Danger), I.lock),
  );
}

// ── core actions ─────────────────────────────────────────────────────
function resolveId(str) {
  const m = String(str || '').match(/\d{15,20}/);
  return m ? m[0] : null;
}

// Roles we can safely pull off a gated member (not @everyone / SOWRD / managed /
// above the bot in the hierarchy).
function removableRoles(member, cfg) {
  const botTop = member.guild.members.me.roles.highest.position;
  const mId = memberRoleId(cfg);
  return member.roles.cache.filter((r) => r.id !== member.guild.id
    && r.id !== cfg.sowrdRole && r.id !== mId && !r.managed && r.position < botTop);
}

// Gate a member: stash their other roles and strip them so SOWRD is the only thing
// deciding what they see (this is the only way an Administrator stays hidden too).
async function quarantine(member, cfg) {
  // Never gate the server owner (can't hide rooms from them anyway) or bots.
  if (member.user.bot || member.id === member.guild.ownerId) return;
  if (!cfg.sowrdRole || !member.roles.cache.has(cfg.sowrdRole)) return;
  const rem = removableRoles(member, cfg);
  if (!rem.size) return;
  const held = new Set([...data.holdGet(member.guild.id, member.id), ...rem.keys()]);
  data.holdSet(member.guild.id, member.id, [...held]);
  await member.roles.remove([...rem.keys()], 'نظام التفعيل: حجز الرتب لحين التفعيل').catch(() => null);
}

// The activated "Sword" member role id (config, falling back to the fixed id).
const memberRoleId = (cfg) => cfg.memberRole || '1559430792411877417';
// The log room id (config, falling back to the fixed id even if saved as null).
const logChannelId = (cfg) => cfg.logChannelId || '1559549676640800889';

// Members mid-activation: the sticky/quarantine watchers skip them so our own
// role changes don't fight each other.
const activating = new Set();

async function activateMember(guild, target, cfg) {
  if (!cfg.sowrdRole || !guild.roles.cache.get(cfg.sowrdRole)) throw new Error('SOWRD role is not set or missing.');
  const mId = memberRoleId(cfg);
  const held = data.holdGet(guild.id, target.id);
  const hadSowrd = target.roles.cache.has(cfg.sowrdRole);
  if (!hadSowrd && !held.length && target.roles.cache.has(mId)) return { already: true };
  const key = `${guild.id}:${target.id}`;
  activating.add(key);
  try {
    data.holdClear(guild.id, target.id);
    // 1) drop the gate role FIRST so the quarantine watcher won't re-strip what we add next
    if (hadSowrd) await target.roles.remove(cfg.sowrdRole, 'تفعيل العضو').catch(() => null);
    // 2) restore any held roles + give the activated "Sword" member role, in one update
    const add = held.filter((id) => guild.roles.cache.get(id)
      && guild.roles.cache.get(id).position < guild.members.me.roles.highest.position);
    if (guild.roles.cache.get(mId)) add.push(mId);
    if (add.length) await target.roles.add([...new Set(add)], 'تفعيل العضو: الرتب').catch(() => null);
  } finally {
    setTimeout(() => activating.delete(key), 4000); // let the role-change events flush
  }
  const log = guild.channels.cache.get(logChannelId(cfg)) || await guild.channels.fetch(logChannelId(cfg)).catch(() => null);
  if (log) log.send({ content: `تم تفعيل ${target} \`${target.id}\``, allowedMentions: { parse: [] } }).catch(() => null);
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
    name: `activation-${pad(number)}`,
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
  return reply.success(interaction, `Ticket opened: ${channel}`);
}

// Build an HTML transcript of the ticket (Discord theme) and post it to the log
// room with a mention of the activated member and the staffer who handled it.
async function logTicket(guild, channel, cfg, { number, ownerId, actorId, activated }) {
  const logCh = await guild.channels.fetch(logChannelId(cfg)).catch(() => null);
  if (!logCh) { logger.warn('[activation] log room not reachable:', logChannelId(cfg)); return; }
  let html; let count = 0;
  try {
    const owner = await guild.client.users.fetch(ownerId).catch(() => null);
    ({ html, count } = await transcript.build(channel, { number, typeLabel: 'Activation', ownerTag: owner?.tag || ownerId }));
  } catch (e) { logger.warn('[activation] transcript:', e.message); return; }
  // Save the transcript and post it as a browser link (not a downloadable file).
  const id = crypto.randomBytes(8).toString('hex');
  transcripts.save(id, html);
  const base = (config.web.publicUrl || `http://82.47.102.201:${config.web.port}`).replace(/\/$/, '');
  const head = [
    `**Activation Ticket #${pad(number)}**`,
    `العضو: <@${ownerId}>`,
    actorId ? `${activated ? 'فعّله' : 'أغلق التذكرة'}: <@${actorId}>` : null,
    `الرسائل: ${count}`,
    `الترانسكربت: ${base}/t/${id}`,
  ].filter(Boolean).join('\n');
  await logCh.send({ content: head, allowedMentions: { users: [ownerId, actorId].filter(Boolean) } }).catch(() => null);
}

async function lockRooms(guild, cfg) {
  if (!cfg.sowrdRole || !guild.roles.cache.get(cfg.sowrdRole)) throw new Error('SOWRD role is missing.');
  // 1) hide every room from SOWRD except the activation category
  let denied = 0; let allowed = 0;
  for (const ch of guild.channels.cache.values()) {
    const inKeep = ch.id === cfg.category || ch.parentId === cfg.category;
    try {
      // SOWRD must be able to actually read the panel in the activation rooms.
      await ch.permissionOverwrites.edit(cfg.sowrdRole,
        inKeep ? { ViewChannel: true, ReadMessageHistory: true } : { ViewChannel: false },
        { reason: 'إعداد نظام التفعيل' });
      if (inKeep) allowed += 1; else denied += 1;
    } catch { /* skip channels we can't edit */ }
  }
  // 2) quarantine everyone who already has SOWRD (strip strong/admin roles)
  const botTop = guild.members.me.roles.highest.position;
  let gated = 0; let blocked = 0;
  const members = await guild.members.fetch().catch(() => null);
  if (members) {
    for (const m of members.values()) {
      if (m.user.bot || m.id === guild.ownerId || !m.roles.cache.has(cfg.sowrdRole)) continue;
      if (removableRoles(m, cfg).size) { await quarantine(m, cfg); gated += 1; }
      // a non-managed role at/above the bot can't be stripped → this member stays visible
      const stuck = m.roles.cache.some((r) => r.id !== guild.id && r.id !== cfg.sowrdRole && !r.managed && r.position >= botTop);
      if (stuck) blocked += 1;
    }
  }
  return { denied, allowed, gated, blocked };
}

// Full undo: give everyone their held roles back, clear holds, and lift the SOWRD
// room hides. The server owner can always run this to recover.
async function unlockAll(guild, cfg) {
  const botTop = guild.members.me.roles.highest.position;
  let restored = 0; let skippedHigh = 0;
  for (const row of data.holdAll(guild.id)) {
    const m = await guild.members.fetch(row.userId).catch(() => null);
    const roles = row.roles.filter((id) => guild.roles.cache.get(id));
    const addable = roles.filter((id) => guild.roles.cache.get(id).position < botTop);
    skippedHigh += roles.length - addable.length; // roles the bot is too low to give back
    if (m && addable.length) await m.roles.add(addable, 'إلغاء نظام التفعيل: إرجاع الرتب').catch(() => null);
    // keep the row if some roles still couldn't be restored, so a later run (after the
    // bot is moved up) can finish the job.
    if (roles.length === addable.length) { data.holdClear(guild.id, row.userId); restored += 1; }
  }
  let lifted = 0;
  if (cfg.sowrdRole) {
    for (const ch of guild.channels.cache.values()) {
      try { await ch.permissionOverwrites.delete(cfg.sowrdRole, 'إلغاء نظام التفعيل'); lifted += 1; } catch { /* ignore */ }
    }
  }
  return { restored, lifted, skippedHigh };
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

  // Target room from a #mention / id after the command, else the configured room, else here.
  const targetChannel = (fallbackId) => {
    const mentioned = message.mentions.channels.find((c) => c.isTextBased?.());
    if (mentioned) return mentioned;
    const id = resolveId(parts.slice(1).join(' '));
    if (id) return message.guild.channels.cache.get(id) || message.channel;
    return (fallbackId && message.guild.channels.cache.get(fallbackId)) || message.channel;
  };
  const react = (ok) => message.react(ok ? '✅' : '❌').catch(() => null);
  const say = (text) => message.reply({ content: text, allowedMentions: { repliedUser: false } }).catch(() => null);

  if (low === 'ac/' || low === 'ac') {
    if (!admin) return;
    const err = await sendPanel(message.guild, targetChannel(cfg.ticketPanelChannel), 'ticket').then(() => null).catch((e) => e.message);
    await react(!err);
    if (err) await say(`Failed to send panel: ${err}`);
    return;
  }
  if (low === 'acp/' || low === 'acp') {
    if (!admin) return;
    const err = await sendPanel(message.guild, targetChannel(cfg.activatePanelChannel), 'activate').then(() => null).catch((e) => e.message);
    await react(!err);
    if (err) await say(`Failed to send panel: ${err}`);
    return;
  }
  if (low === 'acunlock/' || low === 'acunlock') {
    if (!admin && message.author.id !== message.guild.ownerId) return void react(false);
    const res = await unlockAll(message.guild, cfg).catch((e) => ({ error: e.message }));
    await react(!res.error);
    if (res.error) return void say(`Error: ${res.error}`);
    let txt = `Unlocked — restored ${res.restored} members, lifted hides on ${res.lifted} rooms.`;
    if (res.skippedHigh) txt += ` ${res.skippedHigh} role(s) are above the bot — move the bot role up and run !acunlock again.`;
    await say(txt);
    return;
  }
  if (low === 'aclock/' || low === 'aclock') {
    if (!admin) return;
    const res = await lockRooms(message.guild, cfg).catch((e) => ({ error: e.message }));
    await react(!res.error);
    if (res.error) { await say(`Error: ${res.error}`); return; }
    let txt = `Done — hidden ${res.denied} rooms, gated ${res.gated} members.`;
    if (res.blocked) txt += ` ⚠️ ${res.blocked} member(s) hold a role ABOVE the bot — move the bot's role to the very top, then run !aclock again.`;
    await say(txt);
    return;
  }

  // +تفعيل @عضو → grant/revoke that user's permission to use تفعيل
  if (first === '+تفعيل' || first.toLowerCase() === '+activate') {
    if (!canActivate(message.member, cfg)) return void react(false);
    let id = resolveId(parts.slice(1).join(' '));
    if (!id && message.reference?.messageId) {
      const ref = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
      id = ref?.author?.id || null;
    }
    if (!id) return void react(false);
    const added = data.grantToggle(message.guildId, id);
    await react(true);
    await say(added ? `✅ <@${id}> صار يقدر يستخدم أمر تفعيل.` : `تم سحب صلاحية التفعيل من <@${id}>.`);
    return;
  }

  if (normalize(bare) === normalize('تفعيل') || low === 'activate') {
    if (!canActivate(message.member, cfg)) return void react(false);
    let id = resolveId(parts.slice(1).join(' '));
    if (!id && message.reference?.messageId) {
      const ref = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
      id = ref?.author?.id || null;
    }
    if (!id) return void react(false);
    const target = await message.guild.members.fetch(id).catch(() => null);
    if (!target) return void react(false);
    const res = await activateMember(message.guild, target, cfg).catch((e) => ({ error: e.message }));
    await react(!res.error);
  }
}

// ── auto-role on join ────────────────────────────────────────────────
async function onJoin(member) {
  const cfg = cfgOf(member.guild.id);
  if (member.user.bot || !cfg.sowrdRole) return;
  if (member.guild.roles.cache.get(cfg.sowrdRole)) {
    await member.roles.add(cfg.sowrdRole, 'نظام التفعيل: رتبة SOWRD تلقائياً').catch(() => null);
  }
}

// Keep the gate airtight: if a SOWRD holder gains any strong role, pull it back.
async function onMemberUpdate(oldM, newM) {
  const cfg = cfgOf(newM.guild.id);
  if (newM.user.bot || newM.id === newM.guild.ownerId || !cfg.sowrdRole) return;
  if (activating.has(`${newM.guild.id}:${newM.id}`)) return;
  // Activated members are left alone.
  if (newM.roles.cache.has(memberRoleId(cfg))) return;
  // Sticky OP: if an unactivated member had the gate role removed by hand, put it back.
  if (oldM.roles.cache.has(cfg.sowrdRole) && !newM.roles.cache.has(cfg.sowrdRole)
      && newM.guild.roles.cache.get(cfg.sowrdRole)) {
    await newM.roles.add(cfg.sowrdRole, 'نظام التفعيل: إعادة رتبة OP تلقائياً').catch(() => null);
    return;
  }
  // Quarantine: a gated member with strong roles gets them stripped.
  if (newM.roles.cache.has(cfg.sowrdRole) && removableRoles(newM, cfg).size) await quarantine(newM, cfg);
}

// ── add/remove member to a ticket (via modal) ────────────────────────
function userModal(action, label) {
  return new ModalBuilder().setCustomId(`activation:${action}`).setTitle(label).addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('user').setLabel('Member ID or mention').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40),
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
    memberRole: '1559430792411877417',
    category: '1559405080048836608',
    staffRole: '1505729933807194263',
    ticketPanelChannel: '1559405250065211442',
    activatePanelChannel: '1559406871788523630',
    ticketPanelMsg: null,
    activatePanelMsg: null,
    logChannelId: '1559549676640800889',
    counter: 0,
  },
  dashboard: [
    {
      title: 'إعداد التفعيل', icon: 'unlock',
      description: 'ac/ يحط بانل فتح التذكرة • acp/ يحط بانل التفعيل • aclock/ يخفي الرومات عن رتبة SOWRD',
      fields: [
        { key: 'sowrdRole', type: 'role', label: 'رتبة SOWRD (غير مفعّل — تلقائية + تنفك بالتفعيل)' },
        { key: 'memberRole', type: 'role', label: 'رتبة Sword (المفعّلين — تنعطى بالتفعيل)', hint: 'فاضي = البوت ينشئها تلقائياً' },
        { key: 'category', type: 'category', label: 'كاتوقري تذاكر التفعيل' },
        { key: 'staffRole', type: 'role', label: 'رتبة التفعيل (تنمنشن وتقدر تفعّل بس)' },
        { key: 'ticketPanelChannel', type: 'channel', label: 'روم بنل فتح التذكرة' },
        { key: 'activatePanelChannel', type: 'channel', label: 'روم بنل التفعيل (الإدارة)' },
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
      description: 'يخفي الرومات عن SOWRD (ما عدا كاتوقري التفعيل) ويحجز رتب كل من معه SOWRD حتى لو أدمن',
      async run(guild) {
        const res = await lockRooms(guild, cfgOf(guild.id));
        return `تم — مخفي ${res.denied} روم، وحجزت رتب ${res.gated} عضو.`;
      },
    },
    unlockAll: {
      label: 'فك القفل وإرجاع الرتب',
      description: 'يرجّع رتب كل الأعضاء المحجوزين ويلغي إخفاء الرومات عن SOWRD',
      async run(guild) {
        const res = await unlockAll(guild, cfgOf(guild.id));
        return `تم — رجعت رتب ${res.restored} عضو، وأزلت الإخفاء عن ${res.lifted} روم.`;
      },
    },
  },
  ready,
  events: {
    messageCreate: onMessage,
    guildMemberAdd: onJoin,
    guildMemberUpdate: onMemberUpdate,
    channelDelete(channel) { if (data.byChannel(channel.id)) data.close(channel.id); },
  },
  components: {
    async open(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return openTicket(interaction);
    },
    async activate(interaction) {
      const cfg = cfgOf(interaction.guildId);
      if (!canActivate(interaction.member, cfg)) return reply.error(interaction, 'Activation role only.');
      const t = data.byChannel(interaction.channelId);
      if (!t) return reply.error(interaction, 'This is not an activation ticket.');
      const target = await interaction.guild.members.fetch(t.owner_id).catch(() => null);
      if (!target) return reply.error(interaction, 'Ticket owner is no longer in the server.');
      const res = await activateMember(interaction.guild, target, cfg).catch((e) => ({ error: e.message }));
      if (res.error) return reply.error(interaction, res.error);
      await interaction.reply({ content: `✅ Activated ${target} — rooms are now visible. Closing ticket.`, allowedMentions: { users: [target.id] } });
      await logTicket(interaction.guild, interaction.channel, cfg, { number: t.number, ownerId: t.owner_id, actorId: interaction.user.id, activated: true });
      data.close(interaction.channelId);
      setTimeout(() => interaction.channel?.delete('activation done').catch(() => null), 5000);
    },
    async add(interaction) {
      if (!canManage(interaction.member, cfgOf(interaction.guildId))) return reply.error(interaction, 'Activation role / staff only.');
      return interaction.showModal(userModal('addsubmit', 'Add member to ticket'));
    },
    async remove(interaction) {
      if (!canManage(interaction.member, cfgOf(interaction.guildId))) return reply.error(interaction, 'Activation role / staff only.');
      return interaction.showModal(userModal('removesubmit', 'Remove member from ticket'));
    },
    async addsubmit(interaction) {
      const id = resolveId(interaction.fields.getTextInputValue('user'));
      const target = id && await interaction.guild.members.fetch(id).catch(() => null);
      if (!target) return reply.error(interaction, 'Member not found.');
      await interaction.channel.permissionOverwrites.edit(target.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
      return interaction.reply({ content: `✅ Added ${target} to the ticket.`, allowedMentions: { users: [target.id] } });
    },
    async removesubmit(interaction) {
      const id = resolveId(interaction.fields.getTextInputValue('user'));
      const t = data.byChannel(interaction.channelId);
      if (id && t && id === t.owner_id) return reply.error(interaction, "You can't remove the ticket owner.");
      if (!id) return reply.error(interaction, 'Invalid ID.');
      await interaction.channel.permissionOverwrites.delete(id).catch(() => null);
      return interaction.reply({ content: `✅ Removed <@${id}> from the ticket.`, allowedMentions: { parse: [] } });
    },
    async close(interaction) {
      const t = data.byChannel(interaction.channelId);
      if (!t) return reply.error(interaction, 'Ticket already closed.');
      // Only staff / activation role can close — the ticket owner cannot.
      if (!canManage(interaction.member, cfgOf(interaction.guildId))) {
        return reply.error(interaction, 'Activation role / staff only.');
      }
      await interaction.reply({ content: '🔒 Closing...' });
      await logTicket(interaction.guild, interaction.channel, cfgOf(interaction.guildId), { number: t.number, ownerId: t.owner_id, actorId: interaction.user.id, activated: false });
      data.close(interaction.channelId);
      setTimeout(() => interaction.channel?.delete(`closed by ${interaction.user.tag}`).catch(() => null), 3000);
    },
    async panel(interaction) {
      if (!canActivate(interaction.member, cfgOf(interaction.guildId))) return reply.error(interaction, 'Activation role only.');
      return interaction.showModal(userModal('panelsubmit', 'Activate member'));
    },
    async panelsubmit(interaction) {
      const cfg = cfgOf(interaction.guildId);
      const id = resolveId(interaction.fields.getTextInputValue('user'));
      const target = id && await interaction.guild.members.fetch(id).catch(() => null);
      if (!target) return reply.error(interaction, 'Member not found in the server.');
      const res = await activateMember(interaction.guild, target, cfg).catch((e) => ({ error: e.message }));
      if (res.error) return reply.error(interaction, res.error);
      return interaction.reply({ content: res.already ? `${target} is already activated.` : `✅ Activated ${target}.`, flags: MessageFlags.Ephemeral });
    },
  },
};
