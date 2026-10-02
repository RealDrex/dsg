// Plays every game end-to-end against fake Discord events with automated players.
// Usage: node scripts/sim-games.js [gameKey ...]
process.env.DB_PATH = ':memory:';
process.env.GAMES_TIME_SCALE = process.env.GAMES_TIME_SCALE || '0.03';
process.env.LOG_FILES = 'false';

const { Client, MessageCollector, InteractionType, ComponentType } = require('discord.js');
const { loadPlugins } = require('../src/core/loader');
const { Options } = require('../src/core/options');
const store = require('../src/core/store');

const { plugins } = loadPlugins();
const games = plugins.get('games');
const GUILD = '900000000000000000';
const CHANNEL = '800000000000000000';
const BOT = '700000000000000000';
const PLAYERS = ['100000000000000001', '100000000000000002', '100000000000000003', '100000000000000004', '100000000000000005', '100000000000000006'];
const names = Object.fromEntries(PLAYERS.map((id, n) => [id, `P${n + 1}`]));

store.update(GUILD, 'games', (c) => { c.lobbyTime = 30; c.quizTime = 20; });

const client = new Client({ intents: [] });
client.user = { id: BOT, username: 'Sword' };

let seq = 0;
const nextId = () => String(10n ** 17n + BigInt(++seq));
const log = [];
let deciders = [];

const json = (p) => ({
  text: [p.content, ...(p.embeds || []).map((e) => { const d = e.toJSON ? e.toJSON() : e.data || e; return `${d.title || ''}\n${d.description || ''}`; })].filter(Boolean).join('\n'),
  components: (p.components || []).flatMap((r) => (r.toJSON ? r.toJSON() : r).components || []),
});

function feed(payload, message) {
  const view = json(payload);
  log.push(view.text.replace(/\s+/g, ' ').slice(0, 160));
  for (const d of deciders) setTimeout(() => d(view, message), 5);
}

function fakeMessage(payload) {
  const msg = {
    id: nextId(),
    channelId: CHANNEL,
    edit: async (p) => { feed(p, msg); return msg; },
    delete: async () => {},
    createMessageComponentCollector: (opts) => new (require('discord.js').InteractionCollector)(client, { ...opts, message: msg }),
  };
  feed(payload, msg);
  return msg;
}

const channel = {
  id: CHANNEL,
  client,
  guild: { id: GUILD },
  send: async (p) => fakeMessage(p),
  createMessageCollector: (opts) => new MessageCollector(channel, opts),
  isThread: () => false,
};

function click(userId, customId, values, message) {
  const i = {
    id: nextId(),
    type: InteractionType.MessageComponent,
    componentType: values ? ComponentType.StringSelect : ComponentType.Button,
    customId,
    values,
    channelId: CHANNEL,
    guildId: GUILD,
    message: message || { id: '0' },
    user: { id: userId, username: names[userId] },
    member: { displayName: names[userId], permissions: { has: () => false } },
    replied: false,
    deferred: false,
    reply: async (p) => { i.replied = true; feed(p); return fakeMessage(p); },
    update: async (p) => { i.replied = true; feed(p, i.message); },
    deferUpdate: async () => { i.deferred = true; },
    isButton: () => !values,
  };
  client.emit('interactionCreate', i);
}

function say(userId, content) {
  const m = {
    id: nextId(), channelId: CHANNEL, content, author: { id: userId, bot: false, username: names[userId] },
    reply: async (p) => fakeMessage(p), react: async () => {},
  };
  client.emit('messageCreate', m);
}

function slash(game, userId, options = new Options()) {
  return {
    client, guild: channel.guild, guildId: GUILD, channel, channelId: CHANNEL, viaPrefix: true,
    user: { id: userId, username: names[userId] },
    member: { displayName: names[userId], permissions: { has: () => true } },
    options,
    reply: async (p) => fakeMessage(p),
  };
}

