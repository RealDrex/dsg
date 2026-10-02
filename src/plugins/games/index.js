// Sword Games: group elimination games, 1v1 duels, quick quizzes, points and polls.
const { SlashCommandBuilder } = require('discord.js');
const { register, normalize } = require('../../core/i18n');
const { I } = require('../../core/icons');
const { card, simple, reply, bar, DIVIDER } = require('../../core/theme');
const engine = require('./engine');
const group = require('./group');
const duel = require('./duel');
const quiz = require('./quiz');
const { mafia } = require('./mafia');

const { run, post, points, current, canStop, mention, button, rows } = engine;

// key: English id (points table + i18n), name: Arabic command
const GAMES = [
  // group
  { key: 'roulette', name: 'روليت', icon: 'roulette', kind: 'group', desc: 'العجلة توقف على لاعب ويختار مين يطرد', play: group.roulette },
  { key: 'roulettez', name: 'روليتز', icon: 'rouletteZ', kind: 'group', desc: 'روليت الحظ: اللي توقف عليه العجلة يطلع', play: group.rouletteZ },
  { key: 'reverse', name: 'عكسي', icon: 'reverse', kind: 'group', desc: 'اكتب الكلمة بالمقلوب — الغلطان والأبطأ يطلع', play: group.reverse },
  { key: 'silence', name: 'سكات', icon: 'silence', kind: 'group', desc: 'تكلم أو سكات — اللي يغلط يطلع', play: group.silence },
  { key: 'chain', name: 'وصل', icon: 'chain', kind: 'group', desc: 'سلسلة كلمات: كل كلمة تبدأ بآخر حرف اللي قبلها', play: group.chain },
  { key: 'mine', name: 'لغم', icon: 'mine', kind: 'group', desc: 'افتح مربع بالدور — اللي يفتح اللغم يطلع', play: group.mine },
  { key: 'bomb', name: 'بومب', icon: 'nuke', kind: 'group', desc: 'مرر القنبلة قبل لا تنفجر معك', play: group.bomb },
  { key: 'chairs', name: 'كراسي', icon: 'chairs', kind: 'group', desc: 'الكراسي الموسيقية — اللي يظل واقف يطلع', play: group.chairs },
  { key: 'dice', name: 'نرد', icon: 'dice', kind: 'group', desc: 'الكل يرمي نردين — أقل مجموع يطلع', play: group.dice },
  { key: 'hideseek', name: 'هايد', icon: 'hideSeek', kind: 'group', desc: 'تخبى في مكان — اللي ينلقى يطلع', play: group.hide },
  { key: 'guess', name: 'خمن', icon: 'guess', kind: 'group', desc: 'خمن الرقم من 1 إلى 100', play: group.guess },
  { key: 'mafia', name: 'مافيا', icon: 'mafia', kind: 'group', desc: 'أدوار سرية: مافيا ضد مواطنين', play: (s, i, g) => mafia(s, i, g) },
  { key: 'rps', name: 'حجره', icon: 'rps', kind: 'duel', desc: 'حجرة ورقة مقص ضد عضو أو ضد البوت', play: duel.rps },
  { key: 'xo', name: 'اكس', icon: 'xo', kind: 'duel', desc: 'اكس او ضد عضو أو ضد البوت', play: duel.xo },
  { key: 'buttons', name: 'ازرار', icon: 'buttonsGame', kind: 'group', desc: 'أسرع واحد يضغط الزر الأخضر', play: group.buttons },
  // single (quiz)
  { key: 'math', name: 'حساب', icon: 'math', kind: 'quiz', desc: 'سؤال رياضيات سريع' },
  { key: 'capitals', name: 'عواصم', icon: 'capital', kind: 'quiz', desc: 'خمن عاصمة الدولة' },
  { key: 'merge', name: 'اشبك', icon: 'merge', kind: 'quiz', desc: 'اشبك الحروف وكوّن الكلمة' },
  { key: 'kt', name: 'كت', icon: 'kt', kind: 'kt', desc: 'سؤال كت للنقاش' },
  { key: 'fastest', name: 'اسرع', icon: 'fast', kind: 'quiz', desc: 'أسرع واحد يكتب الكلمة' },
  { key: 'complete', name: 'كمل', icon: 'complete', kind: 'quiz', desc: 'كمّل المثل' },
  { key: 'split', name: 'فكك', icon: 'split', kind: 'quiz', desc: 'فكك الكلمة لحروف' },
  { key: 'flags', name: 'اعلام', icon: 'flag', kind: 'quiz', desc: 'خمن الدولة من علمها' },
  { key: 'next', name: 'التالي', icon: 'next', kind: 'quiz', desc: 'وش الرقم التالي في السلسلة؟' },
  { key: 'plural', name: 'جمع', icon: 'plural', kind: 'quiz', desc: 'وش جمع الكلمة؟' },
  { key: 'opposite', name: 'عكس', icon: 'opposite', kind: 'quiz', desc: 'وش عكس الكلمة؟' },
  { key: 'singular', name: 'مفرد', icon: 'singular', kind: 'quiz', desc: 'وش مفرد الكلمة؟' },
];
const QUIZ_MAP = { math: 'math', capitals: 'capitals', merge: 'merge', fastest: 'fastest', complete: 'complete', split: 'split', flags: 'flags', next: 'next', plural: 'plural', opposite: 'opposite', singular: 'singular' };
const byKey = new Map(GAMES.map((g) => [g.key, g]));

