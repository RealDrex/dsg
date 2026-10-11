// Group elimination games: lobby → rounds → last player standing wins.
const { MessageFlags } = require('discord.js');
const { I } = require('../../core/icons');
const { simple, DIVIDER } = require('../../core/theme');
const { lobby, finish, button, rows, pick, rand, mention, matches, clean, cfgOf, post, points, ButtonStyle, art, AttachmentBuilder } = require('./engine');
const { WORDS } = require('./data');
const shop = require('./shop');

const S = ButtonStyle;
const ends = (seconds) => `<t:${Math.floor(Date.now() / 1000) + seconds}:R>`;
const note = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
const without = (list, gone) => list.filter((p) => !gone.some((g) => g.id === p.id));

async function out(session, game, players, why) {
  if (!players.length) return;
  await session.say(`${I.skull} ${players.map(mention).join(' ، ')} — ${why}`, { title: game.name, icon: I[game.icon], color: 'accent' });
}

async function done(session, game, alive) {
  if (!session.active) return;
  await finish(session, game, alive.length === 1 ? alive[0] : null, cfgOf(session.guildId).groupWin);
}

// ── روليت / روليتز ────────────────────────────────────────────────
// Spins the wheel: sends the animated GIF, lets it land, then returns the message
// (which freezes on the chosen slice). `extra` is edited in afterwards (text + buttons).
async function spin(session, order, index, round) {
  const head = `${I.roulette} **الجولة ${round}** — ${order.length} لاعبين`;
  try {
    const gif = new AttachmentBuilder(await art.spinGif(order, index, { title: `الجولة ${round}` }), { name: 'wheel.gif' });
    const msg = await session.send({ content: `${head}\nالعجلة تدور...`, files: [gif] });
    await session.sleep(2800); // let the GIF settle on the winner
    return { msg };
  } catch {
    const png = new AttachmentBuilder(await art.wheel(order, index, { title: `الجولة ${round}` }), { name: 'wheel.png' });
    const msg = await session.send({ content: head, files: [png] });
    return { msg };
  }
}

// Updates the spin message in place: new text + optional buttons (keeps the wheel image, no embed).
const settle = ({ msg }, text, components = []) => msg?.edit({ content: text, components }).catch(() => null);

async function roulette(session, interaction, game, { random = false } = {}) {
  let alive = await lobby(session, interaction, {
    game,
    imageOnly: true,
    rules: random
      ? 'كل جولة تدور العجلة وتوقف على لاعب **يطلع على طول**. حظ خالص — آخر واحد يبقى يفوز.'
      : 'كل جولة تدور العجلة وتوقف على لاعب، وهو **يختار مين يطرد**. إذا ما اختار خلال 20 ثانية يطلع هو. آخر واحد يبقى يفوز.',
  });
  if (!alive) return;
  for (let round = 1; alive.length > 1 && session.active; round += 1) {
    const order = [...alive]; // wheel order = button numbers
    const index = rand(order.length);
    const chosen = order[index];
    const spun = await spin(session, order, index, round);
    if (!session.active) return;
    if (random) {
      await settle(spun, `${I.rouletteZ} وقفت العجلة على ${mention(chosen)} — **طلع من اللعبة**`);
      shop.recordDeath(session.guildId, chosen.id);
      alive = without(alive, [chosen]);
      await out(session, game, [chosen], 'وقفت عليه العجلة');
      await session.sleep(1500);
      continue;
    }
    const choices = order.map((p, n) => ({ p, n })).filter(({ p }) => p.id !== chosen.id).slice(0, 22)
      .map(({ p, n }) => button(session.cid('kick', p.id), `${n + 1}  ${p.name}`));
    choices.push(button(session.cid('kick', 'random'), 'عشوائي', S.Primary, I.dice));
    choices.push(button(session.cid('kick', 'self'), 'انسحاب', S.Danger, I.leave));
    await settle(spun, `${mention(chosen)}، لديك **20 ثانية** لاختيار شخص لطرده.`, rows(choices));
    const i = await session.waitComponent({ time: 20_000, accept: (x) => x.user.id === chosen.id, deny: 'مو أنت اللي وقفت عليه العجلة' });
    if (!session.active) return;
    const others = without(alive, [chosen]);
    let gone;
    let why;
    const id = i && session.part(i, 3);
    if (!i) {
      gone = chosen;
      why = 'ما اختار أحد، فطلع هو';
    } else if (id === 'self') {
      gone = chosen;
      why = 'انسحب من اللعبة';
    } else {
      gone = id === 'random' ? pick(others) : others.find((p) => p.id === id) || pick(others);
      why = `طرده ${mention(chosen)}`;
    }
    if (i) await i.update({ components: [] }).catch(() => null);
    else await spun.msg?.edit({ components: [] }).catch(() => null);
    shop.recordDeath(session.guildId, gone.id);
    if (gone.id !== chosen.id) shop.recordKill(session.guildId, chosen.id);
    alive = without(alive, [gone]);
    await out(session, game, [gone], why);
    await session.sleep(1500);
  }
  await done(session, game, alive);
}

