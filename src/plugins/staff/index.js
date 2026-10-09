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
const { PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const store = require('../../core/store');
const cases = require('../../core/cases');
const { simple, colors } = require('../../core/theme');
const { I } = require('../../core/icons');
const { normalize } = require('../../core/i18n');
const { ts } = require('../../utils/time');
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
  return { reply: { embeds: [simple(lines.join('\n'), color, title)], allowedMentions: { parse: [] } }, noReact: true };
}

async function dm(user, guild, text) {
  await user.send({ embeds: [simple(text, 'accent')] }).catch(() => null);
}

// ── commands ─────────────────────────────────────────────────────────
// Each: { names:[...], symbol?, word?, level, wipe?, desc, run(ctx) }
// run returns: undefined (✅) · err('..') (❌ + notice) · ok('..') (✅ + note)
//            · { reply, noReact } (sends its own message, no reaction)
const COMMANDS = [
  // ── level 1: text/voice mute ───────────────────────────────────────
  {
    names: ['اسكات', 'سكات', 'skat', 'mute-text'], level: 1, desc: 'كتم كتابي للعضو (رتبة الاسكات)',
    async run(ctx) {
      const t = await ctx.target();
      const problem = guard(ctx, t, 'اسكات') || roleUsable(ctx, ctx.cfg.muteRole, 'الاسكات');
      if (problem) return err(problem);
      if (t.roles.cache.has(ctx.cfg.muteRole)) return err('العضو مسكّت أصلاً.');
      await t.roles.add(ctx.cfg.muteRole, `اسكات by ${ctx.author.tag}`);
      return ok(`تم اسكات ${t}`);
    },
  },
  {
    names: ['تكلم', 'فك-اسكات', 'unskat'], level: 1, desc: 'فك الاسكات الكتابي',
    async run(ctx) {
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه.');
      if (!ctx.cfg.muteRole || !t.roles.cache.has(ctx.cfg.muteRole)) return err('العضو مو مسكّت.');
      await t.roles.remove(ctx.cfg.muteRole, `تكلم by ${ctx.author.tag}`);
      return ok(`تم فك الاسكات عن ${t}`);
    },
  },
  {
    names: ['ميوت', 'mute'], level: 1, desc: 'ميوت صوتي (سيرفر ميوت)',
    async run(ctx) {
      const t = await ctx.target();
      const problem = guard(ctx, t, 'ميوت');
      if (problem) return err(problem);
      if (!t.voice.channel) return err('لازم العضو يكون داخل روم صوتي.');
      if (t.voice.serverMute) return err('العضو مميوت أصلاً.');
      await t.voice.setMute(true, `ميوت by ${ctx.author.tag}`);
      return ok(`تم ميوت ${t}`);
    },
  },
  {
    names: ['فك', 'unmute'], level: 1, desc: 'فك الميوت الصوتي',
    async run(ctx) {
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه.');
      if (!t.voice.channel) return err('العضو مو داخل روم صوتي.');
      if (!t.voice.serverMute) return err('العضو مو مميوت.');
      await t.voice.setMute(false, `فك by ${ctx.author.tag}`);
      return ok(`تم فك الميوت عن ${t}`);
    },
  },

  // ── level 2: jail ──────────────────────────────────────────────────
  {
    names: ['سجن', 'jail'], level: 2, desc: 'سجن العضو (يشيل رتبه ويحط رتبة السجن)',
    async run(ctx) {
      const t = await ctx.target();
      const problem = guard(ctx, t, 'سجن') || roleUsable(ctx, ctx.cfg.jailRole, 'السجن');
      if (problem) return err(problem);
      if (t.roles.cache.has(ctx.cfg.jailRole)) return err('العضو مسجون أصلاً.');
      const kept = t.roles.cache
        .filter((r) => r.id !== ctx.guild.id && !r.managed && r.position < ctx.me.roles.highest.position)
        .map((r) => r.id);
      data.jailSave(ctx.guild.id, t.id, kept, ctx.author.id, ctx.reasonFrom(1));
      await t.roles.set([...t.roles.cache.filter((r) => r.managed || r.position >= ctx.me.roles.highest.position).map((r) => r.id), ctx.cfg.jailRole], `سجن by ${ctx.author.tag}`);
      return ok(`تم سجن ${t}`);
    },
  },
  {
    names: ['عفو', 'unjail'], level: 2, desc: 'فك السجن وإرجاع الرتب',
    async run(ctx) {
      const t = await ctx.target();
      if (!t) return err('منشن العضو أو حط آيديه.');
      const snap = data.jailGet(ctx.guild.id, t.id);
      if (!snap && !t.roles.cache.has(ctx.cfg.jailRole)) return err('العضو مو مسجون.');
      const restore = (snap?.roles || []).filter((id) => {
        const r = ctx.guild.roles.cache.get(id);
        return r && !r.managed && r.position < ctx.me.roles.highest.position;
      });
      const keepManaged = t.roles.cache.filter((r) => r.managed).map((r) => r.id);
      await t.roles.set([...new Set([...restore, ...keepManaged])], `عفو by ${ctx.author.tag}`);
      data.jailClear(ctx.guild.id, t.id);
      return ok(`تم فك السجن عن ${t}`);
    },
  },

  // ── level 3: server punishments ────────────────────────────────────
  {
    names: ['باند'], level: 3, wipe: true, desc: 'باند العضو ومنعه من دخول السيرفر',
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
    symbol: '#', word: 'بلاك', level: 3, wipe: true, desc: 'بلاك لست (إضافة/إزالة)',
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
      return ok(`تم حط ${t} في البلاك`);
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
    names: ['مسح', 'clear', 'purge'], level: 3, desc: 'حذف عدد من آخر الرسائل',
    async run(ctx) {
      const n = parseInt(ctx.words[0], 10);
      if (!n || n < 1 || n > 100) return err('حط عدد بين 1 و 100. مثال: `مسح 20`');
      const deleted = await ctx.channel.bulkDelete(n + 1, true).catch(() => null); // +1 = أمر المسح نفسه
      if (!deleted) return err('ما قدرت أمسح (الرسائل أقدم من 14 يوم؟).');
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
      await ctx.channel.send({ embeds: [simple(`${I.lock} تم إغلاق التذكرة بواسطة ${ctx.member}`, 'accent')] }).catch(() => null);
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
      await ctx.channel.send({ content: `${t}`, embeds: [simple(`${I.mail} تذكير: الرجاء مراجعة التذكرة والرد ${I.sword}`, 'primary')] }).catch(() => null);
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
      const embed = new EmbedBuilder().setColor(colors.primary).setTitle(`${I.user} أفتار ${u.username}`)
        .setImage(u.displayAvatarURL({ size: 1024, forceStatic: false }));
      return { reply: { embeds: [embed], allowedMentions: { parse: [] } }, noReact: true };
    },
  },
  {
    names: ['بانر', 'banner'], level: 0, desc: 'عرض بانر العضو',
    async run(ctx) {
      const u = await (await ctx.userTarget() || ctx.author).fetch(true).catch(() => null);
      const url = u?.bannerURL?.({ size: 1024, forceStatic: false });
      if (!url) return err('العضو ما عنده بانر.');
      const embed = new EmbedBuilder().setColor(colors.primary).setTitle(`${I.image} بانر ${u.username}`).setImage(url);
      return { reply: { embeds: [embed], allowedMentions: { parse: [] } }, noReact: true };
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
const OWNED = new Set([...normalMap.keys(), normalize('طرد'), normalize('بلاك'), normalize('تذكير')]);

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

async function notice(message, text) {
  const m = await message.reply({ embeds: [simple(text, 'error')], allowedMentions: { repliedUser: false } }).catch(() => null);
  if (m) setTimeout(() => m.delete().catch(() => null), 7000);
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
    await notice(message, 'ما عندك صلاحية لهذا الأمر.');
    return;
  }

  const cfg = store.get(message.guildId, ID);
  message._staffArgs = args;
  message._staffLevel = level;
  try {
    const res = await cmd.run(makeCtx(message, cfg));
    if (res?.error) { await react(message, false, cfg); await notice(message, res.error); return; }
    if (res?.reply) await message.reply({ ...res.reply, allowedMentions: res.reply.allowedMentions || { repliedUser: false } }).catch(() => null);
    if (res?.noReact) return;
    await react(message, true, cfg);
    if (cmd.wipe) setTimeout(() => message.delete().catch(() => null), cfg.wipeDelay);
  } catch (e) {
    logger.error('[staff] command:', e);
    await react(message, false, cfg);
    await notice(message, 'صار خطأ غير متوقع، حاول مرة ثانية.');
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

// ── dashboard ────────────────────────────────────────────────────────
const roleField = (key, label, hint) => ({ key, type: 'role', label, hint });

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
    okEmoji: '✅', noEmoji: '❌', wipeDelay: 3000,
  },
  events: {
    messageCreate: onMessage,
    guildMemberAdd: onMemberAdd,
    inviteCreate: (invite) => { if (invite.guild) cacheGuild(invite.guild); },
    inviteDelete: (invite) => { if (invite.guild) cacheGuild(invite.guild); },
  },
  async ready(client) {
    client.staffWords = OWNED;
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
      title: 'الريأكشن والحذف', icon: 'settings',
      fields: [
        { key: 'okEmoji', type: 'text', label: 'إيموجي النجاح', hint: 'يدعم الإيموجي العادي أو المخصص <:name:id>' },
        { key: 'noEmoji', type: 'text', label: 'إيموجي الخطأ' },
        { key: 'wipeDelay', type: 'number', label: 'حذف رسالة الأمر بعد (ثانية) — للباند والبلاك', min: 0, max: 60, scale: 1000 },
      ],
    },
  ],
};
