// Runs the extra music bots: one discord.js client + DisTube engine per stored
// token. Each bot sits 24/7 in its fixed voice channel, reads Arabic commands in
// its command channel, and posts its OWN "Now Playing" card (with SVG icons it
// uploads to its own application, since an app can only use its own emojis).
// Audio is pure high-quality YouTube Opus — no filters, no noise gates.
const {
  Client, GatewayIntentBits, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { DisTube } = require('distube');
const { YouTubePlugin } = require('@distube/youtube');
const { getVoiceConnection } = require('@discordjs/voice');
const ffmpegStatic = require('ffmpeg-static');
const { decrypt } = require('../../core/secrets');
const { syncFor } = require('../../core/icons');
const logger = require('../../core/logger');

const VOICE_TYPES = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];
const VOL = { min: 10, max: 150, default: 100 };
const ICON_KEYS = ['music', 'mPlay', 'mPause', 'mStop', 'mPrev', 'mNext', 'mLoop', 'mShuffle', 'volUp', 'volDown', 'clock', 'user'];

const instances = new Map(); // entry.id -> { client, distube, icons, status, error, entry }

const status = (id) => {
  const i = instances.get(id);
  return i ? { status: i.status, error: i.error } : { status: 'stopped' };
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function setState(id, patch) {
  const i = instances.get(id);
  if (i) Object.assign(i, patch);
}

// ── Now Playing card (uses the bot's own uploaded SVG icons) ─────────────────
function emojiText(inst, key) {
  const e = inst.icons?.get(key);
  return e ? `<:${e.name}:${e.id}>` : '';
}
function emojiObj(inst, key) {
  const e = inst.icons?.get(key);
  return e ? { id: e.id, name: e.name } : null;
}

function cardButton(inst, id, key, style = ButtonStyle.Secondary) {
  const b = new ButtonBuilder().setCustomId(id).setStyle(style);
  const e = emojiObj(inst, key);
  if (e) b.setEmoji(e); else b.setLabel(id.replace('m:', ''));
  return b;
}

function nowPlaying(inst, song, queue) {
  const requester = song.user?.username || song.member?.user?.username || 'Unknown';
  const loop = ['OFF', 'Song', 'Queue'][queue?.repeatMode || 0];
  const embed = new EmbedBuilder()
    .setColor(0x1f1f23)
    .setTitle(`${emojiText(inst, 'music')} Now Playing`.trim())
    .setDescription(`**${song.name}**`)
    .setThumbnail(song.thumbnail || null)
    .addFields(
      { name: `${emojiText(inst, 'clock')} Duration`.trim(), value: song.formattedDuration || '—', inline: true },
      { name: `${emojiText(inst, 'music')} Platform`.trim(), value: 'YouTube', inline: true },
      { name: 'Status', value: `Loop: **${loop}**  •  Volume: **${queue?.volume ?? VOL.default}%**  •  Shuffle: **OFF**`, inline: false },
    )
    .setFooter({ text: `by ${requester}` });
  const rows = [
    new ActionRowBuilder().addComponents(
      cardButton(inst, 'm:vol_up', 'volUp'),
      cardButton(inst, 'm:pause', 'mPause', ButtonStyle.Primary),
      cardButton(inst, 'm:vol_down', 'volDown'),
      cardButton(inst, 'm:loop', 'mLoop'),
    ),
    new ActionRowBuilder().addComponents(
      cardButton(inst, 'm:previous', 'mPrev'),
      cardButton(inst, 'm:stop', 'mStop', ButtonStyle.Danger),
      cardButton(inst, 'm:next', 'mNext'),
      cardButton(inst, 'm:shuffle', 'mShuffle'),
    ),
  ];
  return { embeds: [embed], components: rows };
}

function sendCard(inst, song, queue) {
  const channel = inst.client.channels.cache.get(inst.entry.commandChannelId || inst.entry.channelId);
  if (channel?.isTextBased?.()) channel.send(nowPlaying(inst, song, queue)).catch(() => null);
}

// ── Voice (24/7) ─────────────────────────────────────────────────────────────
async function joinFixed(inst) {
  const guild = inst.client.guilds.cache.get(inst.entry.guildId);
  if (!guild) return setState(inst.entry.id, { status: 'error', error: 'البوت مو داخل السيرفر' });
  const channel = guild.channels.cache.get(inst.entry.channelId);
  if (!channel || !VOICE_TYPES.includes(channel.type)) return setState(inst.entry.id, { status: 'error', error: 'روم الفويس غير موجود' });
  try {
    await inst.distube.voices.join(channel);
    setState(inst.entry.id, { status: 'running', error: null });
  } catch (err) {
    setState(inst.entry.id, { status: 'error', error: 'ما قدر يدخل الفويس' });
    logger.warn(`music bot ${inst.entry.name}: ${err.message}`);
  }
}

// ── Arabic commands + buttons ────────────────────────────────────────────────
function wireHandlers(inst) {
  const { client, distube, entry } = inst;

  distube
    .on('initQueue', (queue) => queue.setVolume(clamp(entry.volume || VOL.default, VOL.min, VOL.max)))
    .on('playSong', (queue, song) => sendCard(inst, song, queue))
    .on('error', (error, queue) => {
      logger.warn(`music ${entry.name}: ${error?.message || error}`);
      const ch = queue && client.channels.cache.get(entry.commandChannelId || entry.channelId);
      if (ch?.isTextBased?.()) ch.send('An error occurred while playing. Try again.').catch(() => null);
    });

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild || message.guild.id !== entry.guildId) return;
    if (message.channel.id !== (entry.commandChannelId || entry.channelId)) return;
    const content = message.content.trim();
    if (!content) return;
    const [cmd, ...rest] = content.split(/\s+/);
    const arg = rest.join(' ').trim();
    const getQ = () => {
      const q = distube.getQueue(message.guild);
      if (!q) message.reply('Nothing is playing right now.').catch(() => null);
      return q;
    };
    try {
      if (cmd === 'ش') {
        if (!arg) return message.reply('Usage: `ش <song name>`').catch(() => null);
        const vc = message.guild.channels.cache.get(entry.channelId);
        if (!vc) return message.reply('Voice channel is not configured.').catch(() => null);
        await message.react('🔎').catch(() => null);
        await distube.play(vc, arg, { member: message.member, textChannel: message.channel, message });
      } else if (cmd === 'وقف') {
        const q = getQ(); if (!q) return;
        if (q.paused) { q.resume(); message.reply('▶️ Resumed.').catch(() => null); } else { q.pause(); message.reply('⏸️ Paused.').catch(() => null); }
      } else if (cmd === 'س') {
        const q = getQ(); if (!q) return;
        try { await q.skip(); message.reply('⏭️ Skipped.').catch(() => null); } catch { message.reply('No next song.').catch(() => null); }
      } else if (cmd === 'ص') {
        const q = getQ(); if (!q) return;
        const v = parseInt(arg, 10);
        if (Number.isNaN(v)) return message.reply('Usage: `ص <10-150>`').catch(() => null);
        const vol = clamp(v, VOL.min, VOL.max); q.setVolume(vol);
        message.reply(`🔊 Volume: ${vol}%`).catch(() => null);
      } else if (cmd === 'ق') {
        const q = getQ(); if (!q) return;
        const t = parseInt(arg, 10);
        if (Number.isNaN(t) || t < 0) return message.reply('Usage: `ق <seconds>`').catch(() => null);
        q.seek(t); message.reply(`⏩ Seeked to ${fmt(t)}.`).catch(() => null);
      }
    } catch (err) {
      logger.warn(`music cmd ${entry.name}: ${err.message}`);
      message.reply('Command failed.').catch(() => null);
    }
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() || !interaction.customId.startsWith('m:')) return;
    const queue = distube.getQueue(interaction.guildId);
    if (!queue) return interaction.reply({ content: 'Nothing is playing.', flags: 64 }).catch(() => null);
    let feedback = 'Done.';
    try {
      switch (interaction.customId) {
        case 'm:vol_up': queue.setVolume(clamp(queue.volume + 10, VOL.min, VOL.max)); feedback = `🔊 ${queue.volume}%`; break;
        case 'm:vol_down': queue.setVolume(clamp(queue.volume - 10, VOL.min, VOL.max)); feedback = `🔉 ${queue.volume}%`; break;
        case 'm:pause': if (queue.paused) { queue.resume(); feedback = '▶️ Resumed.'; } else { queue.pause(); feedback = '⏸️ Paused.'; } break;
        case 'm:loop': { const mode = queue.setRepeatMode((queue.repeatMode + 1) % 3); feedback = `🔁 Loop: ${['Off', 'Song', 'Queue'][mode]}`; break; }
        case 'm:previous': try { await queue.previous(); feedback = '⏮️ Previous.'; } catch { feedback = 'No previous track.'; } break;
        case 'm:next': try { await queue.skip(); feedback = '⏭️ Skipped.'; } catch { feedback = 'No next track.'; } break;
        case 'm:stop': await queue.stop(); feedback = '⏹️ Stopped & cleared queue.'; break;
        case 'm:shuffle': await queue.shuffle(); feedback = '🔀 Shuffled.'; break;
        default: feedback = 'Unknown action.';
      }
    } catch (err) {
      logger.warn(`music btn ${entry.name}: ${err.message}`);
      feedback = 'Action failed.';
    }
    interaction.reply({ content: feedback, flags: 64 }).catch(() => null);
  });

  // Return to the fixed channel if moved/disconnected while idle.
  client.on('voiceStateUpdate', (oldS, newS) => {
    if (oldS.id !== client.user?.id || oldS.guild.id !== entry.guildId) return;
    if (oldS.channelId === entry.channelId && newS.channelId !== entry.channelId) {
      setTimeout(() => { if (!distube.getQueue(entry.guildId)) joinFixed(inst); }, 3000);
    }
  });
}

