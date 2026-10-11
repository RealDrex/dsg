// مافيا: hidden roles, private night actions (ephemeral menus) and public day votes.
const { MessageFlags, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { I } = require('../../core/icons');
const { simple, DIVIDER } = require('../../core/theme');
const { lobby, finish, button, rows, pick, shuffle, mention, cfgOf, ButtonStyle } = require('./engine');

const ROLES = {
  mafia: { name: 'مافيا', icon: 'mafia', desc: 'كل ليلة تختار مع فريقك شخص تقتله. لا تنكشف بالنهار!' },
  doctor: { name: 'طبيب', icon: 'heal', desc: 'كل ليلة تختار شخص تحميه من القتل (تقدر تحمي نفسك).' },
  detective: { name: 'محقق', icon: 'hideSeek', desc: 'كل ليلة تحقق في شخص وتعرف إذا كان مافيا.' },
  citizen: { name: 'مواطن', icon: 'user', desc: 'ما عندك إجراء بالليل — ساعد في كشف المافيا بالتصويت.' },
};
const NIGHT = 45;
const DAY = 60;
const ends = (seconds) => `<t:${Math.floor(Date.now() / 1000) + seconds}:R>`;
const eph = (i, content, extra = {}) => i.reply({ content, flags: MessageFlags.Ephemeral, ...extra }).catch(() => null);

function select(customId, placeholder, players, extra = []) {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .addOptions([...players.slice(0, 24).map((p) => ({ label: p.name.slice(0, 100), value: p.id })), ...extra]));
}

function tallyTop(votes) {
  const counts = new Map();
  for (const v of votes.values()) counts.set(v, (counts.get(v) || 0) + 1);
  const max = Math.max(0, ...counts.values());
  return { top: [...counts].filter(([, c]) => c === max).map(([id]) => id), max, counts };
}