// ── عكسي: اكتب الكلمة بالمقلوب ───────────────────────────────────
async function reverse(session, interaction, game) {
  let alive = await lobby(session, interaction, {
    game,
    rules: 'كل جولة تطلع كلمة، اكتبها **بالمقلوب** (من آخر حرف لأول حرف) خلال 15 ثانية.\nاللي يغلط أو ما يكتب يطلع، وإذا الكل صح يطلع **أبطأ واحد**.',
  });
  if (!alive) return;
  while (alive.length > 1 && session.active) {
    const word = pick(WORDS);
    const reversed = [...word].reverse().join('');
    await session.say(`اكتبها بالمقلوب:\n# ${word}\nينتهي ${ends(15)}`, { title: game.name, icon: I[game.icon] });
    const passed = [];
    const ids = new Set(alive.map((p) => p.id));
    await new Promise((resolve) => {
      const c = session.messages({ time: 15_000, filter: (m) => ids.has(m.author.id) });
      c.on('collect', (m) => {
        if (!passed.includes(m.author.id) && matches(m.content, [reversed])) passed.push(m.author.id);
        if (passed.length === alive.length) c.stop('all');
      });
      c.once('end', resolve);
    });
    if (!session.active) return;
    const failed = alive.filter((p) => !passed.includes(p.id));
    if (failed.length === alive.length) {
      await session.say(`محد جاوب صح! الجواب: **${reversed}** — نعيد الجولة`, { color: 'warn' });
      continue;
    }
    const gone = failed.length ? failed : [alive.find((p) => p.id === passed[passed.length - 1])];
    alive = without(alive, gone);
    await out(session, game, gone, failed.length ? `ما كتبوها صح (الجواب: **${reversed}**)` : 'أبطأ واحد');
    await session.sleep(1500);
  }
  await done(session, game, alive);
}

// ── سكات ─────────────────────────────────────────────────────────
async function silence(session, interaction, game) {
  let alive = await lobby(session, interaction, {
    game,
    rules: 'البوت بيقول **تكلم** أو **سكات**:\n▸ **تكلم:** لازم تكتب أي رسالة خلال 5 ثواني (وأبطأ واحد يطلع)\n▸ **سكات:** أي أحد يكتب خلال 5 ثواني يطلع\nآخر واحد يبقى يفوز.',
  });
  if (!alive) return;
  while (alive.length > 1 && session.active) {
    await session.sleep(2000 + rand(3000));
    if (!session.active) return;
    const speak = rand(2) === 0;
    await session.say(`# ${speak ? 'تكلم!' : 'سكات!'}`, { color: speak ? 'success' : 'accent' });
    const spoke = []; // in order
    const ids = new Set(alive.map((p) => p.id));
    await new Promise((resolve) => {
      const c = session.messages({ time: 5000, filter: (m) => ids.has(m.author.id) });
      c.on('collect', (m) => { if (!spoke.includes(m.author.id)) spoke.push(m.author.id); });
      c.once('end', resolve);
    });
    if (!session.active) return;
    let gone = alive.filter((p) => (speak ? !spoke.includes(p.id) : spoke.includes(p.id)));
    let why = speak ? 'ما تكلموا' : 'تكلموا وقت السكات';
    if (gone.length === alive.length) {
      await session.say('الكل غلط — محد يطلع هالجولة', { color: 'warn' });
      continue;
    }
    if (speak && !gone.length) {
      // Everyone talked: the slowest one goes, so the game always moves forward.
      gone = [alive.find((p) => p.id === spoke[spoke.length - 1])];
      why = 'أبطأ واحد تكلم';
    }
    alive = without(alive, gone);
    if (gone.length) await out(session, game, gone, why);
    else await session.say('الكل نجا!', { color: 'success' });
  }
  await done(session, game, alive);
}