register({
  commands: {
    ...Object.fromEntries(GAMES.map((g) => [g.key, g.name])),
    gtop: 'توب', points: 'نقاطي', transfer: 'تحويل', vote: 'تصويت', gstop: 'ايقاف',
  },
  words: { game: 'اللعبة', question: 'السؤال' },
});

const findGame = (value) => {
  if (!value) return null;
  const n = normalize(value);
  return byKey.get(value) || GAMES.find((g) => normalize(g.name) === n || normalize(g.key) === n) || null;
};

// ── Game commands ─────────────────────────────────────────────────
function gameCommand(game) {
  const label = { group: 'لعبة جماعية', duel: 'تحدي', quiz: 'لعبة فردية', kt: 'سؤال' }[game.kind];
  const data = new SlashCommandBuilder().setName(game.key).setDescription(`${label}: ${game.desc}`.slice(0, 100));
  if (game.kind === 'duel') data.addUserOption((o) => o.setName('user').setDescription('خصمك (فاضي = ضد البوت)'));
  return {
    data,
    async execute(interaction) {
      if (game.kind === 'kt') return quiz.kt(interaction, post);
      if (game.kind === 'quiz') {
        game.quiz = QUIZ_MAP[game.key];
        return run(interaction, game, (s) => quiz.play(s, interaction, game, post), { reply });
      }
      return run(interaction, game, (s) => game.play(s, interaction, game, { reply }), { reply });
    },
  };
}

// ── توب / نقاطي / تحويل ──────────────────────────────────────────
const gameChoice = (o) => o.setName('game').setDescription('اسم اللعبة (فاضي = كل الألعاب)').setAutocomplete(true);

