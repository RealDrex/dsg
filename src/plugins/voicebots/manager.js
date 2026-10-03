// Runs the extra voice bots: one discord.js client per stored bot token, each
// sitting 24/7 in its configured voice channel and rejoining if moved or dropped.
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { joinVoiceChannel, entersState, VoiceConnectionStatus, getVoiceConnection } = require('@discordjs/voice');
const { decrypt } = require('../../core/secrets');
const logger = require('../../core/logger');

const VOICE_TYPES = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];
const instances = new Map(); // entry.id -> { client, status, error, timer }

const status = (id) => instances.get(id) || { status: 'stopped' };

function setState(id, patch) {
  instances.set(id, { ...status(id), ...patch });
}

function connect(entry, client) {
  const inst = instances.get(entry.id);
  if (!inst || inst.client !== client) return;
  const guild = client.guilds.cache.get(entry.guildId);
  if (!guild) return setState(entry.id, { status: 'error', error: 'البوت مو داخل السيرفر' });
  const channel = guild.channels.cache.get(entry.channelId);
  if (!channel || !VOICE_TYPES.includes(channel.type)) return setState(entry.id, { status: 'error', error: 'روم الفويس غير موجود' });
  if (!channel.permissionsFor(guild.members.me)?.has(['ViewChannel', 'Connect'])) {
    return setState(entry.id, { status: 'error', error: 'ما عنده صلاحية دخول الروم' });
  }

  getVoiceConnection(guild.id, entry.id)?.destroy();
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    group: entry.id, // several bots in one server need separate connection groups
    selfDeaf: true,
    selfMute: true,
  });
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch {
      connection.destroy();
      scheduleRejoin(entry, client);
    }
  });
  connection.on('error', (err) => logger.warn(`voice bot ${entry.name}:`, err.message));
  setState(entry.id, { status: 'running', error: null, channelName: channel.name, guildName: guild.name });
}

function scheduleRejoin(entry, client, delay = 10_000) {
  const inst = instances.get(entry.id);
  if (!inst || inst.client !== client) return;
  clearTimeout(inst.timer);
  setState(entry.id, { timer: setTimeout(() => connect(entry, client), delay) });
}

async function start(entry) {
  await stop(entry.id);
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  instances.set(entry.id, { client, status: 'starting' });
  client.on('error', (err) => logger.warn(`voice bot ${entry.name}:`, err.message));
  client.once('clientReady', () => connect(entry, client));
  // Moved or kicked from the channel → go back to the configured one.
  client.on('voiceStateUpdate', (before, after) => {
    if (after.id !== client.user?.id || after.guild.id !== entry.guildId) return;
    if (after.channelId !== entry.channelId) scheduleRejoin(entry, client, 3000);
  });
  try {
    await client.login(decrypt(entry.token));
  } catch (err) {
    instances.set(entry.id, { status: 'error', error: err.code === 'TokenInvalid' ? 'التوكن غير صالح' : 'فشل تسجيل الدخول' });
    client.destroy().catch(() => null);
    return false;
  }
  return true;
}

async function stop(id) {
  const inst = instances.get(id);
  if (!inst) return;
  clearTimeout(inst.timer);
  if (inst.client) {
    for (const guild of inst.client.guilds?.cache.values() || []) getVoiceConnection(guild.id, id)?.destroy();
    await inst.client.destroy().catch(() => null);
  }
  instances.set(id, { status: 'stopped' });
}

module.exports = { start, stop, status, VOICE_TYPES };