// ── وصل: سلسلة كلمات ─────────────────────────────────────────────
function lastLetter(word) {
  const letters = [...clean(word)];
  let ch = letters.pop();
  if (ch === 'ء' && letters.length) ch = letters.pop();
  return ch;
}

async function chain(session, interaction, game) {
  let alive = await lobby(session, interaction, {
    game,
    rules: 'بالدور: كل لاعب يكتب كلمة تبدأ **بآخر حرف** من الكلمة اللي قبلها.\nالكلمات ما تتكرر، واللي يتأخر يطلع. الوقت يقل كل دور!',
  });
  if (!alive) return;
  let word = pick(WORDS);
  const used = new Set([clean(word)]);
  let turn = 0;
  let time = 20;
  while (alive.length > 1 && session.active) {
    const player = alive[turn % alive.length];
    const letter = lastLetter(word);
    await session.say(`الكلمة: **${word}**\nدور ${mention(player)} — اكتب كلمة تبدأ بحرف **${letter}**\nينتهي ${ends(time)}`, { title: game.name, icon: I[game.icon] });
    const reply = await session.waitMessage({
      time: time * 1000,
      filter: (m) => {
        if (m.author.id !== player.id) return false;
        const w = m.content.trim();
        const c = clean(w);
        return /^[ء-ي]{2,}$/.test(w.replace(/[ً-ْـ]/g, '')) && c[0] === letter && !used.has(c);
      },
    });
    if (!session.active) return;
    if (!reply) {
      alive = without(alive, [player]);
      await out(session, game, [player], 'خلص وقته');
      continue; // same index now points to the next player
    }
    word = reply.content.trim();
    used.add(clean(word));
    turn += 1;
    time = Math.max(8, time - 1);
  }
  await done(session, game, alive);
}

// ── لغم ───────────────────────────────────────────────────────────
async function mine(session, interaction, game) {
  let alive = await lobby(session, interaction, {
    game,
    rules: 'بالدور: كل لاعب يفتح مربع من 20. واحد منها فيه **لغم** — اللي يفتحه يطلع وتبدأ لوحة جديدة.\nاللي يتأخر 15 ثانية يطلع.',
  });
  if (!alive) return;
  const TILES = 20;
  let mineAt = rand(TILES);
  let opened = new Set();
  let turn = 0;
  let board = null;
  const render = (player, reveal = false) => ({
    embeds: [simple(player ? `دور ${mention(player)} — افتح مربع (ينتهي ${ends(15)})` : `${I.mine} انفجر اللغم!`, player ? 'primary' : 'accent', game.name)],
    components: rows(Array.from({ length: TILES }, (_, t) => {
      if (reveal && t === mineAt) return button(session.cid('tile', t), null, S.Danger, I.mine, true);
      if (opened.has(t)) return button(session.cid('tile', t), null, S.Success, I.success, true);
      return button(session.cid('tile', t), String(t + 1), S.Secondary, null, reveal);
    })),
  });
  while (alive.length > 1 && session.active) {
    const player = alive[turn % alive.length];
    if (board) await board.edit(render(player)).catch(() => null);
    else board = await session.send(render(player));
    const i = await session.waitComponent({ time: 15_000, accept: (x) => x.user.id === player.id, deny: 'مو دورك' });
    if (!session.active) return;
    if (!i) {
      alive = without(alive, [player]);
      await out(session, game, [player], 'تأخر');
      continue;
    }
    const tile = Number(session.part(i, 3));
    if (tile === mineAt) {
      await i.update(render(null, true)).catch(() => null);
      alive = without(alive, [player]);
      await out(session, game, [player], 'داس على اللغم');
      mineAt = rand(TILES);
      opened = new Set();
      board = null;
      continue;
    }
    opened.add(tile);
    await i.deferUpdate().catch(() => null);
    if (opened.size === TILES - 1) {
      mineAt = rand(TILES);
      opened = new Set();
    }
    turn += 1;
  }
  await done(session, game, alive);
}