const topCommand = {
  data: new SlashCommandBuilder().setName('gtop').setDescription('توب نقاط الألعاب أو توب لعبة معينة').addStringOption(gameChoice),
  async execute(interaction) {
    const raw = interaction.options.getString('game');
    const game = findGame(raw);
    if (raw && !game) return reply.error(interaction, `ما لقيت لعبة اسمها **${raw}**`);
    const list = points.top(interaction.guildId, game?.key, 10);
    const medals = [I.gold, I.silver, I.bronze];
    const body = list.length
      ? list.map((r, n) => `${medals[n] || `\`#${n + 1}\``} <@${r.user_id}> — **${r.points}** نقطة${r.wins != null ? ` • ${r.wins} فوز` : ''}`).join('\n')
      : 'ما فيه نقاط للحين — العبوا!';
    const { embed, files } = card({ title: game ? `توب ${game.name}` : 'توب الألعاب', icon: game ? I[game.icon] : I.trophy, description: `${body}\n${DIVIDER}`, image: 'line', footer: 'Sword Games' });
    return interaction.reply({ embeds: [embed], files, allowedMentions: { parse: [] } });
  },
  async autocomplete(interaction) {
    const focused = normalize(interaction.options.getFocused());
    await interaction.respond(GAMES.filter((g) => g.kind !== 'kt' && (normalize(g.name).includes(focused) || g.key.includes(focused)))
      .slice(0, 25).map((g) => ({ name: g.name, value: g.key })));
  },
};

const pointsCommand = {
  data: new SlashCommandBuilder().setName('points').setDescription('نقاطك في الألعاب أو نقاط عضو')
    .addUserOption((o) => o.setName('user').setDescription('العضو')),
  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const total = points.total(interaction.guildId, user.id);
    const rank = points.rank(interaction.guildId, total);
    const games = points.byGame(interaction.guildId, user.id).filter((g) => g.points > 0).slice(0, 8);
    const best = games[0]?.points || 1;
    const lines = games.map((g) => `${I[byKey.get(g.game)?.icon || 'games']} **${byKey.get(g.game)?.name || g.game}** — \`${g.points}\` • ${g.wins} فوز\n${bar(g.points, best, 12)}`);
    const { embed, files } = card({
      title: `نقاط ${user.username}`,
      icon: I.coins,
      thumbnail: user.displayAvatarURL({ size: 256 }),
      description: `**المجموع:** \`${total}\` نقطة  •  **الترتيب:** \`#${rank}\`\n${DIVIDER}\n${lines.join('\n') || 'ما لعب للحين'}`,
      footer: 'Sword Games',
    });
    return interaction.reply({ embeds: [embed], files });
  },
};

const transferCommand = {
  data: new SlashCommandBuilder().setName('transfer').setDescription('تحويل نقاط الألعاب لعضو')
    .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('عدد النقاط').setRequired(true).setMinValue(1).setMaxValue(1_000_000)),
  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    if (user.bot || user.id === interaction.user.id) return reply.error(interaction, 'ما تقدر تحول لنفسك أو لبوت');
    const balance = points.total(interaction.guildId, interaction.user.id);
    if (balance < amount) return reply.error(interaction, `نقاطك ما تكفي — عندك \`${balance}\` بس`);
    points.award(interaction.guildId, interaction.user.id, '_transfer', -amount, false);
    points.award(interaction.guildId, user.id, '_transfer', amount, false);
    return interaction.reply({
      embeds: [simple(`${I.send} ${mention(interaction.user)} حوّل **${amount}** نقطة لـ ${mention(user)}\n${I.coins} رصيدك الحين: \`${balance - amount}\``, 'success', 'تحويل نقاط')],
    });
  },
};

