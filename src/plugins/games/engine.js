// Shared game machinery: one session per channel, lobbies, waiting helpers and points.
const crypto = require('node:crypto');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionCollector, InteractionType, MessageFlags, PermissionFlagsBits, AttachmentBuilder,
} = require('discord.js');
const images = require('../../core/images');
const art = require('./art');
const shop = require('./shop');
const db = require('../../core/db');
const store = require('../../core/store');
const { card, simple, DIVIDER } = require('../../core/theme');
const { I, setIcon, asEmoji, text: iconText } = require('../../core/icons');
const { normalize: squash } = require('../../core/i18n');
const logger = require('../../core/logger');

db.exec(`
  CREATE TABLE IF NOT EXISTS game_points (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    game     TEXT NOT NULL,
    points   INTEGER NOT NULL DEFAULT 0,
    wins     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, game)
  );
`);

const cfgOf = (guildId) => store.get(guildId, 'games');
// Test hook: GAMES_TIME_SCALE=0.05 runs every timer 20x faster.
const SCALE = Number(process.env.GAMES_TIME_SCALE) || 1;
const scaled = (ms) => Math.max(1, Math.round(ms * SCALE));
const rand = (n) => crypto.randomInt(n);

// "1د 30ث" / "90ث" / "2د" / "1س" → seconds (ث sec · د min · س hour · ي day; s/m/h/d too).
const TIME_UNIT = { 'ث': 1, 'د': 60, 'س': 3600, 'ي': 86400, s: 1, m: 60, h: 3600, d: 86400 };
function parseArabicTime(str) {
  if (!str) return null;
  let total = 0;
  let found = false;
  const re = /(\d+)\s*(ث|د|س|ي|s|m|h|d)/gi;
  let m;
  while ((m = re.exec(str))) { total += Number(m[1]) * (TIME_UNIT[m[2].toLowerCase()] || 0); found = true; }
  if (!found) { const n = str.trim().match(/^(\d+)$/); if (n) { total = Number(n[1]); found = true; } }
  return found ? total : null;
}
const pick = (list) => list[rand(list.length)];
const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const mention = (p) => `<@${p.id}>`;
const avatarOf = (user) => user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || null;
const playerOf = (user, member) => ({ id: user.id, name: member?.displayName || user.globalName || user.username, avatar: avatarOf(user) });

// Lobby image: server-uploaded image for this game → bundled per-game banner
// (assets/lobby-<key>.png) → the generated Sword banner.
const ASSETS = require('node:path').join(__dirname, '..', '..', '..', 'assets');
const fs = require('node:fs');
async function lobbyImage(guildId, game) {
  const custom = images.find(guildId, 'games', game.key);
  if (custom) return new AttachmentBuilder(custom.file, { name: `lobby.${custom.ext}` });
  const bundled = require('node:path').join(ASSETS, `lobby-${game.key}.png`);
  if (fs.existsSync(bundled)) return new AttachmentBuilder(bundled, { name: 'lobby.png' });
  return new AttachmentBuilder(await art.banner(game), { name: 'lobby.png' });
}