// ── Automated player behaviour ──────────────────────────────────────
function autoplay(players, extra = () => {}) {
  const used = new Set();
  return (view, message) => {
    for (const comp of view.components) {
      const id = comp.custom_id || '';
      const action = id.split(':')[2];
      if (comp.disabled) continue;
      if (action === 'join' && !used.has(id)) {
        used.add(id);
        players.slice(1).forEach((p) => click(p, id, null, message));
        setTimeout(() => click(players[0], id.replace(':join', ':start'), null, message), 30);
      }
      if (['kick', 'pass', 'tile', 'cell'].includes(action)) players.forEach((p) => click(p, id, null, message));
      if (action === 'chair') players.forEach((p, n) => setTimeout(() => click(p, id, null, message), n));
      if (action === 'spot') players.forEach((p, n) => { if (Number(id.split(':')[3]) === n) click(p, id, null, message); });
      if (action === 'hand') players.forEach((p) => click(p, id, null, message));
      if (action === 'accept') players.forEach((p) => click(p, id, null, message));
      if (action === 'b' && comp.style === 3) players.forEach((p) => click(p, id, null, message));
      if (action === 'role' || action === 'night') players.forEach((p) => click(p, id, null, message));
      if (action === 'act' || action === 'vote') {
        const opts = comp.options || [];
        players.forEach((p, n) => click(p, id, [opts[n % opts.length].value], message));
      }
    }
    extra(view);
  };
}

const runGame = (key, inter) => games.commands.find((c) => c.data.name === key).execute(inter);
const waitIdle = async () => {
  const { current } = require('../src/plugins/games/engine');
  for (let t = 0; t < 1200 && current(CHANNEL); t += 1) await new Promise((r) => setTimeout(r, 50));
  return !current(CHANNEL);
};

