// Interactive setup: asks for the bot token and fills in .env automatically
// (client id, server id, owner id), checking the token and intents with Discord.
// Prompts are in English because Windows consoles don't shape Arabic text.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = path.join(__dirname, '..');
const ENV = path.join(ROOT, '.env');
const EXAMPLE = path.join(ROOT, '.env.example');
const API = 'https://discord.com/api/v10';
const FLAGS = { members: (1 << 14) | (1 << 15), content: (1 << 18) | (1 << 19), presence: (1 << 12) | (1 << 13) };

const c = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' };
const ok = (t) => console.log(`  ${c.g}[OK]${c.x} ${t}`);
const warn = (t) => console.log(`  ${c.y}[!]${c.x}  ${t}`);
const bad = (t) => console.log(`  ${c.r}[X]${c.x}  ${t}`);
const info = (t) => console.log(`  ${c.d}${t}${c.x}`);

// ── .env read/write (keeps unknown keys and comments) ─────────────────
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function writeEnv(values) {
  const base = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : fs.readFileSync(EXAMPLE, 'utf8');
  const seen = new Set();
  const lines = base.split(/\r?\n/).map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!m || !(m[1] in values)) return line;
    seen.add(m[1]);
    return `${m[1]}=${values[m[1]] ?? ''}`;
  });
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) lines.push(`${k}=${v ?? ''}`);
  fs.writeFileSync(ENV, lines.join('\n').replace(/\n*$/, '\n'));
}

// ── prompts ───────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let muted = false;
rl._writeToOutput = function write(s) {
  if (muted && !/[\r\n]/.test(s)) rl.output.write('*'.repeat(s.length));
  else rl.output.write(s);
};
// Lines are queued so nothing typed/pasted early is lost while we talk to Discord.
const queue = [];
const waiting = [];
rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : queue.push(line)));
rl.on('close', () => { while (waiting.length) waiting.shift()(''); });
const nextLine = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiting.push(resolve)));

async function ask(q, def = '') {
  rl.output.write(`  ${q}${def ? ` ${c.d}[${def}]${c.x}` : ''}: `);
  const a = (await nextLine()).trim();
  if (!process.stdin.isTTY) rl.output.write('\n');
  return a || def;
}
async function askSecret(q) {
  rl.output.write(`  ${q}: `);
  muted = true;
  const a = (await nextLine()).trim();
  muted = false;
  if (!process.stdin.isTTY) rl.output.write('\n');
  return a;
}
const mask = (t) => (t ? `${t.slice(0, 6)}…${t.slice(-4)}` : '');

async function discord(token, route) {
  const res = await fetch(`${API}${route}`, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(10_000) });
  return { status: res.status, body: res.ok ? await res.json() : null };
}