// ── Text matching ─────────────────────────────────────────────────
// Loose compare: ignores diacritics, hamza forms, ة/ه, ى/ي, spaces, punctuation and a leading "ال".
const clean = (s) => squash(String(s || '')
  .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .replace(/[.,!?؟،:;'"«»()\-]/g, ''));
const stripAl = (s) => s.replace(/^ال/, '');
function matches(input, answers) {
  const a = clean(input);
  if (!a) return false;
  return answers.some((ans) => {
    const b = clean(ans);
    return a === b || stripAl(a) === stripAl(b);
  });
}

// ── Points ────────────────────────────────────────────────────────
const q = {
  add: db.prepare(`INSERT INTO game_points (guild_id, user_id, game, points, wins) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, user_id, game) DO UPDATE SET points = points + excluded.points, wins = wins + excluded.wins`),
  total: db.prepare('SELECT COALESCE(SUM(points), 0) AS points FROM game_points WHERE guild_id = ? AND user_id = ?'),
  byGame: db.prepare("SELECT game, points, wins FROM game_points WHERE guild_id = ? AND user_id = ? AND game NOT LIKE '\\_%' ESCAPE '\\' ORDER BY points DESC"),
  topAll: db.prepare('SELECT user_id, SUM(points) AS total FROM game_points WHERE guild_id = ? GROUP BY user_id HAVING SUM(points) > 0 ORDER BY total DESC LIMIT ?'),
  topGame: db.prepare('SELECT user_id, points, wins FROM game_points WHERE guild_id = ? AND game = ? AND points > 0 ORDER BY points DESC LIMIT ?'),
  rank: db.prepare('SELECT COUNT(*) + 1 AS pos FROM (SELECT SUM(points) AS p FROM game_points WHERE guild_id = ? GROUP BY user_id) WHERE p > ?'),
};
const points = {
  award: (guildId, userId, game, amount, win = true) => q.add.run(guildId, userId, game, amount, win ? 1 : 0),
  total: (guildId, userId) => q.total.get(guildId, userId).points,
  byGame: (guildId, userId) => q.byGame.all(guildId, userId),
  top: (guildId, game, limit = 10) => (game ? q.topGame.all(guildId, game, limit)
    : q.topAll.all(guildId, limit).map((r) => ({ user_id: r.user_id, points: r.total }))),
  rank: (guildId, total) => q.rank.get(guildId, total).pos,
};

// ── Sessions ──────────────────────────────────────────────────────
const sessions = new Map(); // channelId -> Session

class Session {
  constructor(interaction, game) {
    this.id = crypto.randomBytes(3).toString('hex');
    this.game = game;
    this.channel = interaction.channel;
    this.guildId = interaction.guildId;
    this.client = interaction.client;
    this.hostId = interaction.user.id;
    this.active = true;
    this.collectors = new Set();
    this.timers = new Set();
  }

  cid(...parts) { return ['g', this.id, ...parts].join(':'); }

  own(i) { return i.customId?.startsWith(`g:${this.id}:`); }

  part(i, index = 2) { return i.customId.split(':')[index]; }

  track(collector) {
    this.collectors.add(collector);
    collector.once('end', () => this.collectors.delete(collector));
    return collector;
  }

  sleep(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.timers.delete(t); resolve(); }, scaled(ms));
      this.timers.add(t);
    });
  }

  stop(reason = 'stopped') {
    if (!this.active) return;
    this.active = false;
    for (const c of this.collectors) c.stop(reason);
    for (const t of this.timers) clearTimeout(t);
    if (sessions.get(this.channel.id) === this) sessions.delete(this.channel.id);
  }

  send(payload) { return this.channel.send({ allowedMentions: { parse: ['users'] }, ...payload }).catch(() => null); }

  say(textBody, { title, icon } = {}) {
    const head = title ? `${icon ? `${iconText(icon)} ` : ''}**${title}**\n` : '';
    return this.send({ content: `${head}${textBody}` });
  }

  // Components on any message in this channel (including ephemeral replies) for this session.
  components({ time, filter = () => true }) {
    return this.track(new InteractionCollector(this.client, {
      channel: this.channel,
      interactionType: InteractionType.MessageComponent,
      time: scaled(time),
      filter: (i) => this.own(i) && filter(i),
    }));
  }

  /** First component interaction accepted by `accept`; others get `deny` as an ephemeral note. */
  waitComponent({ time, accept = () => true, deny = 'مو دورك' }) {
    return new Promise((resolve) => {
      const c = this.components({ time });
      c.on('collect', (i) => {
        if (accept(i)) {
          c.stop('done');
          resolve(i);
        } else {
          i.reply({ content: deny, flags: MessageFlags.Ephemeral }).catch(() => null);
        }
      });
      c.once('end', (_, reason) => { if (reason !== 'done') resolve(null); });
    });
  }

  messages({ time, filter = () => true, max }) {
    return this.track(this.channel.createMessageCollector({ time: scaled(time), max, filter: (m) => !m.author.bot && filter(m) }));
  }

  waitMessage({ time, filter }) {
    return new Promise((resolve) => {
      const c = this.messages({ time, filter, max: 1 });
      c.once('end', (collected) => resolve(collected.first() || null));
    });
  }
}