// ── بومب ──────────────────────────────────────────────────────────
async function bomb(session, interaction, game) {
  let alive = await lobby(session, interaction, {
    game,
    rules: 'القنبلة تنتقل بين اللاعبين. إذا صارت معك **مررها بسرعة** لغيرك بالأزرار.\nمحد يعرف متى تنفجر — اللي ماسكها لحظة الانفجار يطلع.',
  });
  if (!alive) return;
  while (alive.length > 1 && session.active) {
    let holder = pick(alive);
    const render = () => ({
      embeds: [simple(`${I.nuke} القنبلة مع ${mention(holder)}! مررها بسرعة`, 'accent', game.name)],
      components: rows(without(alive, [holder]).slice(0, 25).map((p) => button(session.cid('pass', p.id), p.name, S.Secondary, I.send))),
    });
    const msg = await session.send(render());
    await new Promise((resolve) => {
      const c = session.components({ time: 10_000 + rand(20_000) });
      c.on('collect', async (i) => {
        if (i.user.id !== holder.id) return note(i, 'القنبلة مو معك');
        const target = alive.find((p) => p.id === session.part(i, 3));
        if (!target) return i.deferUpdate().catch(() => null);
        holder = target;
        await i.update(render()).catch(() => null);
      });
      c.once('end', resolve);
    });
    if (!session.active) return;
    await msg?.edit({ embeds: [simple(`${I.nuke} **بووم!** انفجرت مع ${mention(holder)}`, 'accent', game.name)], components: [] }).catch(() => null);
    alive = without(alive, [holder]);
    await out(session, game, [holder], 'انفجرت معه القنبلة');
    await session.sleep(1500);
  }
  await done(session, game, alive);
}

// ── كراسي ────────────────────────────────────────────────────────
async function chairs(session, interaction, game) {
  let alive = await lobby(session, interaction, {
    game,
    rules: 'كل جولة تطلع كراسي **أقل بواحد** من عدد اللاعبين.\nأول ما تطلع الأزرار اضغط على كرسي — اللي يظل واقف يطلع!',
  });
  if (!alive) return;
  let idle = 0;
  while (alive.length > 1 && session.active) {
    const msg = await session.say('استعدوا... الموسيقى شغالة', { title: game.name, icon: I[game.icon] });
    await session.sleep(2000 + rand(4000));
    if (!session.active) return;
    const count = alive.length - 1;
    const seats = new Map(); // chair -> player
    const render = () => rows(Array.from({ length: Math.min(count, 25) }, (_, c) => {
      const p = seats.get(c);
      return p ? button(session.cid('chair', c), p.name, S.Success, null, true) : button(session.cid('chair', c), null, S.Secondary, I.chairs);
    }));
    await msg?.edit({ embeds: [simple('# اقعدوا!', 'accent', game.name)], components: render() }).catch(() => null);
    const ids = new Set(alive.map((p) => p.id));
    await new Promise((resolve) => {
      const c = session.components({ time: 10_000 });
      c.on('collect', async (i) => {
        if (!ids.has(i.user.id)) return note(i, 'أنت مو باللعبة');
        if ([...seats.values()].some((p) => p.id === i.user.id)) return note(i, 'أنت قاعد أصلاً');
        const chair = Number(session.part(i, 3));
        if (seats.has(chair)) return note(i, 'الكرسي مأخوذ');
        seats.set(chair, alive.find((p) => p.id === i.user.id));
        await i.update({ components: render() }).catch(() => null);
        if (seats.size >= count) c.stop('full');
      });
      c.once('end', resolve);
    });
    if (!session.active) return;
    const seated = new Set([...seats.values()].map((p) => p.id));
    if (!seated.size) {
      idle += 1;
      if (idle >= 2) return session.say('محد يلعب — انلغت اللعبة', { color: 'warn' });
      continue;
    }
    idle = 0;
    const gone = alive.filter((p) => !seated.has(p.id));
    alive = without(alive, gone);
    await out(session, game, gone, 'ظل واقف');
    await session.sleep(1500);
  }
  await done(session, game, alive);
}

// ── نرد ───────────────────────────────────────────────────────────
async function dice(session, interaction, game) {
  let alive = await lobby(session, interaction, { game, rules: 'كل جولة الكل يرمي **نردين**، وأقل مجموع يطلع. آخر واحد يبقى يفوز.' });
  if (!alive) return;
  while (alive.length > 1 && session.active) {
    const rolls = alive.map((p) => ({ p, a: 1 + rand(6), b: 1 + rand(6) }));
    const low = Math.min(...rolls.map((r) => r.a + r.b));
    const lines = rolls.sort((x, y) => y.a + y.b - (x.a + x.b))
      .map((r) => `${mention(r.p)} — \`[${r.a}]\` \`[${r.b}]\` = **${r.a + r.b}**`);
    await session.say(lines.join('\n'), { title: `${game.name} — الرمية`, icon: I.dice });
    await session.sleep(3000);
    if (!session.active) return;
    const gone = rolls.filter((r) => r.a + r.b === low).map((r) => r.p);
    if (gone.length === alive.length) {
      await session.say('تعادل! نعيد الرمية', { color: 'warn' });
      continue;
    }
    alive = without(alive, gone);
    await out(session, game, gone, `أقل مجموع (${low})`);
    await session.sleep(1500);
  }
  await done(session, game, alive);
}

