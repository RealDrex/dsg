// Temporary voice rooms ("join to create"): joining the hub channel makes a
// private room under a category and moves you in. A control panel lets the owner
// rename / limit / lock / hide / kick / block their room.
const {
  PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const store = require('../../core/store');
const { reply } = require('../../core/theme');
const { I, setIcon } = require('../../core/icons');
const logger = require('../../core/logger');
const art = require('../activation/art');
const data = require('./data');

const P = PermissionFlagsBits;
const ID = 'tempvoice';
const cfgOf = (g) => store.get(g, ID);
const resolveId = (s) => (String(s || '').match(/\d{15,20}/) || [])[0] || null;

// ── control panel ─────────────────────────────────────────────────────
async function panelPayload() {
  const file = new AttachmentBuilder(await art.banner('VOICE CONTROL', 'تحكم برومك المؤقت — لازم تكون داخل رومك'), { name: 'voice-control.png' });
  const btn = (id, label, icon, style = ButtonStyle.Secondary) =>
    setIcon(new ButtonBuilder().setCustomId(`tempvoice:${id}`).setLabel(label).setStyle(style), icon);
  return {
    files: [file],
    components: [
      new ActionRowBuilder().addComponents(
        btn('rename', 'الاسم', I.edit),
        btn('limit', 'الحد', I.users),
        btn('lock', 'قفل', I.lock),
        btn('unlock', 'فتح', I.unlock),
        btn('claim', 'ملكية', I.user),
      ),
      new ActionRowBuilder().addComponents(
        btn('hide', 'إخفاء', I.hide),
        btn('show', 'إظهار', I.show),
        btn('kick', 'طرد', I.logout),
        btn('block', 'حظر', I.kick, ButtonStyle.Danger),
        btn('unblock', 'فك الحظر', I.autorole, ButtonStyle.Success),
      ),
    ],
  };
}

async function sendPanel(guild, channel) {
  const sent = await channel.send(await panelPayload());
  store.update(guild.id, ID, (c) => { c.panelChannel = channel.id; c.panelMsg = sent.id; });
  return sent;
}

// ── join-to-create / cleanup ──────────────────────────────────────────
async function onVoiceUpdate(oldS, newS) {
  const cfg = cfgOf(newS.guild.id);
  const member = newS.member;

  // A denied user who got into a claimed room anyway (e.g. via a high role) → kick.
  if (newS.channelId && member && !member.user.bot && newS.channelId !== oldS.channelId
      && data.claimOwner(newS.channelId) && data.denyHas(newS.channelId, member.id)) {
    await member.voice.disconnect('مرفوض من الروم').catch(() => null);
    return;
  }

  // joined the hub → make a room and move them in
  if (cfg.joinChannel && newS.channelId === cfg.joinChannel && member && !member.user.bot) {
    const parent = cfg.category && newS.guild.channels.cache.get(cfg.category);
    try {
      const room = await newS.guild.channels.create({
        name: cfg.nameTemplate.replace('{user}', member.displayName).slice(0, 100),
        type: ChannelType.GuildVoice,
        parent: parent || undefined,
        userLimit: cfg.defaultLimit || 0,
        permissionOverwrites: [
          { id: member.id, allow: [P.ViewChannel, P.Connect, P.Speak, P.Stream, P.MoveMembers] },
          { id: newS.guild.members.me.id, allow: [P.ViewChannel, P.Connect, P.ManageChannels, P.MoveMembers] },
        ],
      });
      data.add(newS.guild.id, room.id, member.id);
      await member.voice.setChannel(room).catch(() => null);
    } catch (e) { logger.warn('[tempvoice] create:', e.message); }
  }

  // left a temp room that is now empty → delete it
  const left = oldS.channel;
  if (left && left.id !== newS.channelId && data.byChannel(left.id) && left.members.size === 0) {
    data.remove(left.id);
    await left.delete('temp room empty').catch(() => null);
  }
}

// ── auto-clear temp room chats ────────────────────────────────────────
const lastClear = new Map(); // channelId -> timestamp
const FRESH = 14 * 24 * 60 * 60 * 1000;

async function clearChat(channel) {
  for (let i = 0; i < 5; i += 1) {
    const batch = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!batch || !batch.size) break;
    const fresh = batch.filter((m) => Date.now() - m.createdTimestamp < FRESH && !m.pinned);
    if (!fresh.size) break;
    const res = await channel.bulkDelete(fresh, true).catch(() => null);
    if (!res || res.size < 100) break;
  }
}