const current = (channelId) => sessions.get(channelId) || null;

// Sends the command's first response and returns the Message (slash or prefix).
async function post(interaction, payload) {
  if (interaction.viaPrefix) return interaction.reply(payload);
  const res = await interaction.reply({ ...payload, withResponse: true });
  return res.resource?.message || interaction.fetchReply();
}

// Common button helper.
const button = (customId, label, style = ButtonStyle.Secondary, icon, disabled = false) => {
  const b = new ButtonBuilder().setCustomId(customId).setStyle(style).setDisabled(disabled);
  if (label) b.setLabel(String(label).slice(0, 80));
  const hasIcon = icon && asEmoji(icon);
  if (hasIcon) setIcon(b, icon);
  if (!label && !hasIcon) b.setLabel('‎'); // a button needs a label or an emoji
  return b;
};
const rows = (buttons, perRow = 5) => {
  const out = [];
  for (let i = 0; i < buttons.length && out.length < 5; i += perRow) out.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + perRow)));
  return out;
};

/**
 * Join lobby. Resolves to an array of players ({ id, name }) or null if cancelled.
 */
async function lobby(session, interaction, { game, min = 2, max = 20, rules, imageOnly = false }) {
  const cfg = cfgOf(session.guildId);
  // Per-game override: "روليت 1د 30ث" sets the wait time for this lobby only.
  const custom = parseArabicTime(interaction.options?.getString?.('time'));
  const seconds = custom ? Math.max(5, Math.min(3600, custom)) : cfg.lobbyTime;
  const endsAt = Math.floor(Date.now() / 1000) + seconds;
  const players = new Map([[interaction.user.id, playerOf(interaction.user, interaction.member)]]);
  const image = await lobbyImage(session.guildId, game);

  const buttons = (closed) => {
    if (closed) return [];
    const b = [
      button(session.cid('join'), 'دخول', ButtonStyle.Success, I.plus),
      button(session.cid('leave'), 'خروج', ButtonStyle.Secondary, I.minus),
    ];
    // imageOnly lobbies (روليت) start only after the wait time — no instant start —
    // and show the bag/shop buttons.
    if (!imageOnly) {
      b.push(button(session.cid('start'), 'ابدأ الحين', ButtonStyle.Primary, I.fast));
    } else {
      b.push(button(session.cid('bag'), 'الحقيبة', ButtonStyle.Secondary, I.backpack));
      b.push(button(session.cid('shop'), 'المتجر', ButtonStyle.Secondary, I.cart));
    }
    return rows(b);
  };

  const render = (closed = false, note, first = false) => {
    // imageOnly: just the banner image and the buttons, no embed box.
    if (imageOnly) {
      return {
        ...(first ? { files: [image] } : {}),
        ...(note ? { content: note } : {}),
        components: buttons(closed),
      };
    }
    const list = [...players.values()].map((p, i) => `\`${String(i + 1).padStart(2, '0')}\` ${mention(p)}`).join('\n');
    const { embed } = card({
      brand: false,
      description: `${rules}\n${DIVIDER}\n**اللاعبين (${players.size}/${max})**\n${list}\n${DIVIDER}\n${note || (closed ? 'بدأت اللعبة' : `تبدأ <t:${endsAt}:R> • الحد الأدنى ${min} لاعبين`)}`,
      image: `attachment://${image.name}`,
      footer: `Sword Games • ${game.name}`,
    });
    return {
      embeds: [embed],
      ...(first ? { files: [image] } : {}),
      components: buttons(closed),
    };
  };

  const message = await post(interaction, render(false, null, true));
  const result = await new Promise((resolve) => {
    const c = session.components({ time: seconds * 1000 });
    c.on('collect', async (i) => {
      const action = session.part(i);
      if (action === 'join') {
        if (players.has(i.user.id)) return i.reply({ content: 'أنت داخل أصلاً', flags: MessageFlags.Ephemeral }).catch(() => null);
        if (players.size >= max) return i.reply({ content: 'اللعبة ممتلئة', flags: MessageFlags.Ephemeral }).catch(() => null);
        players.set(i.user.id, playerOf(i.user, i.member));
        if (imageOnly) return i.reply({ content: 'تم دخولك ✓', flags: MessageFlags.Ephemeral }).catch(() => null);
      } else if (action === 'leave') {
        if (!players.delete(i.user.id)) return i.reply({ content: 'أنت مو داخل', flags: MessageFlags.Ephemeral }).catch(() => null);
        if (imageOnly) return i.reply({ content: 'تم خروجك', flags: MessageFlags.Ephemeral }).catch(() => null);
      } else if (action === 'start') {
        if (i.user.id !== session.hostId) return i.reply({ content: 'صاحب اللعبة بس يقدر يبدأ', flags: MessageFlags.Ephemeral }).catch(() => null);
        if (players.size < min) return i.reply({ content: `يحتاج ${min} لاعبين على الأقل`, flags: MessageFlags.Ephemeral }).catch(() => null);
        await i.deferUpdate().catch(() => null);
        return c.stop('start');
      } else if (action === 'bag') {
        return i.reply(shop.bagPayload(i.guild, i.user)).catch(() => null);
      } else if (action === 'shop') {
        return i.reply(shop.shopPayload(i.guild, i.user)).catch(() => null);
      }
      await i.update(render()).catch(() => null);
    });
    c.once('end', (_, reason) => resolve(reason));
  });

  if (!session.active || result === 'stopped') return null;
  if (players.size < min) {
    await message.edit(render(true, `انلغت اللعبة — يحتاج ${min} لاعبين على الأقل`)).catch(() => null);
    return null;
  }
  await message.edit(render(true)).catch(() => null);
  return shuffle([...players.values()]);
}

