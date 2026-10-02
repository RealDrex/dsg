// Sword visual identity: black steel, silver edges and a drop of crimson.
const path = require('node:path');
const { EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
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

/**
 * Themed embed. `brand` adds the logo thumbnail and footer icon,
 * `image` takes one of the brand image keys (or a full URL).
 * Returns { embed, files } so callers can spread files into the payload.
 */
function card({ title, icon, description, color = 'primary', fields, image, brand = true, footer, thumbnail } = {}) {
  const embed = new EmbedBuilder().setColor(colors[color] ?? color);
  const files = [];
  const use = (key) => {
    if (!files.some((f) => f.name === images[key])) files.push(file(key));
    return url(key);
  };

  if (title) embed.setTitle(icon ? `${iconText(icon)} ${title}`.trim() : title);
  if (description) embed.setDescription(description);
  if (fields?.length) embed.addFields(fields);
  if (brand) {
    embed.setFooter({ text: footer || BRAND, iconURL: use('logo') });
    if (!thumbnail) embed.setThumbnail(use('logo'));
  } else if (footer) {
    embed.setFooter({ text: footer });
  }
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(images[image] ? use(image) : image);
  embed.setTimestamp();
  return { embed, files };
}

// Light-weight embed for quick replies (no attachments).
function simple(text, color = 'primary', title) {
  const embed = new EmbedBuilder().setColor(colors[color] ?? color).setDescription(text);
  if (title) embed.setTitle(title);
  return embed;
}

async function respond(interaction, payload) {
  if (interaction.deferred && !interaction.replied) {
    // Edits can't change ephemerality, so drop the flags.
    return interaction.editReply({ ...payload, flags: undefined });
  }
  if (interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

const ephemeral = (embed) => ({ embeds: [embed], flags: MessageFlags.Ephemeral });

const reply = {
  success: (i, text, { hidden = true } = {}) =>
    respond(i, hidden ? ephemeral(simple(`${emoji.success} ${text}`, 'success')) : { embeds: [simple(`${emoji.success} ${text}`, 'success')] }),
  error: (i, text) => respond(i, ephemeral(simple(`${emoji.error} ${text}`, 'error'))),
  info: (i, text, { hidden = true } = {}) =>
    respond(i, hidden ? ephemeral(simple(text)) : { embeds: [simple(text)] }),
};

// ▰▰▰▰▱▱▱▱ style progress bar
function bar(value, max, size = 14) {
  const filled = max > 0 ? Math.round((Math.min(value, max) / max) * size) : 0;
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

module.exports = { colors, emoji, DIVIDER, BRAND, images, file, url, card, simple, reply, respond, bar, ASSETS };
