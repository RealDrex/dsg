// Interactive staff system: short Arabic commands typed in chat (with or without
// a prefix) and gated by STAFF ROLES instead of Discord permissions.
//
//   اسكات @عضو        → كتم كتابي (رتبة الاسكات)
//   ميوت  @عضو        → ميوت صوتي (سيرفر ميوت)
//   سجن   @عضو        → سجن (يشيل رتبه ويحط رتبة السجن)
//   #بلاك @عضو        → بلاك لست
//   !طرد  @عضو        → طرد من السيرفر
//
// Every successful command gets a ✅ reaction; failures get ❌. باند و #بلاك
// تنحذف رسالة الأمر بعد ثواني. الصلاحيات ثلاث طبقات:
//   1 تفاعلية  → اسكات/تكلم/ميوت/فك
//   2 خاصة     → + سجن/عفو
//   3 ستريشن   → كل شي
const {
  PermissionFlagsBits, AuditLogEvent, MessageFlags, AttachmentBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const store = require('../../core/store');
const cases = require('../../core/cases');
const { simple } = require('../../core/theme');
const { I } = require('../../core/icons');
const { normalize } = require('../../core/i18n');
const { ts, parseDuration } = require('../../utils/time');
const { userError } = require('../../core/errors');
const logger = require('../../core/logger');
const data = require('./data');

const ID = 'staff';
const P = PermissionFlagsBits;
const NO_REASON = 'بدون سبب';

// ── permission levels ────────────────────────────────────────────────
// 0 member · 1 interactive · 2 special · 3 administration
function levelOf(member) {
  if (!member) return 0;
  if (member.id === member.guild.ownerId || member.permissions.has(P.Administrator)) return 3;
  const { roles } = store.get(member.guild.id, ID);
  const has = (ids) => ids.some((id) => member.roles.cache.has(id));
  if (has(roles.admin)) return 3;
  if (has(roles.special)) return 2;
  if (has(roles.interactive)) return 1;
  return 0;
}

// Hierarchy guard for punitive actions.
function guard(ctx, target, action = 'هذا الإجراء') {
  const { guild, member, me } = ctx;
  if (!target) return 'منشن العضو أو حط آيديه.';
  if (target.id === member.id) return `ما تقدر تسوي ${action} على نفسك.`;
  if (target.id === guild.ownerId) return 'ما ينفع على مالك السيرفر.';
  if (target.id === me.id) return `ما أقدر أسوي هذا على نفسي ${I.sword}`;
  if (target.user?.bot) return 'ما ينفع على البوتات.';
  if (member.id !== guild.ownerId && levelOf(target) >= levelOf(member)) return 'العضو إداري مثلك أو أعلى منك.';
  if (member.id !== guild.ownerId && target.roles.highest.position >= member.roles.highest.position) return 'رتبة العضو أعلى منك أو مساوية لك.';
  return null;
}

// Can the bot add/remove this role?
function roleUsable(ctx, roleId, label) {
  if (!roleId) return `ما فيه رتبة ${label} محددة — عيّنها من لوحة التحكم.`;
  const role = ctx.guild.roles.cache.get(roleId);
  if (!role) return `رتبة ${label} محذوفة — عدّلها من لوحة التحكم.`;
  if (role.position >= ctx.me.roles.highest.position) return `ارفع رتبة البوت فوق رتبة ${label}.`;
  return null;
}

const mentionId = (token) => (token || '').replace(/\D/g, '') || null;

// Resolve a role from a mention <@&id>, a raw id, or its name (exact then partial).
// Name search prefers assignable roles so it never lands on @everyone or a
// bot/booster (managed) role by accident; an explicit id/mention is returned as-is.
function resolveRole(guild, query) {
  const q = (query || '').trim();
  if (!q) return null;
  const id = (q.match(/^<@&(\d+)>$/) || q.match(/^(\d{15,25})$/) || [])[1];
  if (id) return guild.roles.cache.get(id) || null;
  const norm = q.toLowerCase();
  const pick = (coll) => coll.find((r) => r.name.toLowerCase() === norm) || coll.find((r) => r.name.toLowerCase().includes(norm)) || null;
  const assignable = guild.roles.cache.filter((r) => r.id !== guild.id && !r.managed);
  return pick(assignable) || pick(guild.roles.cache) || null;
}

// ── command context ──────────────────────────────────────────────────
function makeCtx(message, cfg) {
  const words = message._staffArgs.trim().length ? message._staffArgs.trim().split(/\s+/) : [];
  return {
    message,
    guild: message.guild,
    member: message.member,
    author: message.author,
    me: message.guild.members.me,
    client: message.client,
    channel: message.channel,
    cfg,
    args: message._staffArgs.trim(),
    words,
    level: message._staffLevel,
    reasonFrom: (n) => words.slice(n).join(' ').trim() || null,
    target: async (i = 0) => {
      const id = mentionId(words[i]);
      if (!id) return null;
      return message.guild.members.fetch(id).catch(() => null);
    },
    userTarget: async (i = 0) => {
      const id = mentionId(words[i]);
      if (!id) return null;
      return message.client.users.fetch(id).catch(() => null);
    },
    channelArg: (i = 0) => {
      const id = (words[i]?.match(/^<#(\d+)>$/) || [])[1] || (/^\d+$/.test(words[i] || '') ? words[i] : null);
      return (id && message.guild.channels.cache.get(id)) || message.channel;
    },
  };
}

// ── small helpers ────────────────────────────────────────────────────
const ok = (text) => ({ ok: text });
const err = (text) => ({ error: text });

function statusEmbed(title, lines, color = 'primary') {
  return { reply: { content: simple(lines.join('\n'), color, title), allowedMentions: { parse: [] } }, noReact: true };
}

async function dm(user, guild, text) {
  await user.send({ content: simple(text, 'accent') }).catch(() => null);
}

// ── per-action logging ───────────────────────────────────────────────
const LOGS = {
  vmute: { key: 'vmute', label: 'ميوت صوتي', icon: I.muted, color: 'accent' },
  tmute: { key: 'tmute', label: 'اسكات كتابي', icon: I.silence, color: 'accent' },
  block: { key: 'block', label: 'بلاك لست', icon: I.forbid, color: 'accent' },
  ban: { key: 'ban', label: 'باند', icon: I.ban, color: 'error' },
  jail: { key: 'jail', label: 'سجن', icon: I.lock, color: 'accent' },
  warn: { key: 'warn', label: 'تحذير', icon: I.warn, color: 'warn' },
  timeout: { key: 'timeout', label: 'تايم أوت', icon: I.timeout, color: 'accent' },
};

function logAction(guild, cfg, kind, { target, mod, minutes, reason }) {
  const meta = LOGS[kind];
  const channel = guild.channels.cache.get(cfg.logs?.[kind]);
  if (!meta || !channel) return;
  const who = typeof mod === 'string' ? mod : `<@${mod.id}>`;
  const lines = [
    `${I.user} **العضو :** <@${target.id}> \`${target.id}\``,
    `${I.admin} **المشرف :** ${who}`,
  ];
  if (minutes) lines.push(`${I.timeout} **المدة :** ${minutes} دقيقة`);
  lines.push(`${I.report} **السبب :** ${reason || NO_REASON}`);
  channel.send({ content: simple(lines.join('\n'), meta.color, `${meta.icon} ${meta.label}`), allowedMentions: { parse: [] } }).catch(() => null);
}

// ── timed punishments (vmute / tmute / jail / timeout) ────────────────
const MAX_TIMEOUT_MIN = 28 * 24 * 60; // Discord cap for native timeout
const PUNISH = {
  vmute: { label: 'ميوت صوتي', level: 1 },
  tmute: { label: 'اسكات كتابي', level: 1 },
  jail: { label: 'سجن', level: 2 },
  timeout: { label: 'تايم أوت', level: 2 },
};

function jailStrip(guild, member, modId, reason) {
  const kept = member.roles.cache
    .filter((r) => r.id !== guild.id && !r.managed && r.position < guild.members.me.roles.highest.position)
    .map((r) => r.id);
  data.jailSave(guild.id, member.id, kept, modId, reason);
  const keepManaged = member.roles.cache.filter((r) => r.managed || r.position >= guild.members.me.roles.highest.position).map((r) => r.id);
  return member.roles.set([...keepManaged, store.get(guild.id, ID).jailRole], `سجن by ${modId}`);
}

async function unjailMember(guild, cfg, member) {
  const snap = data.jailGet(guild.id, member.id);
  const restore = (snap?.roles || []).filter((id) => {
    const r = guild.roles.cache.get(id);
    return r && !r.managed && r.position < guild.members.me.roles.highest.position;
  });
  const keepManaged = member.roles.cache.filter((r) => r.managed).map((r) => r.id);
  await member.roles.set([...new Set([...restore, ...keepManaged])], 'عفو');
  data.jailClear(guild.id, member.id);
  data.punishClear(guild.id, member.id, 'jail');
}

// Apply a timed punishment. Returns a summary string, or throws a user message.
async function applyPunish(guild, cfg, type, target, mod, minutes, reason) {
  const me = guild.members.me;
  const until = minutes > 0 ? Date.now() + minutes * 60_000 : 0;
  reason = reason || NO_REASON;
  if (type === 'vmute') {
    if (!target.voice.channel) throw new Error('العضو لازم يكون داخل روم صوتي.');
    await target.voice.setMute(true, `${mod.tag}: ${reason}`);
    data.punishSet(guild.id, target.id, 'vmute', until, mod.id, reason);
  } else if (type === 'tmute') {
    const p = roleUsableRaw(guild, cfg.muteRole, 'الاسكات'); if (p) throw new Error(p);
    await target.roles.add(cfg.muteRole, `${mod.tag}: ${reason}`);
    data.punishSet(guild.id, target.id, 'tmute', until, mod.id, reason);
  } else if (type === 'jail') {
    const p = roleUsableRaw(guild, cfg.jailRole, 'السجن'); if (p) throw new Error(p);
    await jailStrip(guild, target, mod.id, reason);
    data.punishSet(guild.id, target.id, 'jail', until, mod.id, reason);
  } else if (type === 'timeout') {
    if (!minutes || minutes > MAX_TIMEOUT_MIN) throw new Error('حدد مدة صحيحة (أقصى 28 يوم).');
    await target.timeout(minutes * 60_000, `${mod.tag}: ${reason}`);
    cases.create(guild, { action: 'timeout', userId: target.id, modId: mod.id, reason, duration: minutes * 60_000 });
  }
  logAction(guild, cfg, type, { target, mod, minutes, reason });
  await dm(target.user, guild, `${LOGS[type].icon} ${PUNISH[type].label} في **${guild.name}**${minutes ? ` لمدة ${minutes} دقيقة` : ''}\nالسبب: ${reason}`);
  return `تم ${PUNISH[type].label} على ${target}${minutes ? ` — ${minutes} دقيقة` : ''}`;
}

function roleUsableRaw(guild, roleId, label) {
  if (!roleId) return `ما فيه رتبة ${label} محددة — عيّنها من لوحة التحكم.`;
  const role = guild.roles.cache.get(roleId);
  if (!role) return `رتبة ${label} محذوفة — عدّلها من لوحة التحكم.`;
  if (role.position >= guild.members.me.roles.highest.position) return `ارفع رتبة البوت فوق رتبة ${label}.`;
  return null;
}

// Deny writing everywhere for the mute role. Tickets still work because each
// ticket grants its owner a member-level SendMessages allow (overrides this).
const MUTE_DENY = {
  SendMessages: false, SendMessagesInThreads: false,
  CreatePublicThreads: false, CreatePrivateThreads: false, AddReactions: false,
};
async function applyMuteOverwrites(guild, roleId) {
  if (!roleId) return { error: 'ما فيه رتبة اسكات محددة — عيّنها من لوحة التحكم.' };
  if (!guild.roles.cache.get(roleId)) return { error: 'رتبة الاسكات محذوفة — عدّلها من لوحة التحكم.' };
  let count = 0;
  for (const channel of guild.channels.cache.values()) {
    if (!channel.permissionOverwrites || !channel.manageable) continue;
    try { await channel.permissionOverwrites.edit(roleId, MUTE_DENY, { reason: 'Sword: تجهيز الاسكات' }); count += 1; } catch { /* skip */ }
  }
  return { count };
}

// Reason/duration picker shown when a punishment is typed without a duration.
async function sendPicker(ctx, type, target) {
  const presets = (ctx.cfg.presets || []).slice(0, 23);
  const options = presets.map((p, i) => ({
    label: p.label.slice(0, 100),
    description: p.minutes ? `${p.minutes} دقيقة` : (type === 'jail' ? 'حتى العفو' : 'دائم'),
    value: String(i),
  }));
  options.push({ label: 'سبب ومدة يدوية', description: 'اكتبها بنفسك', value: 'custom' });
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`staff:pick:${type}:${target.id}:${ctx.author.id}`)
    .setPlaceholder('اختر السبب والمدة')
    .addOptions(options);
  await ctx.message.reply({
    content: `**${PUNISH[type].label}** لـ ${target}\nاختر السبب والمدة`,
    components: [new ActionRowBuilder().addComponents(menu)],
    allowedMentions: { parse: [], repliedUser: false },
  }).catch(() => null);
}

// Shared entry for mute/skat/jail/timeout: inline args → apply, else → picker.
function punishCmd(names, type, opts = {}) {
  return {
    names, symbol: opts.symbol, word: opts.word,
    level: PUNISH[type].level, desc: `${PUNISH[type].label} (يطلع لك اختيار السبب والمدة)`,
    async run(ctx) {
      const t = await ctx.target();
      const problem = guard(ctx, t, PUNISH[type].label);
      if (problem) return err(problem);
      // Inline duration like "ميوت @عضو 1h سبام" → apply directly.
      const tok = ctx.words[1];
      const ms = tok ? parseDuration(/^\d+$/.test(tok) ? `${tok}m` : tok) : null;
      if (ms) {
        try {
          const text = await applyPunish(ctx.guild, ctx.cfg, type, t, ctx.author, Math.round(ms / 60_000), ctx.reasonFrom(2));
          return ok(text);
        } catch (e) { return err(e.message); }
      }
      await sendPicker(ctx, type, t);
      return { noReact: true };
    },
  };
}

// ── commands ─────────────────────────────────────────────────────────
// Each: { names:[...], symbol?, word?, level, wipe?, desc, run(ctx) }
// run returns: undefined (✅) · err('..') (❌ + notice) · ok('..') (✅ + note)
//            · { reply, noReact } (sends its own message, no reaction)
const COMMANDS = [
  // ── level 1: text/voice mute (timed, with reason picker) ────────────
  punishCmd(['اسكات', 'سكات', 'skat', 'mute-text'], 'tmute'),
  {
    names: ['تكلم', 'فك-اسكات', 'unskat'], level: 1, desc: 'فك الاسكات الكتابي',
    async run(ctx) {
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه.');
      if (!ctx.cfg.muteRole || !t.roles.cache.has(ctx.cfg.muteRole)) return err('العضو مو مسكّت.');
      await t.roles.remove(ctx.cfg.muteRole, `تكلم by ${ctx.author.tag}`);
      data.punishClear(ctx.guild.id, t.id, 'tmute');
      return ok(`تم فك الاسكات عن ${t}`);
    },
  },
  punishCmd(['ميوت', 'mute'], 'vmute'),
  {
    names: ['فك', 'unmute'], level: 1, desc: 'فك الميوت الصوتي',
    async run(ctx) {
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه.');
      if (!t.voice.channel) return err('العضو مو داخل روم صوتي.');
      if (!t.voice.serverMute) return err('العضو مو مميوت.');
      await t.voice.setMute(false, `فك by ${ctx.author.tag}`);
      data.punishClear(ctx.guild.id, t.id, 'vmute');
      return ok(`تم فك الميوت عن ${t}`);
    },
  },
  punishCmd(['تايم', 'تايماوت', 'timeout', 'to'], 'timeout'),
  {
    names: ['تجهيز-الاسكات', 'تجهيز', 'setup-mute'], level: 3, desc: 'يمنع رتبة الاسكات من الكتابة في كل الرومات (التذاكر تظل مسموحة)',
    async run(ctx) {
      const res = await applyMuteOverwrites(ctx.guild, ctx.cfg.muteRole);
      if (res.error) return err(res.error);
      return ok(`تم تجهيز الاسكات على \`${res.count}\` روم — المسكّت ما يكتب إلا في تذكرته.`);
    },
  },
  {
    symbol: '-', word: 'وقت', level: 3, desc: 'تحديد وقت انتظار لوبي الألعاب — -وقت 5m',
    async run(ctx) {
      const tok = ctx.words[0];
      if (!tok) return err('حدد المدة. مثال: `-وقت 5m` أو `-وقت 30s`');
      const ms = parseDuration(/^\d+$/.test(tok) ? `${tok}m` : tok);
      if (!ms) return err('مدة غير صحيحة. مثال: `-وقت 5m` أو `-وقت 30s`');
      const secs = Math.max(10, Math.min(3600, Math.round(ms / 1000)));
      store.update(ctx.guild.id, 'games', (c) => { c.lobbyTime = secs; });
      return ok(`صار وقت انتظار الألعاب \`${secs}\` ثانية`);
    },
  },

  // ── level 2: jail ──────────────────────────────────────────────────
  punishCmd([], 'jail', { symbol: '-', word: 'سجن' }),
  {
    names: ['عفو', 'unjail'], level: 2, desc: 'فك السجن وإرجاع الرتب',
    async run(ctx) {
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه.');
      const snap = data.jailGet(ctx.guild.id, t.id);
      if (!snap && !t.roles.cache.has(ctx.cfg.jailRole)) return err('العضو مو مسجون.');
      await unjailMember(ctx.guild, ctx.cfg, t);
      return ok(`تم فك السجن عن ${t}`);
    },
  },

  // ── level 3: server punishments ────────────────────────────────────
  {
    symbol: '-', word: 'باند', level: 3, wipe: true, desc: 'باند العضو ومنعه من دخول السيرفر (-باند)',
    async run(ctx) {
      const member = await ctx.target();
      const user = member?.user || (await ctx.userTarget());
      if (!user) return err('منشن العضو أو حط آيديه.');
      if (member) { const p = guard(ctx, member, 'باند'); if (p) return err(p); }
      if (await ctx.guild.bans.fetch(user.id).catch(() => null)) return err('العضو مبند أصلاً.');
      const reason = ctx.reasonFrom(1);
      if (member) await dm(user, ctx.guild, `${I.ban} تم باندك من **${ctx.guild.name}**\nالسبب: ${reason || NO_REASON}`);
      await ctx.guild.members.ban(user.id, { reason: `${ctx.author.tag}: ${reason || NO_REASON}` });
      cases.create(ctx.guild, { action: 'ban', userId: user.id, modId: ctx.author.id, reason });
      logAction(ctx.guild, ctx.cfg, 'ban', { target: user, mod: ctx.author, reason });
      return ok(`تم باند ${user.tag}`);
    },
  },
  {
    names: ['فك-باند', 'unban'], level: 3, desc: 'فك الباند عن عضو بالآيدي',
    async run(ctx) {
      const id = mentionId(ctx.words[0]);
      if (!id) return err('حط آيدي العضو.');
      const ban = await ctx.guild.bans.fetch(id).catch(() => null);
      if (!ban) return err('العضو مو مبند.');
      await ctx.guild.members.unban(id, `فك باند by ${ctx.author.tag}`);
      cases.create(ctx.guild, { action: 'unban', userId: id, modId: ctx.author.id, reason: ctx.reasonFrom(1) });
      return ok(`تم فك الباند عن ${ban.user.tag}`);
    },
  },
  {
    symbol: '!', word: 'طرد', level: 3, desc: 'طرد العضو من السيرفر',
    async run(ctx) {
      const t = await ctx.target();
      const problem = guard(ctx, t, 'طرد');
      if (problem) return err(problem);
      const reason = ctx.reasonFrom(1);
      await dm(t.user, ctx.guild, `${I.kick} تم طردك من **${ctx.guild.name}**\nالسبب: ${reason || NO_REASON}`);
      await t.kick(`${ctx.author.tag}: ${reason || NO_REASON}`);
      cases.create(ctx.guild, { action: 'kick', userId: t.id, modId: ctx.author.id, reason });
      return ok(`تم طرد ${t.user.tag}`);
    },
  },
  {
    names: ['دسك', 'disconnect'], level: 3, desc: 'طرد العضو من الروم الصوتي',
    async run(ctx) {
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه.');
      if (!t.voice.channel) return err('العضو مو داخل روم صوتي.');
      await t.voice.disconnect(`دسك by ${ctx.author.tag}`);
      return ok(`تم طرد ${t} من الروم`);
    },
  },

  // ── blacklist ──────────────────────────────────────────────────────
  {
    symbol: '-', word: 'بلاك', level: 3, wipe: true, desc: 'بلاك لست إضافة/إزالة (-بلاك)',
    async run(ctx) {
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه.');
      const problem = roleUsable(ctx, ctx.cfg.blacklistRole, 'البلاك');
      if (problem) return err(problem);
      if (data.blGet(ctx.guild.id, t.id)) {
        await t.roles.remove(ctx.cfg.blacklistRole, `شيل بلاك by ${ctx.author.tag}`).catch(() => null);
        data.blRemove(ctx.guild.id, t.id);
        return ok(`تم شيل ${t} من البلاك`);
      }
      const p = guard(ctx, t, 'بلاك');
      if (p) return err(p);
      await t.roles.add(ctx.cfg.blacklistRole, `بلاك by ${ctx.author.tag}`);
      data.blAdd(ctx.guild.id, t.id, ctx.author.id, ctx.reasonFrom(1));
      logAction(ctx.guild, ctx.cfg, 'block', { target: t, mod: ctx.author, reason: ctx.reasonFrom(1) });
      return ok(`تم حط ${t} في البلاك`);
    },
  },
  {
    symbol: '#', word: 'سطف', level: 3, desc: 'يسمّي العضو «سطيف» ويعطيه ميوت صوتي (أو يفكه بإعادة الأمر) — منشن/آيدي/ريبلاي',
    async run(ctx) {
      let t = await ctx.target();
      if (!t && ctx.message.reference?.messageId) {
        const ref = await ctx.channel.messages.fetch(ctx.message.reference.messageId).catch(() => null);
        if (ref) t = await ctx.guild.members.fetch(ref.author.id).catch(() => null);
      }
      if (!t) return err('منشن العضو أو رد على رسالته أو حط آيديه.');
      const rec = data.stuffGet(ctx.guild.id, t.id);
      if (rec) {
        // release — clear the record FIRST so the auto-reapply doesn't fight it
        data.stuffClear(ctx.guild.id, t.id);
        if (t.voice?.channel) await t.voice.setMute(false, `فك سطف by ${ctx.author.tag}`).catch(() => null);
        await t.setNickname(rec.old_nick || null, `فك سطف by ${ctx.author.tag}`).catch(() => null);
        return ok(`تم فك السطف عن ${t}`);
      }
      const problem = guard(ctx, t, 'سطف');
      if (problem) return err(problem);
      data.stuffSet(ctx.guild.id, t.id, t.nickname || '', ctx.author.id);
      await t.setNickname('سطيف', `سطف by ${ctx.author.tag}`).catch(() => null);
      let muted = false;
      if (t.voice?.channel) muted = await t.voice.setMute(true, `سطف by ${ctx.author.tag}`).then(() => true).catch(() => false);
      return ok(muted
        ? `تم سطف ${t} — اسمه «سطيف» ومميوت صوتي`
        : `تم سطف ${t} — اسمه «سطيف»، والميوت الصوتي بينطبق أول ما يدخل روم صوتي`);
    },
  },

  // ── channel control ────────────────────────────────────────────────
  {
    names: ['قفل', 'lock'], level: 3, desc: 'قفل الروم عن الكتابة',
    run: (ctx) => channelPerm(ctx, { SendMessages: false }, `${I.lock} تم قفل`),
  },
  {
    names: ['فتح', 'unlock'], level: 3, desc: 'فتح الروم للكتابة',
    run: (ctx) => channelPerm(ctx, { SendMessages: null }, `${I.unlock} تم فتح`),
  },
  {
    names: ['اخفاء', 'إخفاء', 'hide'], level: 3, desc: 'إخفاء الروم',
    run: (ctx) => channelPerm(ctx, { ViewChannel: false }, `${I.hide} تم إخفاء`),
  },
  {
    names: ['اظهار', 'إظهار', 'show'], level: 3, desc: 'إظهار الروم',
    run: (ctx) => channelPerm(ctx, { ViewChannel: null }, `${I.show} تم إظهار`),
  },
  {
    names: ['مسح', 'clear', 'purge'], level: 3,
    desc: 'حذف الرسائل — `مسح <عدد>` أو `مسح @عضو` (كل رسائله) أو `مسح @عضو <عدد>`',
    async run(ctx) {
      // optional user filter (mention/id) + optional count
      const uid = mentionId(ctx.words[0]) ? mentionId(ctx.words[0]) : null;
      let count = parseInt(uid ? ctx.words[1] : ctx.words[0], 10);
      if (uid && (!count || count < 1)) count = 1000; // "all" from this user (capped)
      if (!uid && (!count || count < 1)) return err('حط عدد أو منشن. مثال: `مسح 20` أو `مسح @عضو`');
      count = Math.min(count, 1000);

      await ctx.message.delete().catch(() => null);
      const FRESH = 14 * 24 * 60 * 60 * 1000;
      let remaining = count; let deleted = 0; let scanned = 0; let before;
      while (remaining > 0 && scanned < 3000) {
        const batch = await ctx.channel.messages.fetch({ limit: 100, before }).catch(() => null);
        if (!batch || !batch.size) break;
        before = batch.last().id;
        scanned += batch.size;
        let msgs = [...batch.values()];
        if (uid) msgs = msgs.filter((m) => m.author.id === uid);
        msgs = msgs.filter((m) => Date.now() - m.createdTimestamp < FRESH).slice(0, remaining);
        if (msgs.length) {
          const res = await ctx.channel.bulkDelete(msgs, true).catch(() => null);
          const d = res ? res.size : 0;
          deleted += d;
          remaining -= d;
        }
        if (batch.size < 100) break;
      }
      const note = await ctx.channel.send({
        content: `تم مسح **${deleted}** رسالة${uid ? ` من <@${uid}>` : ''}.`,
        allowedMentions: { parse: [] },
      }).catch(() => null);
      if (note) setTimeout(() => note.delete().catch(() => null), 5000);
      return { noReact: true };
    },
  },

  // ── voice moving ───────────────────────────────────────────────────
  {
    names: ['سحب', 'pull'], level: 3, desc: 'سحب العضو لرومك الصوتي',
    async run(ctx) {
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه.');
      if (!ctx.member.voice.channel) return err('لازم تكون داخل روم صوتي.');
      if (!t.voice.channel) return err('العضو مو داخل روم صوتي.');
      await t.voice.setChannel(ctx.member.voice.channel, `سحب by ${ctx.author.tag}`);
      return ok(`تم سحب ${t}`);
    },
  },
  {
    names: ['ودني', 'goto'], level: 3, desc: 'نقلك لروم العضو',
    async run(ctx) {
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه.');
      if (!t.voice.channel) return err('العضو مو داخل روم صوتي.');
      await ctx.member.voice.setChannel(t.voice.channel, `ودني by ${ctx.author.tag}`).catch(() => null);
      if (!ctx.member.voice.channel) return err('لازم تكون داخل روم صوتي عشان أنقلك.');
      return ok(`ودّيناك لروم ${t}`);
    },
  },

  // ── permission grants (toggle a role) ──────────────────────────────
  grantCmd(['لايف', 'live'], 'liveRole', 'اللايف', 'صلاحية فتح كام وبث'),
  grantCmd(['صور', 'images'], 'imageRole', 'الصور', 'صلاحية إرسال الصور'),
  grantCmd(['هير', 'here'], 'hereRole', 'الهير', 'صلاحية منشن @here'),
  grantCmd(['ساوند', 'soundboard'], 'soundRole', 'الساوند', 'صلاحية الساوندبورد'),
  {
    names: ['role'], level: 3, desc: 'إعطاء/سحب رتبة — role <عضو> <منشن أو آيدي أو اسم الرتبة>',
    async run(ctx) {
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه. مثال: `role @عضو الرتبة`');
      const role = resolveRole(ctx.guild, ctx.reasonFrom(1));
      if (!role) return err('ما لقيت الرتبة — منشن أو آيدي أو اسمها الصحيح.');
      if (role.managed || role.id === ctx.guild.id) return err(`الرتبة \`${role.name}\` (\`${role.id}\`) ما تنعطى يدوياً — مُدارة ببوت/خدمة/بوست أو @everyone. استخدم منشن الرتبة الصحيحة \`@الرتبة\`.`);
      if (role.position >= ctx.me.roles.highest.position) return err('ارفع رتبة البوت فوق هالرتبة.');
      if (ctx.member.id !== ctx.guild.ownerId && role.position >= ctx.member.roles.highest.position) return err('الرتبة أعلى منك أو مساوية لك.');
      const protectedRoles = ctx.cfg.roleGuard?.protected?.length ? ctx.cfg.roleGuard.protected : ctx.cfg.roles.admin;
      if (protectedRoles.includes(role.id) && ctx.member.id !== ctx.guild.ownerId) {
        const guardian = (ctx.cfg.roleGuard?.guardians || []).some((id) => ctx.member.roles.cache.has(id));
        if (!guardian) return err('هذي رتبة محمية — بس المخوّلين (أو المالك) يقدرون يعطونها.');
      }
      if (t.roles.cache.has(role.id)) {
        await t.roles.remove(role, `رول by ${ctx.author.tag}`);
        return ok(`تم سحب ${role} من ${t}`);
      }
      await t.roles.add(role, `رول by ${ctx.author.tag}`);
      return ok(`تم إعطاء ${role} لـ ${t}`);
    },
  },
  {
    names: ['نك', 'nick', 'لقب'], level: 3, desc: 'تغيير لقب العضو',
    async run(ctx) {
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه.');
      if (t.id !== ctx.member.id) { const p = guard(ctx, t, 'تغيير اللقب'); if (p) return err(p); }
      if (t.roles.highest.position >= ctx.me.roles.highest.position) return err('رتبة العضو أعلى من رتبتي.');
      const nick = ctx.reasonFrom(1);
      await t.setNickname(nick || null, `by ${ctx.author.tag}`);
      return ok(nick ? `تم تغيير لقب ${t} إلى **${nick}**` : `تم إرجاع لقب ${t}`);
    },
  },

  // ── warnings & records ─────────────────────────────────────────────
  {
    names: ['تحذير', 'warn'], level: 3, desc: 'إرسال تحذير للعضو على الخاص',
    async run(ctx) {
      const t = await ctx.target();
      const problem = guard(ctx, t, 'تحذير');
      if (problem) return err(problem);
      const reason = ctx.reasonFrom(1);
      if (!reason) return err('اكتب سبب التحذير. مثال: `تحذير @عضو سبام`');
      await dm(t.user, ctx.guild, `${I.warn} عندك تحذير في **${ctx.guild.name}**\nالسبب: ${reason}`);
      cases.create(ctx.guild, { action: 'warn', userId: t.id, modId: ctx.author.id, reason });
      logAction(ctx.guild, ctx.cfg, 'warn', { target: t, mod: ctx.author, reason });
      const total = cases.forUser(ctx.guild.id, t.id, 'warn').length;
      return ok(`تم تحذير ${t} — مجموع تحذيراته \`${total}\``);
    },
  },
  {
    names: ['عقوبات', 'سجل'], level: 1, desc: 'عرض عقوبات العضو',
    async run(ctx) {
      const t = (await ctx.target()) || ctx.member;
      const warns = cases.forUser(ctx.guild.id, t.id, 'warn').length;
      const lines = [
        `${I.user} **العضو:** ${t}`,
        `${I.warn} **التحذيرات:** \`${warns}\``,
        `${I.silence} **اسكات:** ${ctx.cfg.muteRole && t.roles.cache.has(ctx.cfg.muteRole) ? 'مسكّت' : '—'}`,
        `${I.muted} **ميوت صوتي:** ${t.voice?.serverMute ? 'مميوت' : '—'}`,
        `${I.lock} **السجن:** ${ctx.cfg.jailRole && t.roles.cache.has(ctx.cfg.jailRole) ? 'مسجون' : '—'}`,
        `${I.forbid} **البلاك:** ${data.blGet(ctx.guild.id, t.id) ? 'في البلاك' : '—'}`,
      ];
      return statusEmbed(`${I.history} عقوبات ${t.user.username}`, lines);
    },
  },
  {
    names: ['ميوتي'], level: 1, desc: 'حالة الميوت الصوتي للعضو',
    async run(ctx) {
      const t = (await ctx.target()) || ctx.member;
      return statusEmbed(`${I.muted} ميوت ${t.user.username}`, [t.voice?.serverMute ? `${t} مميوت صوتياً.` : `${t} مو مميوت.`]);
    },
  },
  {
    names: ['اسكاتي'], level: 1, desc: 'حالة الاسكات الكتابي للعضو',
    async run(ctx) {
      const t = (await ctx.target()) || ctx.member;
      const muted = ctx.cfg.muteRole && t.roles.cache.has(ctx.cfg.muteRole);
      return statusEmbed(`${I.silence} اسكات ${t.user.username}`, [muted ? `${t} مسكّت كتابياً.` : `${t} مو مسكّت.`]);
    },
  },
  {
    names: ['سجني'], level: 1, desc: 'حالة سجن العضو',
    async run(ctx) {
      const t = (await ctx.target()) || ctx.member;
      const jailed = ctx.cfg.jailRole && t.roles.cache.has(ctx.cfg.jailRole);
      const snap = data.jailGet(ctx.guild.id, t.id);
      const lines = [jailed ? `${t} مسجون.` : `${t} مو مسجون.`];
      if (snap) lines.push(`السبب: ${snap.reason || NO_REASON}`, `بواسطة: <@${snap.jailed_by}> • ${ts(snap.at)}`);
      return statusEmbed(`${I.lock} سجن ${t.user.username}`, lines);
    },
  },

  // ── tickets ────────────────────────────────────────────────────────
  {
    names: ['اضافه', 'إضافة', 'add'], level: 3, desc: 'إضافة عضو للتذكرة',
    async run(ctx) {
      if (!isTicket(ctx)) return err('هذا الأمر يشتغل داخل تذكرة فقط.');
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه.');
      await ctx.channel.permissionOverwrites.edit(t.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
      return ok(`تمت إضافة ${t} للتذكرة`);
    },
  },
  {
    names: ['ازاله', 'إزالة'], level: 3, desc: 'إزالة عضو من التذكرة',
    async run(ctx) {
      if (!isTicket(ctx)) return err('هذا الأمر يشتغل داخل تذكرة فقط.');
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه.');
      await ctx.channel.permissionOverwrites.delete(t.id, `ازاله by ${ctx.author.tag}`).catch(() => null);
      return ok(`تمت إزالة ${t} من التذكرة`);
    },
  },
  {
    names: ['اقفال', 'إغلاق'], level: 3, desc: 'إغلاق التذكرة',
    async run(ctx) {
      const row = ticketRow(ctx);
      if (!row) return err('هذا الأمر يشتغل داخل تذكرة فقط.');
      require('../../core/db').prepare("UPDATE tickets SET status='closed', closed_at=? WHERE channel_id=?").run(Date.now(), ctx.channel.id);
      await ctx.channel.permissionOverwrites.edit(row.owner_id, { SendMessages: false }).catch(() => null);
      await ctx.channel.send({ content: simple(`${I.lock} تم إغلاق التذكرة بواسطة ${ctx.member}`, 'accent') }).catch(() => null);
      return { noReact: true };
    },
  },
  {
    symbol: '#', word: 'طرد', level: 3, desc: 'طرد العضو من التذكرة وإقفال الروم عنه',
    async run(ctx) {
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه.');
      await ctx.channel.permissionOverwrites.edit(t.id, { ViewChannel: false }, { reason: `#طرد by ${ctx.author.tag}` });
      return ok(`تم طرد ${t} من الروم`);
    },
  },
  {
    names: ['tblock'], level: 3, desc: 'منع العضو من فتح التذاكر (أو فكه)',
    async run(ctx) {
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه.');
      if (data.tblocked(ctx.guild.id, t.id)) { data.tunblock(ctx.guild.id, t.id); return ok(`تم فك منع التذاكر عن ${t}`); }
      data.tblock(ctx.guild.id, t.id, ctx.author.id);
      return ok(`تم منع ${t} من فتح التذاكر`);
    },
  },
  {
    symbol: '-', word: 'تذكير', level: 3, desc: 'تذكير العضو بمراجعة التذكرة',
    async run(ctx) {
      const row = ticketRow(ctx);
      const t = (await ctx.target()) || (row && await ctx.guild.members.fetch(row.owner_id).catch(() => null));
      if (!t) return err('منشن العضو أو استخدمه داخل تذكرة.');
      await ctx.channel.send({ content: `${t}\n${I.mail} تذكير: الرجاء مراجعة التذكرة والرد ${I.sword}` }).catch(() => null);
      return { noReact: true };
    },
  },

  // ── utility / info (everyone) ──────────────────────────────────────
  {
    names: ['رابط', 'invite'], level: 1, desc: 'سحب رابط دعوة',
    async run(ctx) {
      const inv = await ctx.channel.createInvite({ maxAge: 0, unique: true, reason: `رابط by ${ctx.author.tag}` }).catch(() => null);
      if (!inv) return err('ما قدرت أسوي رابط (صلاحية Create Invite؟).');
      return statusEmbed(`${I.link} رابط الدعوة`, [`https://discord.gg/${inv.code}`]);
    },
  },
  {
    names: ['دعواتي', 'invites'], level: 0, desc: 'عدد دعواتك',
    async run(ctx) {
      const t = (await ctx.target()) || ctx.member;
      return statusEmbed(`${I.users} دعوات ${t.user.username}`, [`عدد الدعوات: \`${data.inviteCount(ctx.guild.id, t.id)}\``]);
    },
  },
  {
    names: ['انفايتات', 'توب-دعوات', 'invitestop'], level: 0, desc: 'توب الدعوات',
    async run(ctx) {
      const top = data.inviteTop(ctx.guild.id, 10);
      if (!top.length) return statusEmbed(`${I.users} توب الدعوات`, ['ما فيه دعوات مسجّلة بعد.']);
      const medal = ['🥇', '🥈', '🥉'];
      const lines = top.map((r, i) => `${medal[i] || `**${i + 1}.**`} <@${r.user_id}> — \`${r.invites}\` دعوة`);
      return statusEmbed(`${I.users} توب الدعوات`, lines);
    },
  },
  {
    names: ['افتار', 'avatar', 'av'], level: 0, desc: 'عرض أفتار العضو',
    async run(ctx) {
      const u = (await ctx.userTarget()) || ctx.author;
      const av = u.displayAvatarURL({ size: 1024, forceStatic: false });
      return { reply: { content: `**${I.user} أفتار ${u.username}**`, files: [new AttachmentBuilder(av)], allowedMentions: { parse: [] } }, noReact: true };
    },
  },
  {
    names: ['بانر', 'banner'], level: 0, desc: 'عرض بانر العضو',
    async run(ctx) {
      const u = await (await ctx.userTarget() || ctx.author).fetch(true).catch(() => null);
      const url = u?.bannerURL?.({ size: 1024, forceStatic: false });
      if (!url) return err('العضو ما عنده بانر.');
      return { reply: { content: `**${I.image} بانر ${u.username}**`, files: [new AttachmentBuilder(url)], allowedMentions: { parse: [] } }, noReact: true };
    },
  },
];

// Toggle-role grant command factory (لايف/صور/هير/ساوند).
function grantCmd(names, cfgKey, label, desc) {
  return {
    names, level: 3, desc,
    async run(ctx) {
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه.');
      const problem = roleUsable(ctx, ctx.cfg[cfgKey], label);
      if (problem) return err(problem);
      if (t.roles.cache.has(ctx.cfg[cfgKey])) {
        await t.roles.remove(ctx.cfg[cfgKey], `${label} by ${ctx.author.tag}`);
        return ok(`تم سحب ${label} من ${t}`);
      }
      await t.roles.add(ctx.cfg[cfgKey], `${label} by ${ctx.author.tag}`);
      return ok(`تم إعطاء ${desc} لـ ${t}`);
    },
  };
}

async function channelPerm(ctx, perms, done) {
  const channel = ctx.channelArg(0);
  await channel.permissionOverwrites.edit(ctx.guild.roles.everyone, perms, { reason: `by ${ctx.author.tag}` });
  return ok(`${done} ${channel}`);
}

const ticketRow = (ctx) => require('../../core/db').prepare("SELECT * FROM tickets WHERE channel_id=? AND status='open'").get(ctx.channel.id);
const isTicket = (ctx) => !!ticketRow(ctx);

// ── dispatch tables ──────────────────────────────────────────────────
const normalMap = new Map(); // normalize(name) -> command
const symbolMap = new Map(); // "#بلاك" -> command
for (const cmd of COMMANDS) {
  if (cmd.symbol) symbolMap.set(cmd.symbol + normalize(cmd.word), cmd);
  for (const n of cmd.names || []) normalMap.set(normalize(n), cmd);
}
// Words the core prefix handler must hand over to this plugin.
const OWNED = new Set([...normalMap.keys(), normalize('طرد'), normalize('بلاك'), normalize('تذكير'), normalize('باند'), normalize('سجن'), normalize('وقت'), normalize('سطف')]);

// ── message engine ───────────────────────────────────────────────────
function recognise(message) {
  const client = message.client;
  let content = message.content.trim();
  let intentful = false;
  const mention = content.match(new RegExp(`^<@!?${client.user.id}>\\s*`));
  if (mention) { content = content.slice(mention[0].length).trim(); intentful = true; }
  if (!content) return null;

  // symbol commands first (#بلاك · #طرد · !طرد · -تذكير)
  if ('#-!'.includes(content[0])) {
    const m = content.match(/^(\S+)\s*([\s\S]*)$/);
    const cmd = symbolMap.get(content[0] + normalize(m[1].slice(1)));
    if (cmd) return { cmd, args: m[2], intentful: true };
  }

  // normal commands, optional server prefix
  let body = content;
  const pfx = store.get(message.guildId, 'core').prefix;
  if (pfx && body.startsWith(pfx)) { body = body.slice(pfx.length).trim(); intentful = true; }
  const m = body.match(/^(\S+)\s*([\s\S]*)$/);
  if (!m) return null;
  const cmd = normalMap.get(normalize(m[1]));
  if (!cmd) return null;
  return { cmd, args: m[2], intentful };
}

async function react(message, good, cfg) {
  await message.react(good ? cfg.okEmoji : cfg.noEmoji).catch(() => null);
}

// Show the warning in the channel with the ❌ reaction, then auto-delete it and
// the command after a delay so nothing lingers. noticeDelay = 0 keeps them.
async function notice(message, text, cfg) {
  const delay = cfg?.noticeDelay ?? 6000;
  const m = await message.reply({ content: simple(text, 'error'), allowedMentions: { repliedUser: false } }).catch(() => null);
  if (delay > 0) setTimeout(() => { m?.delete().catch(() => null); message.delete().catch(() => null); }, delay);
}

async function onMessage(message) {
  if (!message.inGuild() || message.author.bot || !message.member || !message.content) return;
  const found = recognise(message);
  if (!found) return;
  const { cmd, args, intentful } = found;

  const level = levelOf(message.member);
  if (level < cmd.level) {
    if (!intentful && level === 0) return; // random chatter typing a word — ignore
    const cfg = store.get(message.guildId, ID);
    await react(message, false, cfg);
    await notice(message, 'ما عندك صلاحية لهذا الأمر.', cfg);
    return;
  }

  const cfg = store.get(message.guildId, ID);
  // Reply support: "اسكات/سجن/…" as a reply on someone's message targets its author.
  // Only when no explicit mention/id is already given (so inline targets still win).
  let finalArgs = args;
  if (message.reference?.messageId && !mentionId((args.trim().split(/\s+/)[0] || ''))) {
    const ref = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (ref?.author?.id) finalArgs = `<@${ref.author.id}> ${args}`.trim();
  }
  message._staffArgs = finalArgs;
  message._staffLevel = level;
  try {
    const res = await cmd.run(makeCtx(message, cfg));
    if (res?.error) { await react(message, false, cfg); await notice(message, res.error, cfg); return; }
    if (res?.reply) await message.reply({ ...res.reply, allowedMentions: res.reply.allowedMentions || { repliedUser: false } }).catch(() => null);
    if (res?.noReact) return;
    await react(message, true, cfg);
    if (cmd.wipe) setTimeout(() => message.delete().catch(() => null), cfg.wipeDelay);
  } catch (e) {
    logger.error('[staff] command:', e);
    await react(message, false, cfg);
    await notice(message, 'صار خطأ غير متوقع، حاول مرة ثانية.', cfg);
  }
}

// ── invite tracking ──────────────────────────────────────────────────
const inviteCache = new Map(); // guildId -> Map(code -> uses)

async function cacheGuild(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return;
  inviteCache.set(guild.id, new Map(invites.map((i) => [i.code, i.uses || 0])));
}

async function onMemberAdd(member) {
  const before = inviteCache.get(member.guild.id) || new Map();
  const after = await member.guild.invites.fetch().catch(() => null);
  if (after) {
    const used = after.find((i) => (i.uses || 0) > (before.get(i.code) || 0));
    inviteCache.set(member.guild.id, new Map(after.map((i) => [i.code, i.uses || 0])));
    if (used?.inviter && !used.inviter.bot) data.inviteAdd(member.guild.id, used.inviter.id, 1);
  }
}

// ── picker interactions ──────────────────────────────────────────────
async function onPick(interaction, [type, targetId, invokerId]) {
  if (interaction.user.id !== invokerId) {
    return interaction.reply({ content: simple('هذا الاختيار مو لك.', 'error'), flags: MessageFlags.Ephemeral });
  }
  if (interaction.values[0] === 'custom') {
    const modal = new ModalBuilder().setCustomId(`staff:pmodal:${type}:${targetId}:${invokerId}`).setTitle(PUNISH[type]?.label || 'عقوبة');
    const dur = new TextInputBuilder().setCustomId('dur')
      .setLabel(type === 'timeout' ? 'المدة' : 'المدة (فاضي = دائم)')
      .setPlaceholder('30m / 2h / 1d').setStyle(TextInputStyle.Short).setRequired(type === 'timeout').setMaxLength(10);
    const rsn = new TextInputBuilder().setCustomId('reason').setLabel('السبب')
      .setPlaceholder('اكتب السبب').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(400);
    modal.addComponents(new ActionRowBuilder().addComponents(dur), new ActionRowBuilder().addComponents(rsn));
    return interaction.showModal(modal);
  }
  const preset = (store.get(interaction.guildId, ID).presets || [])[Number(interaction.values[0])];
  if (!preset) return interaction.reply({ content: simple('الخيار مو موجود.', 'error'), flags: MessageFlags.Ephemeral });
  return finishPunish(interaction, type, targetId, preset.minutes || 0, preset.label);
}

async function onModal(interaction, [type, targetId]) {
  const raw = interaction.fields.getTextInputValue('dur').trim();
  const reason = interaction.fields.getTextInputValue('reason').trim();
  let minutes = 0;
  if (raw) {
    const ms = parseDuration(/^\d+$/.test(raw) ? `${raw}m` : raw);
    if (!ms) return interaction.reply({ content: simple('مدة غير صحيحة. أمثلة: `30m` `2h` `1d`', 'error'), flags: MessageFlags.Ephemeral });
    minutes = Math.round(ms / 60_000);
  }
  return finishPunish(interaction, type, targetId, minutes, reason);
}

async function finishPunish(interaction, type, targetId, minutes, reason) {
  const { guild } = interaction;
  const cfg = store.get(guild.id, ID);
  // Confirmation is private to the executor; the public record is the log channel.
  const done = async (content) => {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
    await interaction.message?.delete?.().catch(() => null);
  };
  if (levelOf(interaction.member) < PUNISH[type].level) return done(simple('ما عندك صلاحية لهذا الأمر.', 'error'));
  const target = await guild.members.fetch(targetId).catch(() => null);
  const problem = guard({ guild, member: interaction.member, me: guild.members.me }, target, PUNISH[type].label);
  if (problem) return done(simple(problem, 'error'));
  try {
    const text = await applyPunish(guild, cfg, type, target, interaction.user, minutes, reason);
    return done(simple(`${I.success} ${text}\n${I.report} **السبب:** ${reason}`, 'success'));
  } catch (e) {
    return done(simple(e.message, 'error'));
  }
}

// ── role-abuse guard + sticky سطف ────────────────────────────────────
async function onMemberUpdate(oldM, newM) {
  const cfg = store.get(newM.guild.id, ID);

  // Sticky سطف: keep the «سطيف» nick on a stuffed member (voice mute is kept in onVoiceUpdate).
  if (data.stuffGet(newM.guild.id, newM.id)) {
    if ((newM.nickname || null) !== 'سطيف') newM.setNickname('سطيف', 'سطف: إعادة الاسم تلقائياً').catch(() => null);
  }

  if (!cfg.roleGuard?.enabled) return;
  // Never guard bots: giving the server's own bot a role must not be reverted.
  if (newM.user.bot) return;
  const protectedRoles = cfg.roleGuard.protected?.length ? cfg.roleGuard.protected : cfg.roles.admin;
  const added = newM.roles.cache.filter((r) => !oldM.roles.cache.has(r.id) && protectedRoles.includes(r.id));
  if (!added.size) return;
  const guild = newM.guild;
  const audit = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 6 }).catch(() => null);
  const entry = audit?.entries.find((e) => e.target?.id === newM.id && Date.now() - e.createdTimestamp < 15_000
    && e.changes?.some((c) => c.key === '$add' && c.new?.some((r) => added.has(r.id))));
  const executor = entry?.executor;
  if (!executor || executor.id === guild.client.user.id || executor.id === guild.ownerId) return;
  const ex = await guild.members.fetch(executor.id).catch(() => null);
  if (!ex) return;
  const trusted = ex.permissions.has(PermissionFlagsBits.Administrator)
    || (cfg.roleGuard.guardians || []).some((id) => ex.roles.cache.has(id))
    || cfg.roles.admin.some((id) => ex.roles.cache.has(id));
  if (trusted) return;

  for (const r of added.values()) await newM.roles.remove(r, 'Sword: منع رفع رتبة محمية').catch(() => null);
  const names = [...added.values()].map((r) => r.name).join('، ');
  const limit = cfg.roleGuard.strikes || 3;
  const strikes = data.strikeAdd(guild.id, executor.id);
  let note = `حاول يعطي ${newM} رتبة محمية (${names}) — تم سحبها. \`${strikes}/${limit}\``;
  let stripped = false;
  if (strikes >= limit) {
    data.strikeReset(guild.id, executor.id);
    const power = new Set([...cfg.roles.admin, ...cfg.roles.special, ...cfg.roles.interactive, ...protectedRoles]);
    const strip = ex.roles.cache.filter((r) => power.has(r.id) && r.position < guild.members.me.roles.highest.position);
    if (strip.size) await ex.roles.remove(strip, 'Sword: تكرار رفع رتب محمية').catch(() => null);
    note += `\n**تكرر ${strikes} مرات — تم سحب رتبه.**`;
    stripped = true;
  }
  const ch = guild.channels.cache.get(cfg.logs?.protect) || guild.channels.cache.get(cfg.logs?.ban);
  if (ch) {
    ch.send({
      content: simple([
        `${I.admin} **المسؤول :** <@${executor.id}> \`${executor.id}\``,
        `${I.user} **العضو :** <@${newM.id}>`,
        `${I.report} **السبب :** ${note}`,
      ].join('\n'), stripped ? 'error' : 'warn', `${I.shieldAlert} حماية الرتب`),
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }
}

// ── sticky سطف voice mute: re-mute a stuffed member if anyone unmutes them ──
async function onVoiceUpdate(oldS, newS) {
  const m = newS.member;
  if (!m || !newS.channel || newS.serverMute) return;
  if (!data.stuffGet(newS.guild.id, m.id)) return;
  m.voice.setMute(true, 'سطف: إعادة الميوت الصوتي تلقائياً').catch(() => null);
}

// ── auto-expiry sweeper ──────────────────────────────────────────────
function startSweeper(client) {
  const timer = setInterval(async () => {
    let due;
    try { due = data.punishDue(); } catch { return; }
    for (const row of due) {
      try {
        const guild = client.guilds.cache.get(row.guild_id);
        if (!guild || !store.isEnabled(guild.id, ID)) { if (!guild) data.punishClear(row.guild_id, row.user_id, row.type); continue; }
        const cfg = store.get(guild.id, ID);
        const member = await guild.members.fetch(row.user_id).catch(() => null);
        if (row.type === 'vmute') { if (member?.voice?.channel) await member.voice.setMute(false, 'انتهت مدة الميوت').catch(() => null); }
        else if (row.type === 'tmute') { if (member && cfg.muteRole) await member.roles.remove(cfg.muteRole, 'انتهت مدة الاسكات').catch(() => null); }
        else if (row.type === 'jail') { if (member) await unjailMember(guild, cfg, member).catch(() => null); }
        data.punishClear(row.guild_id, row.user_id, row.type);
      } catch (e) { logger.error('[staff] sweep:', e); }
    }
  }, 30_000);
  timer.unref?.();
}

// New channels inherit the mute-role deny automatically.
async function onChannelCreate(channel) {
  if (!channel.guild || !channel.permissionOverwrites || !channel.manageable) return;
  const cfg = store.get(channel.guild.id, ID);
  if (!cfg.muteRole || !channel.guild.roles.cache.get(cfg.muteRole)) return;
  await channel.permissionOverwrites.edit(cfg.muteRole, MUTE_DENY, { reason: 'Sword: اسكات تلقائي' }).catch(() => null);
}

// ── dashboard ────────────────────────────────────────────────────────
const roleField = (key, label, hint) => ({ key, type: 'role', label, hint });
const logField = (key, label) => ({ key: `logs.${key}`, type: 'channel', label });

module.exports = {
  id: ID,
  name: 'Staff',
  nameAr: 'الطاقم',
  emoji: I.admin,
  description: 'أوامر إدارية قصيرة بالعربي (بدون سلاش) بصلاحيات الرتب: اسكات، ميوت، سجن، بلاك، طرد، تذاكر، دعوات — مع ريأكشن ✅/❌.',
  defaults: {
    roles: {
      interactive: ['1550168249327685753'],
      special: ['1007928254813978625'],
      admin: ['1505729933807194263', '1549021844575748096', '1505729435800965141'],
    },
    muteRole: '1541794662329876500',
    jailRole: '1548942461148336208',
    blacklistRole: '1548942356948979772',
    liveRole: '', imageRole: '', hereRole: '', soundRole: '',
    okEmoji: '✅', noEmoji: '❌', wipeDelay: 3000, noticeDelay: 6000,
    logs: {
      vmute: '1553538498815074346',
      tmute: '1553539863159251075',
      block: '1553538873445982359',
      ban: '1553538137869778994',
      jail: '1553544386099548210',
      warn: '1553544436619808799',
      timeout: '1553543310877139004',
      protect: '',
    },
    // Preset reasons shown in the picker. minutes: 0 = permanent / until release.
    presets: [
      { id: 'p1', label: 'قذف', minutes: 480 },
      { id: 'p2', label: 'سب وشتم', minutes: 720 },
      { id: 'p3', label: 'إزعاج', minutes: 120 },
      { id: 'p4', label: 'سبام', minutes: 60 },
      { id: 'p5', label: 'مخالفة القوانين', minutes: 240 },
      { id: 'p6', label: 'تعدي على الإدارة', minutes: 1440 },
    ],
    roleGuard: { enabled: true, protected: [], guardians: [], strikes: 3 },
  },
  events: {
    messageCreate: onMessage,
    guildMemberAdd: onMemberAdd,
    guildMemberUpdate: onMemberUpdate,
    voiceStateUpdate: onVoiceUpdate,
    channelCreate: onChannelCreate,
    inviteCreate: (invite) => { if (invite.guild) cacheGuild(invite.guild); },
    inviteDelete: (invite) => { if (invite.guild) cacheGuild(invite.guild); },
  },
  components: { pick: onPick, pmodal: onModal },
  actions: {
    setupMute: {
      label: 'تجهيز رتبة الاسكات',
      description: 'يمنع رتبة الاسكات من الكتابة في كل الرومات (التذاكر تظل مسموحة)',
      async run(guild) {
        const res = await applyMuteOverwrites(guild, store.get(guild.id, ID).muteRole);
        if (res.error) throw userError(res.error);
        return `تم تجهيز الاسكات على ${res.count} روم`;
      },
    },
  },
  async ready(client) {
    client.staffWords = OWNED;
    startSweeper(client);
    for (const guild of client.guilds.cache.values()) await cacheGuild(guild);
  },
  dashboard: [
    {
      title: 'رتب الصلاحيات', icon: 'admin',
      description: 'كل طبقة أعلى تورث صلاحيات اللي تحتها. الستريشن = كل الأوامر.',
      fields: [
        { key: 'roles.interactive', type: 'roles', label: 'الرتبة التفاعلية (اسكات + ميوت)', max: 10 },
        { key: 'roles.special', type: 'roles', label: 'الرتبة الخاصة (+ سجن)', max: 10 },
        { key: 'roles.admin', type: 'roles', label: 'رتب الستريشن (كل شي)', max: 10 },
      ],
    },
    {
      title: 'رتب العقوبات', icon: 'lock',
      description: 'الرتب اللي يحطها البوت عند التنفيذ — لازم تكون تحت رتبة البوت.',
      fields: [
        roleField('muteRole', 'رتبة الاسكات (كتم كتابي)'),
        roleField('jailRole', 'رتبة السجن'),
        roleField('blacklistRole', 'رتبة البلاك'),
      ],
    },
    {
      title: 'رتب الصلاحيات الممنوحة', icon: 'settings',
      description: 'اختياري — أوامر لايف/صور/هير/ساوند تعطي/تسحب هذي الرتب.',
      fields: [
        roleField('liveRole', 'رتبة اللايف (كام وبث)'),
        roleField('imageRole', 'رتبة الصور'),
        roleField('hereRole', 'رتبة الهير'),
        roleField('soundRole', 'رتبة الساوند'),
      ],
    },
    {
      title: 'رومات اللوق', icon: 'logs',
      description: 'كل عقوبة تتسجّل في رومها بإمبد فيه العضو والمشرف والمدة والسبب.',
      fields: [
        logField('vmute', 'لوق الميوت الصوتي'),
        logField('tmute', 'لوق الاسكات الكتابي'),
        logField('jail', 'لوق السجن'),
        logField('timeout', 'لوق التايم أوت'),
        logField('warn', 'لوق التحذير'),
        logField('block', 'لوق البلاك'),
        logField('ban', 'لوق الباند'),
        logField('protect', 'لوق حماية الرتب'),
      ],
    },
    {
      title: 'أسباب ومدد جاهزة', icon: 'report',
      description: 'تطلع كقائمة اختيار عند الميوت/الاسكات/السجن/التايم أوت. المدة بالدقائق (0 = دائم).',
      fields: [
        {
          key: 'presets', type: 'list', label: 'الأسباب', idKey: 'id', max: 23,
          fields: [
            { key: 'label', type: 'text', label: 'السبب', max: 100 },
            { key: 'minutes', type: 'number', label: 'المدة (دقيقة)', min: 0, max: 40320 },
          ],
        },
      ],
    },
    {
      title: 'الريأكشن والحذف', icon: 'settings',
      fields: [
        { key: 'okEmoji', type: 'text', label: 'إيموجي النجاح', hint: 'يدعم الإيموجي العادي أو المخصص <:name:id>' },
        { key: 'noEmoji', type: 'text', label: 'إيموجي الخطأ' },
        { key: 'wipeDelay', type: 'number', label: 'حذف رسالة الأمر بعد (ثانية) — للباند والبلاك', min: 0, max: 60, scale: 1000 },
        { key: 'noticeDelay', type: 'number', label: 'حذف رسائل التنبيه/الخطأ بعد (ثانية) — 0 تبقى ظاهرة', min: 0, max: 60, scale: 1000 },
      ],
    },
    {
      title: 'حماية الرتب', icon: 'shieldAlert',
      description: 'لو أحد غير مخوّل أعطى رتبة محمية، البوت يسحبها، وبعد تكرارها يسحب رتبه هو. يحتاج صلاحية View Audit Log للبوت.',
      fields: [
        { key: 'roleGuard.enabled', type: 'bool', label: 'تفعيل حماية الرتب' },
        { key: 'roleGuard.protected', type: 'roles', label: 'الرتب المحمية (الافتراضي: رتب الستريشن)', max: 20 },
        { key: 'roleGuard.guardians', type: 'roles', label: 'المخوّلون بإعطائها (غير المالك والستريشن)', max: 20 },
        { key: 'roleGuard.strikes', type: 'number', label: 'عدد المحاولات قبل سحب رتبته', min: 1, max: 10 },
      ],
    },
  ],
};
