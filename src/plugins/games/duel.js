// 1v1 games: حجره (rock-paper-scissors) and اكس (tic-tac-toe). Without an opponent you play the bot.
const { MessageFlags } = require('discord.js');
const { I } = require('../../core/icons');
const { simple } = require('../../core/theme');
const { button, rows, pick, rand, mention, points, cfgOf, post, ButtonStyle } = require('./engine');

const S = ButtonStyle;
const ends = (seconds) => `<t:${Math.floor(Date.now() / 1000) + seconds}:R>`;

// Resolves the two sides, asking a human opponent to accept first.
async function sides(session, interaction, game) {
  const host = { id: interaction.user.id, name: interaction.member.displayName };
  const target = interaction.options.getUser('user');
  const me = interaction.client.user;
  if (!target || target.id === me.id) return { host, rival: { id: me.id, name: me.username, bot: true } };
  if (target.bot) return { error: 'ما تقدر تتحدى بوت ثاني' };
  if (target.id === host.id) return { error: 'ما تقدر تتحدى نفسك' };
  const rival = { id: target.id, name: interaction.options.getMember('user')?.displayName || target.username };
  const msg = await post(interaction, {
    content: mention(rival),
    embeds: [simple(`${mention(host)} يتحداك في **${game.name}**! تقبل؟ (ينتهي ${ends(30)})`, 'primary', `${I[game.icon]} تحدي`)],
    components: rows([
      button(session.cid('accept'), 'أقبل', S.Success, I.success),
      button(session.cid('decline'), 'أرفض', S.Danger, I.close),
    ]),
  });
  const i = await session.waitComponent({ time: 30_000, accept: (x) => x.user.id === rival.id, deny: 'التحدي مو لك' });
  if (!i || session.part(i) === 'decline') {
    await (i ? i.update({ components: [], embeds: [simple(`${mention(rival)} رفض التحدي`, 'warn')] }) : msg.edit({ components: [] })).catch(() => null);
    return { cancelled: true };
  }
  await i.update({ components: [] }).catch(() => null);
  return { host, rival };
}

function award(session, game, winner, vsBot) {
  const cfg = cfgOf(session.guildId);
  const amount = vsBot ? cfg.quizPoint : cfg.duelWin;
  points.award(session.guildId, winner.id, game.key, amount);
  return amount;
}

// ── حجره ورقة مقص ────────────────────────────────────────────────
const HANDS = { rock: 'حجرة', paper: 'ورقة', scissors: 'مقص' };
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

async function rps(session, interaction, game, { reply }) {
  const s = await sides(session, interaction, game);
  if (s.error) return reply.error(interaction, s.error);
  if (s.cancelled) return;
  const { host, rival } = s;
  const players = [host, rival];
  const wins = [0, 0];
  if (rival.bot) await post(interaction, { embeds: [simple(`${mention(host)} ضد البوت — أفضل من 3`, 'primary', `${I.rps} ${game.name}`)] });

  for (let round = 1; round <= 5 && Math.max(...wins) < 2 && session.active; round += 1) {
    const chosen = new Map();
    if (rival.bot) chosen.set(rival.id, pick(Object.keys(HANDS)));
    const msg = await session.send({
      embeds: [simple(`الجولة **${round}** — ${players.map(mention).join(' ضد ')}\nاختاروا (محد يشوف اختيارك) • ينتهي ${ends(20)}`, 'primary', game.name)],
      components: rows(Object.entries(HANDS).map(([k, label]) => button(session.cid('hand', k), label))),
    });
    await new Promise((resolve) => {
      const c = session.components({ time: 20_000 });
      c.on('collect', (i) => {
        if (!players.some((p) => p.id === i.user.id && !p.bot)) {
          return i.reply({ content: 'أنت مو باللعبة', flags: MessageFlags.Ephemeral }).catch(() => null);
        }
        chosen.set(i.user.id, session.part(i, 3));
        i.reply({ content: `اخترت **${HANDS[session.part(i, 3)]}**`, flags: MessageFlags.Ephemeral }).catch(() => null);
        if (chosen.size === 2) c.stop('both');
      });
      c.once('end', resolve);
    });
    if (!session.active) return;
    await msg?.edit({ components: [] }).catch(() => null);
    const [a, b] = players.map((p) => chosen.get(p.id));
    if (!a && !b) return session.say('محد اختار — انلغى التحدي', { color: 'warn' });
    let result;
    if (!a || !b) {
      const w = a ? 0 : 1;
      wins[w] += 1;
      result = `${mention(players[1 - w])} ما اختار — الجولة لـ ${mention(players[w])}`;
    } else if (a === b) {
      result = `تعادل! الاثنين اختاروا **${HANDS[a]}**`;
    } else {
      const w = BEATS[a] === b ? 0 : 1;
      wins[w] += 1;
      result = `**${HANDS[a]}** ضد **${HANDS[b]}** — الجولة لـ ${mention(players[w])}`;
    }
    await session.say(`${result}\nالنتيجة: ${wins[0]} - ${wins[1]}`, { title: game.name, icon: I.rps });
    await session.sleep(1200);
  }
  if (!session.active) return;
  if (wins[0] === wins[1]) return session.say('انتهت بالتعادل!', { color: 'warn', title: game.name });
  const winner = players[wins[0] > wins[1] ? 0 : 1];
  if (winner.bot) return session.say('البوت فاز عليك! حاول مرة ثانية', { title: game.name, icon: I.trophy, color: 'accent' });
  const amount = award(session, game, winner, rival.bot);
  await session.say(`${I.crown} ${mention(winner)} فاز!\n${I.coins} **+${amount}** نقطة`, { title: game.name, icon: I.trophy, color: 'success' });
}

