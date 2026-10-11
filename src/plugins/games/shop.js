// Roulette economy: points wallet, powers shop, inventory (الحقيبة) and stats.
const { ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const db = require('../../core/db');
const { simple } = require('../../core/theme');
const { I } = require('../../core/icons');

db.exec(`
  CREATE TABLE IF NOT EXISTS game_points (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    game     TEXT NOT NULL,
    points   INTEGER NOT NULL DEFAULT 0,
    wins     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, game)
  );
  CREATE TABLE IF NOT EXISTS game_powers (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    power    TEXT NOT NULL,
    qty      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, power)
  );
  CREATE TABLE IF NOT EXISTS game_stats (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    kills    INTEGER NOT NULL DEFAULT 0,
    deaths   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
`);

// Powers catalogue — fixed order, prices and in-game effect.
const POWERS = [
  { id: 'swap', name: 'تبديل', price: 3, icon: I.merge, desc: 'تبدّل مكانك مع لاعب ثاني' },
  { id: 'hide', name: 'اخفاء', price: 5, icon: I.hide, desc: 'تختفي من اللفة الجاية (ما توقف عليك)' },
  { id: 'reverse', name: 'عكس', price: 10, icon: I.reverse, desc: 'اللي طلعت عليه العجلة ينطرد بدل ما يختار' },
  { id: 'protect', name: 'حماية', price: 10, icon: I.shieldAlert, desc: 'تحميك من الطرد هالجولة' },
  { id: 'prevent', name: 'منع', price: 15, icon: I.forbid, desc: 'تمنع لاعب من استخدام خواصه' },
  { id: 'hack', name: 'تهكير', price: 20, icon: I.skull, desc: 'تختار أنت مين ينطرد' },
  { id: 'revive', name: 'إنعاش', price: 20, icon: I.heal, desc: 'ترجّع لاعب مطرود للّعبة' },
  { id: 'link', name: 'ربط', price: 20, icon: I.chain, desc: 'تربط لاعب فيك — لو طلع تطلع معه' },
  { id: 'bomb', name: 'قنبلة', price: 25, icon: I.nuke, desc: 'اللي يطّرد بعدك تنفجر فيه' },
  { id: 'counter', name: 'هجمة مرتدة', price: 25, icon: I.siren, desc: 'اللي يختارك للطرد ينطرد هو' },
  { id: 'snipe', name: 'قنص', price: 30, icon: I.signal, desc: 'تطرد لاعب على طول' },
];
const byId = Object.fromEntries(POWERS.map((p) => [p.id, p]));

const sql = {
  balance: db.prepare('SELECT COALESCE(SUM(points), 0) AS p FROM game_points WHERE guild_id = ? AND user_id = ?'),
  wins: db.prepare('SELECT COALESCE(SUM(wins), 0) AS w FROM game_points WHERE guild_id = ? AND user_id = ?'),
  spend: db.prepare("INSERT INTO game_points (guild_id, user_id, game, points, wins) VALUES (?, ?, '_shop', ?, 0) ON CONFLICT (guild_id, user_id, game) DO UPDATE SET points = points + excluded.points"),
  invAll: db.prepare('SELECT power, qty FROM game_powers WHERE guild_id = ? AND user_id = ? AND qty > 0'),
  invOne: db.prepare('SELECT qty FROM game_powers WHERE guild_id = ? AND user_id = ? AND power = ?'),
  invAdd: db.prepare('INSERT INTO game_powers (guild_id, user_id, power, qty) VALUES (?, ?, ?, 1) ON CONFLICT (guild_id, user_id, power) DO UPDATE SET qty = qty + 1'),
  invTake: db.prepare('UPDATE game_powers SET qty = qty - 1 WHERE guild_id = ? AND user_id = ? AND power = ? AND qty > 0'),
  stats: db.prepare('SELECT kills, deaths FROM game_stats WHERE guild_id = ? AND user_id = ?'),
  kill: db.prepare('INSERT INTO game_stats (guild_id, user_id, kills, deaths) VALUES (?, ?, 1, 0) ON CONFLICT (guild_id, user_id) DO UPDATE SET kills = kills + 1'),
  death: db.prepare('INSERT INTO game_stats (guild_id, user_id, kills, deaths) VALUES (?, ?, 0, 1) ON CONFLICT (guild_id, user_id) DO UPDATE SET deaths = deaths + 1'),
};

const balanceOf = (g, u) => sql.balance.get(g, u).p;
const ownedOf = (g, u) => sql.invAll.all(g, u);
const hasPower = (g, u, id) => (sql.invOne.get(g, u, id)?.qty || 0) > 0;
const usePower = (g, u, id) => sql.invTake.run(g, u, id).changes > 0;
const recordKill = (g, u) => sql.kill.run(g, u);
const recordDeath = (g, u) => sql.death.run(g, u);

function buy(g, u, id) {
  const p = byId[id];
  if (!p) return { error: 'خاصية غير موجودة.' };
  const bal = balanceOf(g, u);
  if (bal < p.price) return { error: `نقاطك ما تكفي — تحتاج \`${p.price}\` ومعك \`${bal}\`.` };
  sql.spend.run(g, u, -p.price);
  sql.invAdd.run(g, u, id);
  return { ok: p, balance: balanceOf(g, u) };
}

// ── الحقيبة ───────────────────────────────────────────────────────────
function bagPayload(guild, user) {
  const g = guild.id;
  const u = user.id;
  const st = sql.stats.get(g, u) || { kills: 0, deaths: 0 };
  const owned = ownedOf(g, u);
  const list = owned.length
    ? owned.map((o) => `${byId[o.power]?.icon || I.gem} ${byId[o.power]?.name || o.power} \`×${o.qty}\``).join('\n')
    : 'ما عندك خواص — اشتري من المتجر.';
  const body = [
    `${I.coins} **النقاط:** \`${balanceOf(g, u)}\``,
    `${I.trophy} **مرات الفوز:** \`${sql.wins.get(g, u).w}\``,
    `${I.kick} **مرات الطرد (سويتها):** \`${st.kills}\``,
    `${I.skull} **مرات طردك:** \`${st.deaths}\``,
    '',
    `${I.backpack} **الخصائص:**`,
    list,
  ].join('\n');
  return {
    content: simple(body, 'primary', `${I.backpack} حقيبة ${user.username}`),
    flags: MessageFlags.Ephemeral,
  };
}

// ── المتجر ────────────────────────────────────────────────────────────
function shopPayload(guild, user) {
  const bal = balanceOf(guild.id, user.id);
  const body = POWERS.map((p) => `${p.icon} **${p.name}** — \`${p.price}\` نقطة\n${p.desc}`).join('\n');
  const menu = new StringSelectMenuBuilder()
    .setCustomId('games:buy')
    .setPlaceholder('اختر خاصية تشتريها')
    .addOptions(POWERS.map((p) => ({ label: `${p.name} — ${p.price} نقطة`, value: p.id, description: p.desc.slice(0, 95) })));
  return {
    content: simple(body, 'primary', `${I.cart} المتجر — نقاطك: ${bal}`),
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  };
}

async function onBuy(interaction) {
  const res = buy(interaction.guildId, interaction.user.id, interaction.values[0]);
  if (res.error) return interaction.reply({ content: simple(`${I.error} ${res.error}`, 'error'), flags: MessageFlags.Ephemeral }).catch(() => null);
  const refreshed = shopPayload(interaction.guild, interaction.user);
  refreshed.content = `${simple(`${I.success} شريت **${res.ok.name}** — باقي \`${res.balance}\` نقطة.`, 'success')}\n${refreshed.content}`;
  delete refreshed.flags; // editing the existing ephemeral message
  return interaction.update(refreshed).catch(() => null);
}

module.exports = {
  POWERS, byId, balanceOf, ownedOf, hasPower, usePower, buy,
  recordKill, recordDeath, bagPayload, shopPayload, onBuy,
};