const scenarios = {
  roulette: { players: 4 },
  roulettez: { players: 4 },
  dice: { players: 4 },
  mine: { players: 3 },
  bomb: { players: 3 },
  chairs: { players: 4 },
  hideseek: { players: 4 },
  buttons: { players: 3 },
  mafia: { players: 6 },
  reverse: {
    players: 3,
    extra: (players) => (view) => {
      const m = view.text.match(/بالمقلوب:\n# (\S+)/);
      if (m) players.forEach((p, n) => setTimeout(() => say(p, n === 2 ? 'غلط' : [...m[1]].reverse().join('')), 10 + n * 5));
    },
  },
  silence: {
    players: 3,
    extra: (players) => (view) => {
      if (view.text.includes('# تكلم!')) players.slice(0, 2).forEach((p) => say(p, 'هلا'));
      if (view.text.includes('# سكات!')) say(players[2], 'اوبس');
    },
  },
  chain: {
    players: 3,
    extra: (players) => (view) => {
      const m = view.text.match(/دور <@(\d+)> — اكتب كلمة تبدأ بحرف \*\*(\S)\*\*/);
      if (m && m[1] !== players[2]) say(m[1], `${m[2]}${'بتثجحخدذرزسشصضطظعغفقكلمنهوي'[seq % 28]}${'بتثجحخدذرزسشصضطظعغفقكلمنهوي'[(seq * 7) % 28]}${'سشصض'[seq % 4]}`);
    },
  },
  guess: {
    players: 1,
    custom: async () => {
      let lo = 1; let hi = 100; let g = 50;
      deciders = [(view) => {
        if (view.text === 'أكبر') { lo = g + 1; g = Math.floor((lo + hi) / 2); setTimeout(() => say(PLAYERS[0], String(g)), 5); }
        if (view.text === 'أصغر') { hi = g - 1; g = Math.floor((lo + hi) / 2); setTimeout(() => say(PLAYERS[0], String(g)), 5); }
      }];
      runGame('guess', slash('guess', PLAYERS[0]));
      setTimeout(() => say(PLAYERS[0], '٥٠'), 30);
    },
  },
  rps: { players: 2, options: () => new Options({ values: new Map([['user', { user: { id: PLAYERS[1], bot: false, username: 'P2' }, member: { displayName: 'P2' } }]]) }) },
  rpsBot: { key: 'rps', players: 1 },
  xo: { players: 1 },
  xoHuman: { key: 'xo', players: 2, options: () => new Options({ values: new Map([['user', { user: { id: PLAYERS[1], bot: false, username: 'P2' }, member: { displayName: 'P2' } }]]) }) },
  math: {
    players: 1,
    extra: (players) => (view) => {
      const m = view.text.match(/\*\*(\d+) ([+\-×÷]) (\d+)\*\*/);
      if (m) {
        const [a, op, b] = [Number(m[1]), m[2], Number(m[3])];
        const r = { '+': a + b, '-': a - b, '×': a * b, '÷': a / b }[op];
        setTimeout(() => say(players[0], String(r)), 10);
      }
    },
  },
  capitals: { players: 1, extra: solve((t) => { const c = data.COUNTRIES.find((x) => t.includes(`**${x.names[0]}**`)); return c && c.capitals[0]; }) },
  flags: { players: 1, extra: solve(() => null) },
  merge: { players: 1, extra: solve((t) => { const m = t.match(/الحروف:\n# (.+)/); return m && m[1].replace(/ /g, ''); }) },
  split: { players: 1, extra: solve((t) => { const m = t.match(/مسافات\):\n# (\S+)/); return m && [...m[1]].join(' '); }) },
  fastest: {
    players: 2,
    extra: (players) => (view) => {
      const m = view.text.match(/يكتب:\n# (\S+)/);
      if (!m) return;
      setTimeout(() => say(players[0], m[1]), 5); // copy-paste (has ZWJ) must be rejected
      setTimeout(() => say(players[1], m[1].replace(/\u200D/g, '')), 15);
    },
  },
  complete: { players: 1, extra: solve((t) => { const p = data.PROVERBS.find((x) => t.includes(`${x.start} ...`)); return p && p.endings[0]; }) },
  next: { players: 1, extra: solve(() => null) },
  plural: { players: 1, extra: solve((t) => { const p = data.PLURALS.find((x) => t.includes(`**${x.singular}**`)); return p && p.plurals[0]; }) },
  singular: { players: 1, extra: solve((t) => { const p = data.PLURALS.find((x) => x.plurals.some((pl) => t.includes(`**${pl}**`))); return p && p.singular; }) },
  opposite: { players: 1, extra: solve((t) => { const m = t.match(/عكس كلمة \*\*(\S+)\*\*/); if (!m) return null; const pair = data.OPPOSITES.find((x) => x.includes(m[1])); return pair && (pair[0] === m[1] ? pair[1] : pair[0]); }) },
  stop: {
    players: 3,
    custom: async () => {
      deciders = [];
      runGame('roulette', slash('roulette', PLAYERS[0]));
      await new Promise((r) => setTimeout(r, 50));
      await runGame('gstop', slash('gstop', PLAYERS[0]));
    },
  },
};

function solve(fn) {
  return (players) => (view) => {
    const answer = fn(view.text);
    if (answer) setTimeout(() => say(players[0], answer), 10);
  };
}
const data = require('../src/plugins/games/data');

(async () => {
  const only = process.argv.slice(2);
  const results = [];
  for (const [name, sc] of Object.entries(scenarios)) {
    if (only.length && !only.includes(name)) continue;
    const key = sc.key || name;
    log.length = 0;
    const players = PLAYERS.slice(0, sc.players);
    const started = Date.now();
    if (sc.custom) await sc.custom();
    else {
      deciders = [autoplay(players, sc.extra ? sc.extra(players) : undefined)];
      runGame(key, slash(key, players[0], sc.options ? sc.options() : undefined));
    }
    const finished = await waitIdle();
    const end = log.filter((l) => /الفائز|فاز|صح يا|انتهى الوقت|تعادل|عرف الرقم|انتهت|ما فيه فائز|البوت فاز|تم إيقاف/.test(l)).pop() || log[log.length - 1];
    results.push({ name, finished, seconds: ((Date.now() - started) / 1000).toFixed(1), end });
    console.log(`${finished ? 'OK  ' : 'HANG'} ${name.padEnd(10)} ${String(results.at(-1).seconds).padStart(5)}s  ${end}`);
    if (!finished) {
      console.log(log.slice(-8).join('\n'));
      require('../src/plugins/games/engine').current(CHANNEL)?.stop('test');
    }
  }
  const { points } = require('../src/plugins/games/engine');
  console.log('\nTop:', points.top(GUILD, null, 5).map((r) => `${names[r.user_id]}=${r.points}`).join(' '));
  process.exit(results.every((r) => r.finished) ? 0 : 1);
})();
