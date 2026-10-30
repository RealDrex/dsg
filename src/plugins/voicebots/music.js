// Music playback for the extra voice bots. Audio is streamed from YouTube as
// native WebM/Opus and passed through WITHOUT re-encoding (no ffmpeg, no volume
// transformer, no filters) so the sound stays exactly as the source — the
// "crystal clear" the owner asked for. One queue + player per voice bot.
const {
  createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, getVoiceConnection,
} = require('@discordjs/voice');
const logger = require('../../core/logger');

const fail = (msg) => Object.assign(new Error(msg), { userFacing: true });

// play-dl is loaded lazily so the bot still boots if the optional dep is absent.
let playdl = null;
function play() {
  if (playdl) return playdl;
  try {
    playdl = require('play-dl');
  } catch {
    throw fail('مكتبة تشغيل الموسيقى غير مثبّتة — شغّل: npm install play-dl libsodium-wrappers');
  }
  return playdl;
}

const sessions = new Map(); // entry.id -> { player, queue:[], current }

function sessionOf(id) {
  let s = sessions.get(id);
  if (!s) {
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    s = { player, queue: [], current: null };
    player.on(AudioPlayerStatus.Idle, () => advance(id).catch((e) => logger.warn('music advance:', e.message)));
    player.on('error', (e) => { logger.warn('music player:', e.message); advance(id).catch(() => null); });
    sessions.set(id, s);
  }
  return s;
}

// Resolve a query (YouTube link, playlist, or free text) into a list of tracks.
async function resolveTracks(query, requestedBy) {
  const p = play();
  let kind = false;
  try { kind = await p.validate(query); } catch { kind = false; }

  if (kind === 'yt_playlist') {
    const pl = await p.playlist_info(query, { incomplete: true });
    const vids = await pl.all_videos();
    return vids.map((v) => ({ title: v.title || 'Track', url: v.url, requestedBy }));
  }
  if (kind === 'yt_video') {
    const info = await p.video_info(query);
    const d = info.video_details;
    return [{ title: d.title || 'Track', url: d.url, requestedBy }];
  }
  // Free text or an unsupported link → search YouTube for the closest match.
  const results = await p.search(query, { limit: 1, source: { youtube: 'video' } });
  if (!results.length) return [];
  return [{ title: results[0].title || 'Track', url: results[0].url, requestedBy }];
}

async function advance(id) {
  const s = sessions.get(id);
  if (!s) return;
  const next = s.queue.shift();
  if (!next) { s.current = null; return; }
  s.current = next;
  const p = play();
  // quality 2 = highest audio; compatibility off keeps the native Opus stream.
  const stream = await p.stream(next.url, { quality: 2, discordPlayerCompatibility: false });
  const resource = createAudioResource(stream.stream, { inputType: stream.type, inlineVolume: false });
  s.player.play(resource);
}

// Queue a query on a running voice bot and start playing if idle.
async function enqueue(entry, query, requestedBy) {
  const connection = getVoiceConnection(entry.guildId, entry.id);
  if (!connection) throw fail('البوت مو متصل بالفويس — شغّله أول من Start.');
  const tracks = await resolveTracks(query, requestedBy);
  if (!tracks.length) throw fail('ما لقيت نتيجة لهذا البحث.');
  const s = sessionOf(entry.id);
  s.queue.push(...tracks);
  connection.subscribe(s.player);
  if (!s.current) await advance(entry.id);
  return tracks;
}

function skip(id) {
  const s = sessions.get(id);
  if (!s || !s.current) return false;
  s.player.stop(); // triggers Idle → advance to the next track
  return true;
}

function stop(id) {
  const s = sessions.get(id);
  if (!s) return;
  s.queue = [];
  s.current = null;
  s.player.stop();
}

function state(id) {
  const s = sessions.get(id);
  return { current: s?.current || null, queue: s?.queue || [] };
}

module.exports = { enqueue, skip, stop, state };
