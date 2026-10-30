// Sword visual identity: black steel, silver edges and a drop of crimson.
const path = require('node:path');
const { AttachmentBuilder, MessageFlags } = require('discord.js');
const { I, text: iconText } = require('./icons');
const config = require('../config');

const ASSETS = path.join(__dirname, '..', '..', 'assets');

const colors = {
  primary: 0xd4d4d4, // silver blade
  dark: 0x0b0b0b,
  accent: 0x9e1b1b, // crimson
  success: 0xf2f2f2,
  error: 0x9e1b1b,
  warn: 0x8a8a8a,
};

// Icon handles (custom Discord emojis uploaded from assets/icons).
const emoji = {
  sword: I.sword,
  blade: I.blade,
  gate: I.sword,
  success: I.success,
  error: I.error,
  warn: I.warn,
  info: I.info,
  dot: '▸',
  on: I.on,
  off: I.off,
};

const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━';
const BRAND = 'Sword • Private Server';

// Brand images are sent as attachments so the logo shows on every panel
// without needing a public image host.
const images = {
  logo: 'logo-round.png',
  banner: 'banner.png',
  ticket: 'ticket-banner.png',
  welcome: 'welcome-banner.png',
  roles: 'roles-banner.png',
  colors: 'colors-banner.png',
  line: 'line.png',
};

// Every brand/theme asset that can be replaced per server from the website
// (the `theme` plugin stores overrides under images/<guild>/theme/<key>.<ext>).
const THEME_FILES = {
  ...images,
  logoFlat: 'logo.png',
  roulette: 'lobby-roulette.png',
  roulettez: 'lobby-roulettez.png',
  mafia: 'lobby-mafia.png',
};

// Resolve a theme asset to a disk path: a server's custom upload if it exists,
// otherwise the default shipped with the bot. `guildId` is optional.
let imageStore = null; // lazily required to avoid a require cycle at load time
function themePath(key, guildId) {
  const name = THEME_FILES[key] || images[key];
  // Fall back to the primary guild so default panels still pick up the owner's
  // uploads even when the call site has no guild context.
  const gid = guildId || config.guildId;
  if (gid) {
    imageStore ??= require('./images');
    const custom = imageStore.find(gid, 'theme', key);
    if (custom) return custom.file;
  }
  return path.join(ASSETS, name);
}

const file = (key, guildId) => new AttachmentBuilder(themePath(key, guildId), { name: images[key] || THEME_FILES[key] });
const url = (key) => `attachment://${images[key] || THEME_FILES[key]}`;

// NOTE: the bot uses NO embeds anywhere. `card` and `simple` build plain
// message content (markdown) so panels/replies render as normal messages.
// They keep their old names/shapes so call sites stay simple.

function fieldsToText(fields) {
  return fields.map((f) => {
    const name = String(f.name ?? '').trim();
    const value = String(f.value ?? '').trim();
    if (!name && !value) return '';
    if (!name) return value;
    // Inline-ish: short single-line value on the same line, else name as a header.
    if (value && !value.includes('\n') && value.length <= 40) return `**${name}:** ${value}`;
    return `**${name}**\n${value}`;
  }).filter(Boolean).join('\n');
}

/**
 * Builds plain message content (no embed). `image` attaches one of the brand
 * images as a file. Returns { content, files } so callers spread both.
 */
function card({ title, icon, description, fields, image, footer, guildId } = {}) {
  const files = [];
  const parts = [];
  if (title) parts.push(`**${icon ? `${iconText(icon)} ${title}`.trim() : title}**`);
  if (description) parts.push(description);
  if (fields?.length) parts.push(fieldsToText(fields));
  if (footer) parts.push(`-# ${footer}`);
  if (image) files.push(THEME_FILES[image] ? file(image, guildId) : null);
  return { content: parts.filter(Boolean).join('\n'), files: files.filter(Boolean) };
}

// Plain-content quick reply (returns a string). `color`/`title` kept for
// call-site compatibility: title becomes a bold first line, color is ignored.
function simple(text, color = 'primary', title) {
  return title ? `**${title}**\n${text}` : text;
}

async function respond(interaction, payload) {
  if (interaction.deferred && !interaction.replied) {
    // Edits can't change ephemerality, so drop the flags.
    return interaction.editReply({ ...payload, flags: undefined });
  }
  if (interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

const reply = {
  success: (i, text, { hidden = true } = {}) =>
    respond(i, hidden ? ephemeral(`${emoji.success} ${text}`) : { content: `${emoji.success} ${text}` }),
  error: (i, text) => respond(i, ephemeral(`${emoji.error} ${text}`)),
  info: (i, text, { hidden = true } = {}) =>
    respond(i, hidden ? ephemeral(text) : { content: text }),
};

// ▰▰▰▰▱▱▱▱ style progress bar
function bar(value, max, size = 14) {
  const filled = max > 0 ? Math.round((Math.min(value, max) / max) * size) : 0;
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

module.exports = { colors, emoji, DIVIDER, BRAND, images, THEME_FILES, themePath, file, url, card, simple, fieldsToText, reply, respond, bar, ASSETS };