// ── هايد ──────────────────────────────────────────────────────────
// Everyone hides behind a numbered button, then players take turns searching one button each.
async function hide(session, interaction, game) {
  let alive = await lobby(session, interaction, {
    game,
    rules: 'كل لاعب يتخبى ورا زر من **1** إلى **12** (محد يشوف اختيارك).\nبعدها بالدور، كل لاعب يختار زر يدور فيه — اللي يكون مختبي فيه يطلع. آخر واحد يبقى يفوز.',
  });
  if (!alive) return;
  const SPOTS = 12;
  const hidden = new Map();
  const ids = new Set(alive.map((p) => p.id));
  const hideMsg = await session.send({
    embeds: [simple(`تخبوا! اختار رقم تتخبى وراه — ينتهي ${ends(20)}`, 'primary', `${I.hideSeek} ${game.name}`)],
    components: rows(Array.from({ length: SPOTS }, (_, n) => button(session.cid('spot', n), String(n + 1))), 3),
  });
  await new Promise((resolve) => {
    const c = session.components({ time: 20_000, filter: (i) => session.part(i) === 'spot' });
    c.on('collect', (i) => {
      if (!ids.has(i.user.id)) return note(i, 'أنت مو باللعبة');
      const n = Number(session.part(i, 3));
      hidden.set(i.user.id, n);
      note(i, `تخبيت ورا الزر رقم **${n + 1}**`);
      if (hidden.size === alive.length) c.stop('all');
    });
    c.once('end', resolve);
  });
  if (!session.active) return;
  await hideMsg?.edit({ components: [] }).catch(() => null);
  const lazy = alive.filter((p) => !hidden.has(p.id));
  if (lazy.length === alive.length) return session.say('محد تخبى — انلغت اللعبة', { color: 'warn' });
  if (lazy.length) {
    alive = without(alive, lazy);
    await out(session, game, lazy, 'ما تخبوا');
  }

  const searched = new Set();
  let turn = 0;
  let last = '';
  while (alive.length > 1 && session.active) {
    const seeker = alive[turn % alive.length];
    const board = await session.send({
      embeds: [simple(`${last}${mention(seeker)} اختر زر للبحث عن اللاعبين المختبئين!\nاللاعبين المتبقين: **${alive.length}** • ينتهي ${ends(20)}`, 'primary', `${I.hideSeek} ${game.name}`)],
      components: rows(Array.from({ length: SPOTS }, (_, n) => button(session.cid('seek', n), String(n + 1), searched.has(n) ? S.Danger : S.Secondary, null, searched.has(n))), 3),
    });
    const i = await session.waitComponent({ time: 20_000, accept: (x) => x.user.id === seeker.id && session.part(x) === 'seek', deny: 'مو دورك تدور' });
    if (!session.active) return;
    const open = Array.from({ length: SPOTS }, (_, n) => n).filter((n) => !searched.has(n));
    const spot = i ? Number(session.part(i, 3)) : pick(open);
    if (i) await i.update({ components: [] }).catch(() => null);
    else await board?.edit({ components: [] }).catch(() => null);
    searched.add(spot);
    const found = alive.filter((p) => p.id !== seeker.id && hidden.get(p.id) === spot);
    const who = i ? `اللاعب ${mention(seeker)}` : `${mention(seeker)} تأخر، فالبوت دور بداله و`;
    if (found.length) {
      alive = without(alive, found);
      last = `${I.skull} ${who} وجد ${found.map(mention).join(' ، ')} في الزر رقم **${spot + 1}**!\n`;
    } else {
      last = `${who} لم يجد أي لاعبين في الزر رقم **${spot + 1}**.\n`;
    }
    if (alive.length > 1) turn = (alive.findIndex((p) => p.id === seeker.id) + 1) % alive.length;
    if (searched.size === SPOTS) searched.clear(); // everyone left shares a spot with a seeker; start over
  }
  if (last && session.active) await session.say(last.trim(), { title: game.name, icon: I.hideSeek });
  await done(session, game, alive);
}