async function start(entry) {
  await stop(entry.id);
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  const distube = new DisTube(client, {
    plugins: [new YouTubePlugin({ ytdlOptions: { quality: 'highestaudio', highWaterMark: 1 << 25 } })],
    emitNewSongOnly: true,
    savePreviousSongs: true,
    joinNewVoiceChannel: false,
    ffmpeg: { path: ffmpegStatic || undefined },
  });
  const inst = { client, distube, icons: new Map(), status: 'starting', error: null, entry };
  instances.set(entry.id, inst);
  client.on('error', (err) => logger.warn(`music bot ${entry.name}: ${err.message}`));
  wireHandlers(inst);
  client.once('clientReady', async () => {
    try { inst.icons = await syncFor(client, ICON_KEYS, { tag: client.user.id }); } catch { /* icons optional */ }
    await joinFixed(inst);
  });
  try {
    await client.login(decrypt(entry.token));
  } catch (err) {
    setState(entry.id, { status: 'error', error: err.code === 'TokenInvalid' ? 'التوكن غير صالح' : 'فشل تسجيل الدخول' });
    client.destroy().catch(() => null);
    return false;
  }
  return true;
}

async function stop(id) {
  const inst = instances.get(id);
  if (!inst) return;
  try { getVoiceConnection(inst.entry.guildId, id); inst.distube?.voices?.leave?.(inst.entry.guildId); } catch { /* ignore */ }
  await inst.client?.destroy().catch(() => null);
  instances.set(id, { status: 'stopped', entry: inst.entry });
}

// Update a bot's name and/or avatar through its own token (REST).
async function applyProfile(entry, { name, avatar } = {}) {
  const inst = instances.get(entry.id);
  if (!inst?.client?.user) throw Object.assign(new Error('البوت مو شغّال — شغّله أول'), { userFacing: true });
  if (name) await inst.client.user.setUsername(name);
  if (avatar) await inst.client.user.setAvatar(avatar); // Buffer or data URI
}

// Current live info for the dashboard (avatar URL, tag) if the bot is running.
function info(id) {
  const inst = instances.get(id);
  const u = inst?.client?.user;
  return u ? { tag: u.tag, username: u.username, avatar: u.displayAvatarURL({ size: 128 }) } : null;
}

module.exports = { start, stop, status, applyProfile, info, VOICE_TYPES, VOL };