async function main() {
  const current = fs.existsSync(ENV) ? parseEnv(fs.readFileSync(ENV, 'utf8')) : {};
  const values = {};
  console.log(`\n  ${c.b}SWORD BOT - Setup${c.x}\n  ${'='.repeat(48)}\n`);

  // 1) Token → bot id, owner, intents
  let token = current.DISCORD_TOKEN || '';
  let me = null;
  let app = null;
  for (;;) {
    info('Developer Portal -> your app -> Bot -> Reset Token -> Copy');
    const typed = await askSecret(token ? `Bot token (Enter = keep ${mask(token)})` : 'Paste the bot token');
    if (typed) token = typed.replace(/^Bot\s+/i, '').replace(/^"|"$/g, '');
    if (!token) { bad('A token is required.'); continue; }
    try {
      const r = await discord(token, '/users/@me');
      if (r.status === 401) { bad('Discord rejected this token. Reset it in the Developer Portal and paste the new one.'); token = ''; continue; }
      if (!r.body?.bot) { bad('That is not a bot token (user/account tokens are not allowed).'); token = ''; continue; }
      me = r.body;
      app = (await discord(token, '/oauth2/applications/@me')).body;
      ok(`Token works: ${me.username} (id ${me.id})`);
    } catch {
      warn('Could not reach Discord to verify the token (no internet?). Saving it anyway.');
    }
    break;
  }
  values.DISCORD_TOKEN = token;
  values.CLIENT_ID = me?.id || current.CLIENT_ID || await ask('Application ID (Client ID)');

  if (app) {
    const flags = app.flags || 0;
    if (!(flags & FLAGS.members)) warn('"Server Members Intent" is OFF -> turn it on: Developer Portal -> Bot -> Privileged Gateway Intents');
    else ok('Server Members Intent is on');
    if (!(flags & FLAGS.content)) warn('"Message Content Intent" is OFF -> turn it on (needed for prefix commands, protection, levels)');
    else ok('Message Content Intent is on');
  }

  // 2) Owner ids
  const owners = new Set((current.OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));
  if (app?.owner?.id && !app.team) owners.add(app.owner.id);
  for (const m of app?.team?.members || []) owners.add(m.user.id);
  values.OWNER_IDS = await ask('Owner user IDs (comma separated)', [...owners].join(','));

  // 3) Server
  let guildId = current.GUILD_ID || '';
  if (me) {
    for (;;) {
      const guilds = (await discord(token, '/users/@me/guilds').catch(() => ({ body: [] }))).body || [];
      if (!guilds.length) {
        warn('The bot is not in any server yet. Invite it with this link, then press Enter:');
        console.log(`\n  https://discord.com/oauth2/authorize?client_id=${me.id}&scope=bot%20applications.commands&permissions=8\n`);
        await ask('Press Enter after inviting the bot');
        continue;
      }
      if (guilds.length === 1) {
        guildId = guilds[0].id;
        ok(`Server: ${guilds[0].name} (${guildId})`);
      } else {
        guilds.forEach((g, i) => console.log(`   ${i + 1}) ${g.name}  ${c.d}${g.id}${c.x}`));
        const def = Math.max(1, guilds.findIndex((g) => g.id === guildId) + 1);
        const n = Number(await ask('Which server is yours? (number)', String(def)));
        guildId = guilds[Math.min(Math.max(n, 1), guilds.length) - 1].id;
        ok(`Server: ${guilds.find((g) => g.id === guildId).name}`);
      }
      break;
    }
  } else {
    guildId = await ask('Your server ID', guildId);
  }
  values.GUILD_ID = guildId;

  // 4) Website / dashboard
  console.log('');
  values.PORT = await ask('Website port', current.PORT || '3000');
  info('Leave empty if the site is only used on this machine. Example: https://sword.example.com');
  values.PUBLIC_URL = (await ask('Public website URL (optional)', current.PUBLIC_URL || '')).replace(/\/$/, '');
  info('Dashboard login: Developer Portal -> OAuth2 -> Client Secret -> Reset Secret (Enter = skip)');
  const secret = await askSecret(current.CLIENT_SECRET ? `Client secret (Enter = keep ${mask(current.CLIENT_SECRET)})` : 'Client secret (optional)');
  values.CLIENT_SECRET = secret || current.CLIENT_SECRET || '';
  values.SERVER_INVITE = await ask('Server invite link (optional)', current.SERVER_INVITE || '');
  values.WEB_ENABLED = current.WEB_ENABLED || 'true';

  writeEnv(values);
  const base = values.PUBLIC_URL || `http://localhost:${values.PORT}`;
  console.log(`\n  ${'='.repeat(48)}`);
  ok('Saved .env');
  if (values.CLIENT_SECRET) {
    warn('One more step for the dashboard login - add this in Developer Portal -> OAuth2 -> Redirects:');
    console.log(`\n      ${base}/auth/callback\n`);
  }
  console.log(`  Next: run ${c.b}start.bat${c.x}   (website: ${base})\n`);
  rl.close();
}

main().catch((err) => {
  bad(err.message);
  rl.close();
  process.exitCode = 1;
});