// ── خمن ───────────────────────────────────────────────────────────
async function guess(session, interaction, game) {
  const target = 1 + rand(100);
  await post(interaction, { embeds: [simple(`اخترت رقم من **1** إلى **100** — خمنوا!\nأول واحد يعرفه يفوز • ينتهي ${ends(60)}`, 'primary', `${I.guess} ${game.name}`)] });
  const winner = await new Promise((resolve) => {
    const c = session.messages({ time: 60_000, filter: (m) => /^\d{1,3}$/.test(clean(m.content)) });
    c.on('collect', (m) => {
      const n = Number(clean(m.content));
      if (n === target) {
        c.stop('won');
        resolve(m);
      } else {
        m.reply({ content: n < target ? 'أكبر' : 'أصغر', allowedMentions: { repliedUser: false } }).catch(() => null);
      }
    });
    c.once('end', (_, reason) => { if (reason !== 'won') resolve(null); });
  });
  if (!session.active) return;
  if (!winner) return session.say(`انتهى الوقت! الرقم كان **${target}**`, { color: 'warn' });
  const amount = cfgOf(session.guildId).duelWin;
  points.award(session.guildId, winner.author.id, game.key, amount);
  await session.say(`${I.crown} ${mention(winner.author)} عرف الرقم **${target}**!\n${I.coins} **+${amount}** نقطة`, { title: game.name, icon: I.trophy, color: 'success' });
}

// ── ازرار ─────────────────────────────────────────────────────────
async function buttons(session, interaction, game) {
  const players = await lobby(session, interaction, {
    game,
    rules: '5 جولات: تطلع أزرار رمادية، وفجأة واحد منها يصير **أخضر**.\nأول واحد يضغطه ياخذ نقطة — واللي يضغط رمادي يتجمد بهالجولة.',
  });
  if (!players) return;
  const score = new Map(players.map((p) => [p.id, 0]));
  const ids = new Set(players.map((p) => p.id));
  const COUNT = 15;
  for (let round = 1; round <= 5 && session.active; round += 1) {
    const msg = await session.send({
      embeds: [simple(`الجولة **${round}/5** — استعدوا...`, 'primary', game.name)],
      components: rows(Array.from({ length: COUNT }, (_, n) => button(session.cid('b', round, n), null, S.Secondary, null, true))),
    });
    await session.sleep(2000 + rand(4000));
    if (!session.active) return;
    const target = rand(COUNT);
    await msg?.edit({
      embeds: [simple(`الجولة **${round}/5** — اضغط الأخضر!`, 'success', game.name)],
      components: rows(Array.from({ length: COUNT }, (_, n) => button(session.cid('b', round, n), null, n === target ? S.Success : S.Secondary))),
    }).catch(() => null);
    const frozen = new Set();
    const winner = await new Promise((resolve) => {
      const c = session.components({ time: 8000, filter: (i) => session.part(i, 3) === String(round) });
      c.on('collect', async (i) => {
        if (!ids.has(i.user.id)) return note(i, 'أنت مو باللعبة');
        if (frozen.has(i.user.id)) return note(i, 'أنت متجمد هالجولة');
        if (Number(session.part(i, 4)) !== target) {
          frozen.add(i.user.id);
          return note(i, 'غلط! تجمدت هالجولة');
        }
        c.stop('won');
        await i.update({ components: [] }).catch(() => null);
        resolve(players.find((p) => p.id === i.user.id));
      });
      c.once('end', (_, reason) => { if (reason !== 'won') resolve(null); });
    });
    if (!session.active) return;
    if (!winner) await msg?.edit({ components: [] }).catch(() => null);
    if (winner) score.set(winner.id, score.get(winner.id) + 1);
    await session.say(winner ? `${mention(winner)} أسرع واحد!` : 'محد ضغط', { color: winner ? 'success' : 'warn' });
  }
  if (!session.active) return;
  const best = Math.max(...score.values());
  const board = [...score].sort((a, b) => b[1] - a[1]).map(([id, s]) => `<@${id}> — **${s}**`).join('\n');
  await session.say(`${board}\n${DIVIDER}`, { title: `${game.name} — النتيجة`, icon: I.trophy });
  await finish(session, game, best > 0 ? players.filter((p) => score.get(p.id) === best) : null, cfgOf(session.guildId).groupWin);
}

module.exports = {
  roulette: (s, i, g) => roulette(s, i, g),
  rouletteZ: (s, i, g) => roulette(s, i, g, { random: true }),
  reverse, silence, chain, mine, bomb, chairs, dice, hide, guess, buttons,
};
