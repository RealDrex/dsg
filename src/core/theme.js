// Sword visual identity: black steel, silver edges and a drop of crimson.
const path = require('node:path');
const { AttachmentBuilder, MessageFlags } = require('discord.js');
const { I, text: iconText } = require('./icons');

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

const file = (key) => new AttachmentBuilder(path.join(ASSETS, images[key]), { name: images[key] });
const url = (key) => `attachment://${images[key]}`;

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
function card({ title, icon, description, fields, image, footer } = {}) {
  const files = [];
  const parts = [];
  if (title) parts.push(`**${icon ? `${iconText(icon)} ${title}`.trim() : title}**`);
  if (description) parts.push(description);
  if (fields?.length) parts.push(fieldsToText(fields));
  if (footer) parts.push(`-# ${footer}`);
  if (image) files.push(images[image] ? file(image) : null);
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

module.exports = { colors, emoji, DIVIDER, BRAND, images, file, url, card, simple, fieldsToText, reply, respond, bar, ASSETS };