async function sweepChats(client) {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    if (!store.isEnabled(guild.id, ID)) continue;
    const cfg = cfgOf(guild.id);
    if (!cfg.autoClear) continue;
    const everyMs = Math.max(1, cfg.autoClearHours || 2) * 60 * 60 * 1000;
    for (const row of data.all(guild.id)) {
      const ch = guild.channels.cache.get(row.channel_id);
      if (!ch) { data.remove(row.channel_id); lastClear.delete(row.channel_id); continue; }
      if (now - (lastClear.get(ch.id) || 0) < everyMs) continue;
      lastClear.set(ch.id, now);
      await clearChat(ch);
    }
  }
}

// ── panel helpers ─────────────────────────────────────────────────────
// Returns the owner's temp room channel, or replies with an error.
async function ownRoom(interaction) {
  const row = data.byOwner(interaction.guildId, interaction.user.id);
  const ch = row && interaction.guild.channels.cache.get(row.channel_id);
  if (!ch) { await reply.error(interaction, 'ما عندك روم مؤقت. ادخل روم الإنشاء أول.'); return null; }
  return ch;
}

const oneInput = (id, label, style = TextInputStyle.Short) => new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId('v').setLabel(label).setStyle(style).setRequired(true).setMaxLength(100));
const modal = (id, title, label) => new ModalBuilder().setCustomId(`tempvoice:${id}`).setTitle(title).addComponents(oneInput('v', label));

// ── room ownership text commands ──────────────────────────────────────
// Grant/deny access to the channel where the command is used.
function accessPerms(channel, allow) {
  const voice = channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice;
  if (voice) return allow
    ? { ViewChannel: true, Connect: true, Speak: true }
    : { ViewChannel: false, Connect: false };
  return allow
    ? { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }
    : { ViewChannel: false };
}

