// A small replacement for discord.js' option resolver that plugins read with
// their English option names, whether the command came as Arabic slash or prefix.
const { ApplicationCommandOptionType: T } = require('discord.js');
const { en, ar, normalize } = require('./i18n');

class Options {
  constructor({ group = null, sub = null, values = new Map() } = {}) {
    this.group = group;
    this.sub = sub;
    this.values = values;
  }

  get(name) { return this.values.get(name) ?? null; }
  getSubcommand() { return this.sub; }
  getSubcommandGroup() { return this.group; }
  getString(name) { return this.get(name)?.value ?? null; }
  getInteger(name) { return this.get(name)?.value ?? null; }
  getNumber(name) { return this.get(name)?.value ?? null; }
  getBoolean(name) { return this.get(name)?.value ?? null; }
  getUser(name) { return this.get(name)?.user ?? null; }
  getMember(name) { return this.get(name)?.member ?? null; }
  getChannel(name) { return this.get(name)?.channel ?? null; }
  getRole(name) { return this.get(name)?.role ?? null; }
  getMentionable(name) {
    const v = this.get(name);
    return v ? v.member ?? v.user ?? v.role ?? null : null;
  }
  getFocused() {
    for (const v of this.values.values()) if (v.focused) return v.value;
    return '';
  }
}

// From a real (Arabic) slash interaction.
function fromSlash(interaction) {
  let data = interaction.options.data;
  let group = null;
  let sub = null;
  if (data[0]?.type === T.SubcommandGroup) {
    group = en(data[0].name);
    data = data[0].options || [];
  }
  if (data[0]?.type === T.Subcommand) {
    sub = en(data[0].name);
    data = data[0].options || [];
  }
  const values = new Map();
  for (const opt of data) values.set(en(opt.name), opt);
  return new Options({ group, sub, values });
}

// ── Prefix parsing ───────────────────────────────────────────────
// Tokens keep their start offset so a trailing text option can take the raw rest (newlines included).
function tokenize(text) {
  const tokens = [];
  const re = /"([^"]*)"|“([^”]*)”|(\S+)/g;
  let m;
  while ((m = re.exec(text))) tokens.push({ value: m[1] ?? m[2] ?? m[3], start: m.index });
  return tokens;
}

const TRUE = ['نعم', 'اي', 'ايوه', 'تشغيل', 'تفعيل', 'on', 'yes', 'true', '1', 'شغل'];
const FALSE = ['لا', 'ايقاف', 'اطفاء', 'off', 'no', 'false', '0', 'طفي'];

const idOf = (token, kind) => {
  const patterns = { user: /^<@!?(\d{17,20})>$/, role: /^<@&(\d{17,20})>$/, channel: /^<#(\d{17,20})>$/ };
  return token.match(patterns[kind])?.[1] || (/^\d{17,20}$/.test(token) ? token : null);
};

async function resolveToken(token, opt, guild, client) {
  const raw = token.value;
  const n = normalize(raw);
  switch (opt.type) {
    case T.String: {
      if (!opt.choices) return { value: raw };
      const choice = opt.choices.find((c) => c.value === raw || normalize(c.name).includes(n) || normalize(c.name.replace(/^\S+\s/, '')) === n);
      return choice ? { value: choice.value } : null;
    }
    case T.Integer:
    case T.Number: {
      if (opt.choices) {
        const choice = opt.choices.find((c) => String(c.value) === raw || normalize(c.name).includes(n));
        if (choice) return { value: choice.value };
      }
      const num = opt.type === T.Integer ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
      if (!Number.isFinite(num) || !/^-?\d+(\.\d+)?$/.test(raw)) return null;
      if (opt.min_value != null && num < opt.min_value) return null;
      if (opt.max_value != null && num > opt.max_value) return null;
      return { value: num };
    }
    case T.Boolean:
      if (TRUE.includes(n)) return { value: true };
      if (FALSE.includes(n)) return { value: false };
      return null;
    case T.User: {
      const id = idOf(raw, 'user');
      const member = id ? await guild.members.fetch(id).catch(() => null)
        : guild.members.cache.find((m) => normalize(m.user.username) === n || normalize(m.displayName) === n);
      const user = member?.user || (id ? await client.users.fetch(id).catch(() => null) : null);
      return user ? { user, member } : null;
    }
    case T.Channel: {
      const id = idOf(raw, 'channel');
      const channel = id ? guild.channels.cache.get(id) : guild.channels.cache.find((c) => normalize(c.name) === n);
      if (!channel || (opt.channel_types && !opt.channel_types.includes(channel.type))) return null;
      return { channel };
    }
    case T.Role: {
      const id = idOf(raw, 'role');
      const role = id ? guild.roles.cache.get(id) : guild.roles.cache.find((r) => normalize(r.name) === n);
      return role ? { role } : null;
    }
    case T.Mentionable: {
      const role = await resolveToken(token, { ...opt, type: T.Role }, guild, client);
      return role || resolveToken(token, { ...opt, type: T.User }, guild, client);
    }
    default:
      return null;
  }
}

// Find a (sub)command by name among `options`, allowing an Arabic name typed as two words.
function matchName(tokens, i, options, type) {
  const candidates = options.filter((o) => o.type === type);
  for (const span of [1, 2]) {
    if (i + span > tokens.length) break;
    const typed = normalize(tokens.slice(i, i + span).map((t) => t.value).join(''));
    const hit = candidates.find((o) => normalize(o.name) === typed || normalize(en(o.name)) === typed);
    if (hit) return { option: hit, next: i + span };
  }
  return null;
}

/**
 * Parse prefix arguments against a translated command JSON.
 * Returns { options } or { error, usage } when something required is missing.
 */
async function fromPrefix(json, text, guild, client) {
  const tokens = tokenize(text);
  let i = 0;
  let list = json.options || [];
  let group = null;
  let sub = null;
  const path = [json.name];

  if (list.some((o) => o.type === T.SubcommandGroup || o.type === T.Subcommand)) {
    const g = matchName(tokens, i, list, T.SubcommandGroup);
    if (g) {
      group = en(g.option.name);
      path.push(g.option.name);
      list = g.option.options || [];
      i = g.next;
    }
    const s = matchName(tokens, i, list, T.Subcommand);
    if (!s) return { error: 'missing-sub', path, choices: list };
    sub = en(s.option.name);
    path.push(s.option.name);
    list = s.option.options || [];
    i = s.next;
  }

  const values = new Map();
  const lastText = [...list].reverse().find((o) => o.type === T.String && !o.choices);
  for (const opt of list) {
    if (i >= tokens.length) {
      if (opt.required) return { error: 'missing', path, option: opt, list };
      continue;
    }
    if (opt === lastText) {
      values.set(en(opt.name), { name: opt.name, type: opt.type, value: text.slice(tokens[i].start).trim().replace(/^"(.*)"$/s, '$1') });
      i = tokens.length;
      continue;
    }
    const resolved = await resolveToken(tokens[i], opt, guild, client);
    if (resolved) {
      values.set(en(opt.name), { name: opt.name, type: opt.type, ...resolved });
      i += 1;
    } else if (opt.required) {
      return { error: 'invalid', path, option: opt, list, got: tokens[i].value };
    }
  }
  return { options: new Options({ group, sub, values }) };
}

module.exports = { Options, fromSlash, fromPrefix, tokenize, ar };