// ── تصويت ─────────────────────────────────────────────────────────
const voteCommand = {
  data: new SlashCommandBuilder().setName('vote').setDescription('تصويت بالأزرار: السؤال | خيار | خيار ...')
    .addStringOption((o) => o.setName('question').setDescription('مثال: أفضل لعبة؟ | روليت | مافيا (بدون خيارات = نعم/لا)').setRequired(true).setMaxLength(1000))
    .addIntegerOption((o) => o.setName('minutes').setDescription('مدة التصويت بالدقائق (افتراضي 2)').setMinValue(1).setMaxValue(1440)),
  async execute(interaction) {
    const [question, ...rest] = interaction.options.getString('question').split('|').map((x) => x.trim()).filter(Boolean);
    const options = (rest.length >= 2 ? rest : ['نعم', 'لا']).slice(0, 10).map((x) => x.slice(0, 80));
    const minutes = interaction.options.getInteger('minutes') || 2;
    const id = Math.random().toString(36).slice(2, 8);
    const votes = new Map();
    const endsAt = Math.floor(Date.now() / 1000) + minutes * 60;
    const render = (closed = false) => {
      const counts = options.map((_, n) => [...votes.values()].filter((v) => v === n).length);
      const total = votes.size || 1;
      const lines = options.map((o, n) => `**${o}** — ${counts[n]} صوت (${Math.round((counts[n] / total) * 100)}%)\n${bar(counts[n], total, 14)}`);
      return {
        embeds: [simple(`### ${question}\n${DIVIDER}\n${lines.join('\n')}\n${DIVIDER}\n${closed ? `انتهى التصويت • ${votes.size} صوت` : `ينتهي <t:${endsAt}:R> • ${votes.size} صوت`}`, closed ? 'success' : 'primary', `${I.vote} تصويت`)],
        components: closed ? [] : rows(options.map((o, n) => button(`g:${id}:opt:${n}`, o))),
      };
    };
    const message = await post(interaction, render());
    const c = message.createMessageComponentCollector({ time: minutes * 60_000, filter: (i) => i.customId.startsWith(`g:${id}:`) });
    c.on('collect', async (i) => {
      const n = Number(i.customId.split(':')[3]);
      if (votes.get(i.user.id) === n) votes.delete(i.user.id);
      else votes.set(i.user.id, n);
      await i.update(render()).catch(() => null);
    });
    c.once('end', () => message.edit(render(true)).catch(() => null));
  },
};

// ── ايقاف ─────────────────────────────────────────────────────────
const stopCommand = {
  data: new SlashCommandBuilder().setName('gstop').setDescription('إيقاف اللعبة الشغالة في هذا الروم'),
  async execute(interaction) {
    const session = current(interaction.channelId);
    if (!session) return reply.error(interaction, 'ما فيه لعبة شغالة هنا');
    if (!canStop(interaction, session)) return reply.error(interaction, 'صاحب اللعبة أو الإدارة بس يقدرون يوقفونها');
    session.stop('stopped');
    return interaction.reply({ embeds: [simple(`${I.stop} تم إيقاف **${session.game.name}**`, 'accent')] });
  },
};

module.exports = {
  id: 'games',
  name: 'Games Plugin',
  nameAr: 'بلوقن الألعاب',
  emoji: I.games,
  description: 'ألعاب جماعية (روليت، مافيا، كراسي...)، تحديات، أسئلة سريعة، نقاط وتوب وتحويل وتصويت.',
  defaults: { channels: [], groupWin: 5, duelWin: 3, quizPoint: 1, quizTime: 20, lobbyTime: 30 },
  commands: [...GAMES.map(gameCommand), topCommand, pointsCommand, transferCommand, voteCommand, stopCommand],
  // Lobby images: each game shows the generated Sword banner unless the server uploads its own.
  images: GAMES.filter((g) => g.kind === 'group' || g.kind === 'duel').map((g) => ({ key: g.key, label: g.name, icon: g.icon })),
  renderImage: (key) => engine.art.banner(byKey.get(key)),
  dashboard: [
    {
      title: 'رومات الألعاب',
      icon: 'games',
      fields: [{ key: 'channels', type: 'channels', label: 'الرومات المسموحة', hint: 'فاضي = الألعاب تشتغل في كل الرومات' }],
    },
    {
      title: 'النقاط والأوقات',
      icon: 'coins',
      fields: [
        { key: 'groupWin', type: 'number', label: 'نقاط الفوز بلعبة جماعية', min: 0, max: 1000 },
        { key: 'duelWin', type: 'number', label: 'نقاط الفوز بتحدي / مافيا / خمن', min: 0, max: 1000 },
        { key: 'quizPoint', type: 'number', label: 'نقاط الجواب الصح (الألعاب الفردية)', min: 0, max: 1000 },
        { key: 'quizTime', type: 'number', label: 'وقت السؤال (ثواني)', min: 5, max: 120 },
        { key: 'lobbyTime', type: 'number', label: 'وقت الانتظار قبل بداية اللعبة (ثواني)', min: 10, max: 180 },
      ],
    },
  ],
  GAMES,
};