// ── اكس او ───────────────────────────────────────────────────────
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const winnerOf = (b) => {
  for (const [x, y, z] of LINES) if (b[x] && b[x] === b[y] && b[x] === b[z]) return b[x];
  return b.every(Boolean) ? 'draw' : null;
};

// Perfect play for the bot.
function minimax(b, me, turn) {
  const w = winnerOf(b);
  if (w === me) return { score: 1 };
  if (w === 'draw') return { score: 0 };
  if (w) return { score: -1 };
  let best = { score: turn === me ? -2 : 2, move: null };
  for (let i = 0; i < 9; i += 1) {
    if (b[i]) continue;
    b[i] = turn;
    const { score } = minimax(b, me, turn === 'X' ? 'O' : 'X');
    b[i] = null;
    if (turn === me ? score > best.score : score < best.score) best = { score, move: i };
  }
  return best;
}

async function xo(session, interaction, game, { reply }) {
  const s = await sides(session, interaction, game);
  if (s.error) return reply.error(interaction, s.error);
  if (s.cancelled) return;
  const players = rand(2) ? [s.host, s.rival] : [s.rival, s.host]; // [X, O]
  const marks = ['X', 'O'];
  const board = Array(9).fill(null);
  let turn = 0;
  const render = (status, over = false) => ({
    embeds: [simple(`${mention(players[0])} **X** ضد ${mention(players[1])} **O**\n${status}`, 'primary', `${I.xo} ${game.name}`)],
    components: rows(board.map((v, n) => button(session.cid('cell', n), v || null, v === 'X' ? S.Danger : v === 'O' ? S.Primary : S.Secondary, null, over || !!v)), 3),
  });
  const statusFor = () => `دور ${mention(players[turn])} (**${marks[turn]}**)${players[turn].bot ? '' : ` • ينتهي ${ends(30)}`}`;
  const msg = s.rival.bot ? await post(interaction, render(statusFor())) : await session.send(render(statusFor()));

  let result = null;
  while (!result && session.active) {
    const player = players[turn];
    let cell;
    if (player.bot) {
      await session.sleep(800);
      const empty = board.map((v, n) => (v ? null : n)).filter((n) => n !== null);
      cell = board.every((v) => !v) ? pick([0, 2, 4, 6, 8]) : minimax(board, marks[turn], marks[turn]).move ?? pick(empty);
    } else {
      const i = await session.waitComponent({ time: 30_000, accept: (x) => x.user.id === player.id, deny: 'مو دورك' });
      if (!session.active) return;
      if (!i) {
        result = { timeout: player };
        break;
      }
      cell = Number(session.part(i, 3));
      await i.deferUpdate().catch(() => null);
      if (board[cell]) continue;
    }
    board[cell] = marks[turn];
    const w = winnerOf(board);
    if (w) result = w === 'draw' ? { draw: true } : { winner: player };
    else turn = 1 - turn;
    if (!result) await msg?.edit(render(statusFor())).catch(() => null);
  }
  if (!session.active) return;
  if (result.draw) return msg?.edit(render('**تعادل!**', true)).catch(() => null);
  const winner = result.winner || players.find((p) => p.id !== result.timeout.id);
  const why = result.timeout ? `${mention(result.timeout)} خلص وقته — ` : '';
  if (winner.bot) return msg?.edit(render(`${why}**البوت فاز!**`, true)).catch(() => null);
  const amount = award(session, game, winner, players.some((p) => p.bot));
  await msg?.edit(render(`${why}${I.crown} **${mention(winner)} فاز!** (+${amount} نقطة)`, true)).catch(() => null);
}

module.exports = { rps, xo, minimax, winnerOf };