async function onMessage(message) {
  if (!message.inGuild() || message.author.bot || !message.member || !message.content) return;
  const norm = message.content.trim().replace(/\s+/g, ' ');
  const low = norm.toLowerCase();
  const react = (ok) => message.react(ok ? '✅' : '❌').catch(() => null);
  const say = (t) => message.reply({ content: t, allowedMentions: { repliedUser: false } }).catch(() => null);
  const ch = message.channel;
  const ownerId = data.claimOwner(ch.id);
  const isOwner = ownerId && ownerId === message.author.id;
  const argId = () => {
    const m = message.mentions.users.first();
    if (m) return m.id;
    const n = norm.match(/\d{15,20}/);
    return n ? n[0] : null;
  };

  // vc/ → control panel (admins)
  const tok = norm.split(' ')[0].replace(/^[!\-#.+]/, '').toLowerCase();
  if (tok === 'vc/' || tok === 'vc') {
    if (!message.member.permissions.has(P.ManageGuild)) return;
    const mentioned = message.mentions.channels.find((c) => c.isTextBased?.());
    const err = await sendPanel(message.guild, mentioned || ch).then(() => null).catch((e) => e.message);
    await react(!err);
    if (err) await say(`Failed: ${err}`);
    return;
  }

  // انشاء ملكيه → claim the current room
  if (/^انشاء ملكي[ةه]$/.test(norm) || low === 'claim room') {
    if (ownerId) return void say(`هذا الروم له مالك: <@${ownerId}>`);
    data.claimSet(message.guildId, ch.id, message.author.id);
    await react(true);
    return void say(`صرت مالك هذا الروم ${message.author}.`);
  }

  // نقل ملكيه @user → transfer
  if (/^نقل ملكي[ةه]\b/.test(norm)) {
    if (!isOwner) return void react(false);
    const id = argId();
    if (!id) return void say('منشن الشخص أو حط آيديه.');
    data.claimSet(message.guildId, ch.id, id);
    await react(true);
    return void say(`تم نقل ملكية الروم لـ <@${id}>.`);
  }

  // رفض دخول @user → hide + record deny (kicked on sight if they bypass)
  if (/^رفض دخول\b/.test(norm)) {
    if (!isOwner) return void react(false);
    const id = argId();
    if (!id) return void say('منشن الشخص أو حط آيديه.');
    data.denyAdd(ch.id, id);
    await ch.permissionOverwrites.edit(id, accessPerms(ch, false)).catch(() => null);
    const m = await message.guild.members.fetch(id).catch(() => null);
    if (m && (m.voice?.channelId === ch.id)) await m.voice.disconnect('رفض دخول').catch(() => null);
    await react(true);
    return void say(`تم رفض دخول <@${id}> — الروم مخفي عنه ولو دخل غصب يتطرد.`);
  }

  // دخول @user|id → show + allow access
  if (/^دخول\b/.test(norm)) {
    if (!isOwner) return void react(false);
    const id = argId();
    if (!id) return void say('منشن الشخص أو حط آيديه. مثال: `دخول @عضو`');
    data.denyDel(ch.id, id);
    await ch.permissionOverwrites.edit(id, accessPerms(ch, true)).catch(() => null);
    await react(true);
    return void say(`تم السماح لـ <@${id}> بالدخول — صار الروم يظهر له.`);
  }
}

module.exports = {
  id: ID,
  name: 'Temp Voice',
  nameAr: 'الرومات المؤقتة',
  emoji: I.voice,
  description: 'رومات صوتية مؤقتة: ادخل روم الإنشاء ينعمل لك روم خاص، ولوحة تحكم (اسم، حد، قفل، إخفاء، طرد، حظر).',
  defaults: {
    joinChannel: '1560369860800680148',
    category: '1560369292095004702',
    panelChannel: null,
    panelMsg: null,
    nameTemplate: 'روم {user}',
    defaultLimit: 0,
    autoClear: true,       // مسح شات الرومات المؤقتة تلقائياً
    autoClearHours: 2,     // كل كم ساعة
  },
  dashboard: [
    {
      title: 'إعداد الرومات المؤقتة', icon: 'voice',
      fields: [
        { key: 'joinChannel', type: 'channel', label: 'روم الإنشاء (الدخول عليه يصنع روم)' },
        { key: 'category', type: 'category', label: 'كاتوقري الرومات المؤقتة' },
        { key: 'panelChannel', type: 'channel', label: 'روم لوحة التحكم' },
        { key: 'nameTemplate', type: 'text', label: 'اسم الروم ({user} = اسم العضو)', max: 80 },
        { key: 'defaultLimit', type: 'number', label: 'الحد الافتراضي للأعضاء (0 = بلا حد)', min: 0, max: 99 },
        { key: 'autoClear', type: 'bool', label: 'مسح شات الرومات تلقائياً' },
        { key: 'autoClearHours', type: 'number', label: 'كل كم ساعة يمسح الشات', min: 1, max: 48 },
      ],
    },
  ],
  actions: {
    panel: {
      label: 'إرسال لوحة التحكم',
      description: 'يرسل بانر VOICE CONTROL وأزرار التحكم في الروم المؤقت',
      params: [{ key: 'channelId', type: 'channel', label: 'الروم' }],
      async run(guild, { channelId }) {
        const channel = (channelId && guild.channels.cache.get(channelId))
          || guild.channels.cache.get(cfgOf(guild.id).panelChannel);
        if (!channel) throw new Error('اختر الروم');
        await sendPanel(guild, channel);
        return `تم إرسال اللوحة في #${channel.name}`;
      },
    },
  },
  async ready(client) {
    for (const guild of client.guilds.cache.values()) {
      if (!store.isEnabled(guild.id, ID)) continue;
      const cfg = cfgOf(guild.id);
      if (!cfg.panelChannel) continue;
      const ch = await guild.channels.fetch(cfg.panelChannel).catch(() => null);
      if (!ch) continue;
      if (cfg.panelMsg && await ch.messages.fetch(cfg.panelMsg).catch(() => null)) continue;
      await sendPanel(guild, ch).catch((e) => logger.warn('[tempvoice] panel:', e.message));
    }
    // Auto-clear temp room chats: check hourly, purge rooms whose interval elapsed.
    setInterval(() => sweepChats(client).catch(() => null), 60 * 60 * 1000);
    sweepChats(client).catch(() => null);
  },
  events: {
    voiceStateUpdate: onVoiceUpdate,
    channelDelete(channel) { if (data.byChannel(channel.id)) data.remove(channel.id); data.claimDel(channel.id); },
    messageCreate: onMessage,
  },
  components: {
    async rename(i) { if (await ownRoom(i)) return i.showModal(modal('renamesubmit', 'اسم الروم', 'الاسم الجديد')); },
    async renamesubmit(i) {
      const ch = await ownRoom(i); if (!ch) return;
      await ch.setName(i.fields.getTextInputValue('v').slice(0, 100)).catch(() => null);
      return reply.success(i, 'تم تغيير اسم الروم.');
    },
    async limit(i) { if (await ownRoom(i)) return i.showModal(modal('limitsubmit', 'حد الأعضاء', 'الرقم (0 = بلا حد)')); },
    async limitsubmit(i) {
      const ch = await ownRoom(i); if (!ch) return;
      const n = Math.max(0, Math.min(99, parseInt(i.fields.getTextInputValue('v'), 10) || 0));
      await ch.setUserLimit(n).catch(() => null);
      return reply.success(i, `تم ضبط الحد على ${n || 'بلا حد'}.`);
    },
    async lock(i) {
      const ch = await ownRoom(i); if (!ch) return;
      await ch.permissionOverwrites.edit(i.guild.roles.everyone, { Connect: false }).catch(() => null);
      return reply.success(i, 'تم قفل الروم.');
    },
    async unlock(i) {
      const ch = await ownRoom(i); if (!ch) return;
      await ch.permissionOverwrites.edit(i.guild.roles.everyone, { Connect: null }).catch(() => null);
      return reply.success(i, 'تم فتح الروم.');
    },
    async hide(i) {
      const ch = await ownRoom(i); if (!ch) return;
      await ch.permissionOverwrites.edit(i.guild.roles.everyone, { ViewChannel: false }).catch(() => null);
      return reply.success(i, 'تم إخفاء الروم.');
    },
    async show(i) {
      const ch = await ownRoom(i); if (!ch) return;
      await ch.permissionOverwrites.edit(i.guild.roles.everyone, { ViewChannel: null }).catch(() => null);
      return reply.success(i, 'تم إظهار الروم.');
    },
    async kick(i) { if (await ownRoom(i)) return i.showModal(modal('kicksubmit', 'طرد عضو من الروم', 'آيدي العضو أو منشنه')); },
    async kicksubmit(i) {
      const ch = await ownRoom(i); if (!ch) return;
      const id = resolveId(i.fields.getTextInputValue('v'));
      const m = id && await i.guild.members.fetch(id).catch(() => null);
      if (!m) return reply.error(i, 'العضو مو موجود.');
      if (m.voice.channelId === ch.id) await m.voice.disconnect('temp room kick').catch(() => null);
      return reply.success(i, `تم طرد ${m} من الروم.`);
    },
    async block(i) { if (await ownRoom(i)) return i.showModal(modal('blocksubmit', 'حظر عضو من الروم', 'آيدي العضو أو منشنه')); },
    async blocksubmit(i) {
      const ch = await ownRoom(i); if (!ch) return;
      const id = resolveId(i.fields.getTextInputValue('v'));
      const m = id && await i.guild.members.fetch(id).catch(() => null);
      if (!m) return reply.error(i, 'العضو مو موجود.');
      await ch.permissionOverwrites.edit(m.id, { Connect: false, ViewChannel: false }).catch(() => null);
      if (m.voice.channelId === ch.id) await m.voice.disconnect('temp room block').catch(() => null);
      return reply.success(i, `تم حظر ${m} من الروم.`);
    },
    async unblock(i) { if (await ownRoom(i)) return i.showModal(modal('unblocksubmit', 'فك حظر عضو', 'آيدي العضو أو منشنه')); },
    async unblocksubmit(i) {
      const ch = await ownRoom(i); if (!ch) return;
      const id = resolveId(i.fields.getTextInputValue('v'));
      if (!id) return reply.error(i, 'آيدي غير صحيح.');
      await ch.permissionOverwrites.delete(id).catch(() => null);
      return reply.success(i, `تم فك الحظر عن <@${id}>.`);
    },
    async claim(i) {
      const row = data.byChannel(i.member.voice?.channelId);
      if (!row) return reply.error(i, 'لازم تكون داخل روم مؤقت.');
      const owner = i.guild.members.cache.get(row.owner_id);
      if (owner && owner.voice?.channelId === i.member.voice.channelId) {
        return reply.error(i, 'المالك لا يزال في الروم.');
      }
      data.setOwner(row.channel_id, i.user.id);
      return reply.success(i, 'صرت مالك هذا الروم.');
    },
  },
};