// Announces the winner(s) and awards points.
async function finish(session, game, winners, amount) {
  const list = (Array.isArray(winners) ? winners : [winners]).filter(Boolean);
  if (!list.length) return session.say('ما فيه فائز هالمرة', { title: `${game.name} — انتهت`, icon: I.flag });
  for (const w of list) points.award(session.guildId, w.id, game.key, amount);
  const names = list.map(mention).join(' ، ');
  const head = `${iconText(I.trophy)} **${game.name} — الفائز**\n${I.crown} ${names}\n${I.coins} **+${amount}** نقطة`;
  if (list.length === 1) {
    try {
      const file = new AttachmentBuilder(await art.winnerCard(list[0], game, amount), { name: 'winner.png' });
      return session.send({ content: head, files: [file] });
    } catch (err) {
      logger.warn('winner card:', err.message);
    }
  }
  return session.send({ content: head });
}

/** Runs a game: one per channel, stoppable with "ايقاف", errors logged. */
async function run(interaction, game, fn, { reply }) {
  const cfg = cfgOf(interaction.guildId);
  if (cfg.channels.length && !cfg.channels.includes(interaction.channelId)) {
    return reply.error(interaction, `الألعاب في ${cfg.channels.map((id) => `<#${id}>`).join(' ')} بس`);
  }
  const busy = current(interaction.channelId);
  if (busy) return reply.error(interaction, `فيه لعبة شغالة هنا (${busy.game.name}) — استنى تخلص أو اكتب \`ايقاف\``);
  const session = new Session(interaction, game);
  sessions.set(interaction.channelId, session);
  try {
    await fn(session);
  } catch (err) {
    logger.error(`game ${game.key}:`, err);
    session.say('صار خطأ وانلغت اللعبة', { color: 'error' });
  } finally {
    session.stop('end');
  }
}

function canStop(interaction, session) {
  return session.hostId === interaction.user.id || interaction.member.permissions.has(PermissionFlagsBits.ManageMessages);
}

module.exports = {
  Session, sessions, current, run, lobby, finish, post, button, rows, points, cfgOf,
  rand, pick, shuffle, mention, matches, clean, canStop, ButtonStyle, scaled, playerOf, art, AttachmentBuilder,
};