async function mafia(session, interaction, game) {
  const players = await lobby(session, interaction, {
    game,
    min: 4,
    max: 16,
    rules: 'لعبة أدوار سرية: **مافيا** ضد **المواطنين** (فيهم **طبيب** و**محقق**).\n▸ بالليل: أصحاب الأدوار يسوون إجراءاتهم بسرية\n▸ بالنهار: الكل يتناقش ويصوت مين يطرد\nيفوز المواطنين إذا طردوا كل المافيا، وتفوز المافيا إذا صاروا نص الأحياء.',
  });
  if (!players) return;

  // Deal roles.
  const role = new Map();
  const mafiaCount = Math.max(1, Math.floor(players.length / 4));
  shuffle(players).forEach((p, n) => {
    let r = 'citizen';
    if (n < mafiaCount) r = 'mafia';
    else if (n === mafiaCount && players.length >= 5) r = 'doctor';
    else if (n === mafiaCount + 1 && players.length >= 6) r = 'detective';
    role.set(p.id, r);
  });
  let alive = [...players];
  const isAlive = (id) => alive.some((p) => p.id === id);
  const team = (r) => players.filter((p) => role.get(p.id) === r);

  // Role reveal works for the whole game.
  const reveal = session.components({ time: 3_600_000, filter: (i) => session.part(i) === 'role' });
  reveal.on('collect', (i) => {
    const r = role.get(i.user.id);
    if (!r) return eph(i, 'أنت مو باللعبة');
    const info = ROLES[r];
    const mates = r === 'mafia' ? `\nفريقك: ${team('mafia').map(mention).join(' ')}` : '';
    return eph(i, `${I[info.icon]} دورك: **${info.name}**\n${info.desc}${mates}${isAlive(i.user.id) ? '' : '\n(أنت ميت — شاهد بس)'}`);
  });
  await session.send({
    content: simple(`الأدوار انوزعت على ${players.length} لاعبين (${mafiaCount} مافيا).\nاضغط الزر تحت عشان تشوف دورك بسرية — الليل يبدأ ${ends(20)}`, 'primary', `${I.mafia} ${game.name}`),
    components: rows([button(session.cid('role'), 'شوف دورك', ButtonStyle.Primary, I.mafia)]),
  });
  await session.sleep(20_000);

  const winner = () => {
    const m = alive.filter((p) => role.get(p.id) === 'mafia').length;
    if (m === 0) return 'citizens';
    if (m >= alive.length - m) return 'mafia';
    return null;
  };

  const MAX_ROUNDS = 15;
  let lastSaved = null; // the doctor can't protect the same player two nights in a row
  let round = 1;
  for (; session.active && !winner() && round <= MAX_ROUNDS; round += 1) {
    // ── Night ──
    const kills = new Map();
    let saved = null;
    const investigated = new Set();
    const actors = alive.filter((p) => role.get(p.id) !== 'citizen');
    const acted = new Set();
    await session.send({
      content: simple(`${I.moon} **الليلة ${round}** — المدينة نايمة...\nأصحاب الأدوار: اضغطوا **إجراء الليل** • ينتهي ${ends(NIGHT)}`, 'dark', game.name),
      components: rows([button(session.cid('night', round), 'إجراء الليل', ButtonStyle.Secondary, I.moon), button(session.cid('role'), 'دوري', ButtonStyle.Secondary, I.mafia)]),
    });
    await new Promise((resolve) => {
      const c = session.components({ time: NIGHT * 1000, filter: (i) => ['night', 'act'].includes(session.part(i)) && session.part(i, 3) === String(round) });
      c.on('collect', async (i) => {
        const r = role.get(i.user.id);
        if (!isAlive(i.user.id)) return eph(i, 'أنت مو من الأحياء');
        if (session.part(i) === 'night') {
          if (r === 'citizen') return eph(i, 'أنت مواطن — ما عندك إجراء، نام زين');
          if (acted.has(i.user.id)) return eph(i, 'سويت إجراءك الليلة');
          const targets = r === 'mafia' ? alive.filter((p) => role.get(p.id) !== 'mafia')
            : r === 'detective' ? alive.filter((p) => p.id !== i.user.id) : alive.filter((p) => p.id !== lastSaved);
          const verb = { mafia: 'مين تقتلون؟', doctor: 'مين تحمي؟', detective: 'مين تحقق فيه؟' }[r];
          return eph(i, `${I[ROLES[r].icon]} ${verb}`, { components: [select(session.cid('act', round), verb, targets)] });
        }
        // act (select menu)
        const target = i.values[0];
        acted.add(i.user.id);
        let msg = 'تم';
        if (r === 'mafia') { kills.set(i.user.id, target); msg = `اخترت تقتل <@${target}>`; }
        if (r === 'doctor') { saved = target; msg = `بتحمي <@${target}> الليلة`; }
        if (r === 'detective' && !investigated.has(i.user.id)) {
          investigated.add(i.user.id);
          msg = `<@${target}> ${role.get(target) === 'mafia' ? '**مافيا!**' : 'مو مافيا'}`;
        }
        await i.update({ content: msg, components: [] }).catch(() => null);
        if (actors.every((a) => acted.has(a.id))) c.stop('all');
      });
      c.once('end', resolve);
    });
    if (!session.active) return;

    lastSaved = saved;
    const { top } = tallyTop(kills);
    const victimId = top.length ? pick(top) : null;
    let morning;
    if (!victimId) morning = 'المافيا ما سوت شي الليلة. محد مات';
    else if (victimId === saved) morning = `${I.heal} المافيا حاولت تقتل أحد، بس **الطبيب أنقذه!**`;
    else {
      alive = alive.filter((p) => p.id !== victimId);
      morning = `${I.skull} لقيوا <@${victimId}> مقتول — كان **${ROLES[role.get(victimId)].name}**`;
    }
    await session.say(morning, { title: `الصباح ${round}`, icon: I.sun });
    if (winner()) break;

    // ── Day vote ──
    const votes = new Map();
    const SKIP = 'skip';
    const dayMsg = await session.send({
      content: simple(`${I.sun} تناقشوا وصوتوا مين تطردون • ينتهي ${ends(DAY)}\nالأحياء: ${alive.map(mention).join(' ')}`, 'primary', `${game.name} — التصويت`),
      components: [select(session.cid('vote', round), 'صوّت لطرد...', alive, [{ label: 'تخطي (محد يطلع)', value: SKIP }])],
    });
    await new Promise((resolve) => {
      const c = session.components({ time: DAY * 1000, filter: (i) => session.part(i) === 'vote' && session.part(i, 3) === String(round) });
      c.on('collect', (i) => {
        if (!isAlive(i.user.id)) return eph(i, 'الأموات ما يصوتون');
        votes.set(i.user.id, i.values[0]);
        eph(i, i.values[0] === SKIP ? 'صوتك: تخطي' : `صوتك: <@${i.values[0]}>`);
        if (votes.size === alive.length) c.stop('all');
      });
      c.once('end', resolve);
    });
    if (!session.active) return;
    await dayMsg?.edit({ components: [] }).catch(() => null);
    const tally = tallyTop(votes);
    const summary = [...tally.counts].sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${id === SKIP ? 'تخطي' : `<@${id}>`} — **${n}**`).join('\n') || 'محد صوت';
    if (tally.top.length !== 1 || tally.top[0] === SKIP) {
      await session.say(`${summary}\n${DIVIDER}\nتعادل أو تخطي — محد طلع`, { title: 'نتيجة التصويت', icon: I.vote, color: 'warn' });
    } else {
      const outId = tally.top[0];
      alive = alive.filter((p) => p.id !== outId);
      await session.say(`${summary}\n${DIVIDER}\n${I.skull} طردتوا <@${outId}> — كان **${ROLES[role.get(outId)].name}**`, { title: 'نتيجة التصويت', icon: I.vote, color: 'accent' });
    }
  }
  if (!session.active) return;
  reveal.stop('end');
  const side = winner();
  if (!side) {
    const roster = players.map((p) => `${I[ROLES[role.get(p.id)].icon]} ${mention(p)} — ${ROLES[role.get(p.id)].name}`).join('\n');
    return session.say(`${roster}\n${DIVIDER}\nخلصت ${MAX_ROUNDS} جولة بدون حسم — تعادل!`, { title: game.name, icon: I.mafia, color: 'warn' });
  }
  const roster = players.map((p) => `${I[ROLES[role.get(p.id)].icon]} ${mention(p)} — ${ROLES[role.get(p.id)].name}${isAlive(p.id) ? '' : ' (ميت)'}`).join('\n');
  await session.say(roster, { title: side === 'mafia' ? 'فازت المافيا!' : 'فاز المواطنين!', icon: side === 'mafia' ? I.mafia : I.trophy, color: side === 'mafia' ? 'accent' : 'success' });
  const winners = players.filter((p) => (side === 'mafia') === (role.get(p.id) === 'mafia'));
  await finish(session, game, winners, cfgOf(session.guildId).duelWin);
}

module.exports = { mafia };
