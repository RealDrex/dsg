// Prefix commands: "!باند @عضو السبب" runs the exact same command code as /باند.
const { MessageFlags, ApplicationCommandOptionType: T } = require('discord.js');
const store = require('./store');
const { fromPrefix } = require('./options');
const { normalize } = require('./i18n');
const { simple, emoji } = require('./theme');
const logger = require('./logger');

// Message-backed stand-in for a ChatInputCommandInteraction.
class PrefixInteraction {
  constructor(message, command, options) {
    this.message = message;
    this.client = message.client;
    this.guild = message.guild;
    this.guildId = message.guildId;
    this.channel = message.channel;
    this.channelId = message.channelId;
    this.member = message.member;
    this.user = message.author;
    this.memberPermissions = message.member.permissions;
    this.commandName = command.json.name;
    this.options = options;
    this.deferred = false;
    this.replied = false;
    this.response = null;
    this.viaPrefix = true;
  }

  isChatInputCommand() { return true; }
  isAutocomplete() { return false; }
  isButton() { return false; }
  isMessageComponent() { return false; }
  isModalSubmit() { return false; }
  inGuild() { return true; }
  inCachedGuild() { return true; }

  static clean(payload) {
    const out = typeof payload === 'string' ? { content: payload } : { ...payload };
    if (out.flags != null) {
      // Ephemeral replies don't exist for normal messages; keep everything else.
      const flags = Number(out.flags) & ~MessageFlags.Ephemeral;
      if (flags) out.flags = flags;
      else delete out.flags;
    }
    out.allowedMentions ??= { parse: ['users'], repliedUser: false };
    return out;
  }

  async reply(payload) {
    this.replied = true;
    this.response = await this.message.reply(PrefixInteraction.clean(payload));
    return this.response;
  }

  async deferReply() {
    this.deferred = true;
    await this.channel.sendTyping().catch(() => null);
  }

  async editReply(payload) {
    if (this.response) return this.response.edit(PrefixInteraction.clean(payload));
    return this.reply(payload);
  }

  async followUp(payload) {
    return this.channel.send(PrefixInteraction.clean(payload));
  }
}

const typeHint = {
  [T.User]: 'منشن عضو أو آيدي', [T.Channel]: 'منشن روم', [T.Role]: 'منشن رتبة', [T.Mentionable]: 'منشن عضو أو رتبة',
  [T.Integer]: 'رقم', [T.Number]: 'رقم', [T.Boolean]: 'نعم / لا', [T.String]: 'نص',
};

function usageLine(prefix, path, list) {
  const args = list.filter((o) => o.type > 2).map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ');
  return `\`${prefix}${path.join(' ')}${args ? ` ${args}` : ''}\``;
}

async function handlePrefix(message) {
  if (!message.inGuild() || message.author.bot || !message.member || !message.content) return;
  const { client } = message;
  const { prefix } = store.get(message.guildId, 'core');
  const mention = new RegExp(`^<@!?${client.user.id}>\\s*`);
  let body;
  if (prefix && message.content.startsWith(prefix)) body = message.content.slice(prefix.length);
  else if (mention.test(message.content)) body = message.content.replace(mention, '');
  else return;

  const match = body.match(/^\s*(\S+)\s*([\s\S]*)$/);
  if (!match) return;
  // The interactive-staff plugin owns these words (it handles them itself, with
  // role-based permissions), so don't double-run them through the slash path.
  if (client.staffWords?.has(normalize(match[1])) && store.isEnabled(message.guildId, 'staff')) return;
  let command = client.aliases.get(normalize(match[1]));
  let rest = match[2];
  // Allow two-word Arabic names typed with a space: "!فك باند 123"
  if (!command) {
    const two = rest.match(/^(\S+)\s*([\s\S]*)$/);
    if (two && client.aliases.has(normalize(match[1] + two[1]))) {
      command = client.aliases.get(normalize(match[1] + two[1]));
      rest = two[2];
    }
  }
  if (!command) return;

  const { plugin, json } = command;
  const shown = prefix || '@Sword ';
  const fail = (text) => message.reply({ embeds: [simple(`${emoji.error} ${text}`, 'error')], allowedMentions: { repliedUser: false } }).catch(() => null);

  if (plugin.toggleable && !store.isEnabled(message.guildId, plugin.id)) {
    return fail(`${plugin.emoji} **${plugin.nameAr}** مقفل حالياً.`);
  }
  if (json.default_member_permissions && !message.member.permissions.has(BigInt(json.default_member_permissions))) {
    return fail('ما عندك صلاحية لهذا الأمر.');
  }

  try {
    const parsed = await fromPrefix(json, rest, message.guild, client);
    if (parsed.error === 'missing-sub') {
      const lines = parsed.choices.flatMap((o) => (o.type === T.SubcommandGroup
        ? (o.options || []).map((s) => `${usageLine(shown, [...parsed.path, o.name, s.name], s.options || [])} — ${s.description}`)
        : [`${usageLine(shown, [...parsed.path, o.name], o.options || [])} — ${o.description}`]));
      return message.reply({ embeds: [simple(lines.join('\n'), 'primary', `${emoji.sword} أوامر ${json.name}`)], allowedMentions: { repliedUser: false } });
    }
    if (parsed.error) {
      const what = parsed.error === 'missing' ? 'ناقص' : `قيمة غير صحيحة \`${parsed.got}\` في`;
      return fail(`${what} **${parsed.option.name}** (${typeHint[parsed.option.type] || ''})\nالاستخدام: ${usageLine(shown, parsed.path, parsed.list)}`);
    }
    await command.execute(new PrefixInteraction(message, command, parsed.options));
  } catch (err) {
    logger.error(`Prefix ${json.name}:`, err);
    fail('صار خطأ غير متوقع، حاول مرة ثانية.');
  }
}

module.exports = { handlePrefix, PrefixInteraction };
