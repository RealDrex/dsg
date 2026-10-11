// Single-player quiz games: the bot asks, the first correct answer in the channel wins.
const { I } = require('../../core/icons');
const { DIVIDER, simple } = require('../../core/theme');
const { pick, rand, matches, clean, points, cfgOf, mention, AttachmentBuilder } = require('./engine');
const data = require('./data');

const ZWJ = '‍'; // keeps Arabic letters joined but breaks copy-paste answers

const QUIZZES = {
  math() {
    const op = pick(['+', '-', '×', '÷']);
    let a; let b; let answer;
    if (op === '+') { a = 10 + rand(90); b = 10 + rand(90); answer = a + b; }
    if (op === '-') { a = 30 + rand(90); b = 5 + rand(a - 5); answer = a - b; }
    if (op === '×') { a = 2 + rand(11); b = 2 + rand(29); answer = a * b; }
    if (op === '÷') { b = 2 + rand(11); answer = 2 + rand(19); a = b * answer; }
    return { question: `كم ناتج **${a} ${op} ${b}** ؟`, answers: [String(answer)], reveal: String(answer) };
  },
  capitals() {
    const c = pick(data.COUNTRIES);
    return { question: `وش عاصمة **${c.names[0]}** ؟`, answers: c.capitals, reveal: c.capitals[0] };
  },
  merge() {
    const w = pick(data.WORDS);
    return { question: `اشبك الحروف:\n# ${[...w].join(' ')}`, answers: [w], reveal: w };
  },
  fastest() {
    const w = pick(data.WORDS);
    return {
      question: `أسرع واحد يكتب:\n# ${[...w].join(ZWJ)}`,
      check: (content) => !content.includes(ZWJ) && matches(content, [w]),
      reveal: w,
      time: 15,
    };
  },
  complete() {
    const p = pick(data.PROVERBS);
    return { question: `كمّل المثل:\n### ${p.start} ...`, answers: p.endings, reveal: `${p.start} ${p.endings[0]}` };
  },
  split() {
    const w = pick(data.WORDS);
    const target = [...clean(w)].join(' ');
    return {
      question: `فكك الكلمة (حروف بينها مسافات):\n# ${w}`,
      check: (content) => {
        const parts = content.trim().split(/\s+/);
        return parts.length > 1 && parts.every((x) => [...x].length === 1) && parts.map(clean).join(' ') === target;
      },
      reveal: [...w].join(' '),
    };
  },
  flags() {
    const c = pick(data.COUNTRIES);
    return { question: 'وش الدولة صاحبة هذا العلم؟', image: `https://flagcdn.com/w320/${c.iso}.png`, answers: c.names, reveal: c.names[0] };
  },
  next() {
    const kind = pick(['add', 'mul', 'square', 'alt', 'fib']);
    let seq;
    if (kind === 'add') { const s = 1 + rand(20); const d = 2 + rand(11); seq = Array.from({ length: 5 }, (_, i) => s + i * d); }
    if (kind === 'mul') { const s = 1 + rand(4); const r = 2 + rand(2); seq = Array.from({ length: 5 }, (_, i) => s * r ** i); }
    if (kind === 'square') { const s = 1 + rand(6); seq = Array.from({ length: 5 }, (_, i) => (s + i) ** 2); }
    if (kind === 'alt') { const s = 1 + rand(10); const a = 2 + rand(5); const b = 1 + rand(3); seq = [s]; for (let i = 1; i < 5; i += 1) seq.push(seq[i - 1] + (i % 2 ? a : -b)); }
    if (kind === 'fib') { const a = 1 + rand(5); const b = a + 1 + rand(5); seq = [a, b]; for (let i = 2; i < 5; i += 1) seq.push(seq[i - 1] + seq[i - 2]); }
    const answer = seq.pop();
    return { question: `وش الرقم التالي؟\n# ${seq.join(' ، ')} ، ؟`, answers: [String(answer)], reveal: String(answer) };
  },
  plural() {
    const p = pick(data.PLURALS);
    return { question: `وش جمع كلمة **${p.singular}** ؟`, answers: p.plurals, reveal: p.plurals.join(' / ') };
  },
  singular() {
    const p = pick(data.PLURALS);
    return { question: `وش مفرد كلمة **${pick(p.plurals)}** ؟`, answers: [p.singular], reveal: p.singular };
  },
  opposite() {
    const [a, b] = pick(data.OPPOSITES);
    const flip = rand(2) === 1;
    const word = flip ? b : a;
    const answer = flip ? a : b;
    return { question: `وش عكس كلمة **${word}** ؟`, answers: [answer], reveal: answer };
  },
};

async function play(session, interaction, game, post) {
  const cfg = cfgOf(session.guildId);
  const quiz = QUIZZES[game.quiz]();
  const time = quiz.time || cfg.quizTime;
  const endsAt = Math.floor(Date.now() / 1000) + time;
  const check = quiz.check || ((content) => matches(content, quiz.answers));

  const payload = { content: simple(`${quiz.question}\n${DIVIDER}\nينتهي <t:${endsAt}:R>`, 'primary', `${I[game.icon]} ${game.name}`) };
  if (quiz.image) payload.files = [new AttachmentBuilder(quiz.image)];
  await post(interaction, payload);

  const winner = await session.waitMessage({ time: time * 1000, filter: (m) => check(m.content) });
  if (!session.active) return;
  if (!winner) {
    await session.say(`انتهى الوقت! الجواب: **${quiz.reveal}**`, { color: 'warn', title: game.name, icon: I.clock });
    return;
  }
  points.award(session.guildId, winner.author.id, game.key, cfg.quizPoint);
  const total = points.total(session.guildId, winner.author.id);
  await winner.reply({
    content: simple(`${I.success} صح يا ${mention(winner.author)}! **+${cfg.quizPoint}** نقطة\n${I.coins} مجموع نقاطك: \`${total}\``, 'success'),
    allowedMentions: { repliedUser: false },
  }).catch(() => null);
}

async function kt(interaction, post) {
  await post(interaction, { content: simple(`### ${pick(data.KT)}`, 'primary', `${I.kt} كت`) });
}

module.exports = { QUIZZES, play, kt };
