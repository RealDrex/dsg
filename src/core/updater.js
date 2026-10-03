// Auto-update from git: fetch → fast-forward → npm install (if needed) → check → restart.
// Rolls back to the previous commit if the new version fails the command check.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, exec } = require('node:child_process');
const logger = require('./logger');

const ROOT = path.join(__dirname, '..', '..');
const RESTART_CODE = 75; // start.bat restarts immediately on this code
const enabled = () => process.env.AUTO_UPDATE !== 'false';
const intervalMs = () => Math.max(5, Number(process.env.UPDATE_INTERVAL_MINUTES) || 30) * 60_000;

const run = (cmd, args, timeout = 120_000) => new Promise((resolve, reject) => {
  execFile(cmd, args, { cwd: ROOT, timeout, windowsHide: true }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout.trim())));
});
const shell = (command, timeout = 600_000) => new Promise((resolve, reject) => {
  exec(command, { cwd: ROOT, timeout, windowsHide: true }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout.trim())));
});
const git = (...args) => run('git', args);
const lockHash = () => {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'package-lock.json'))).digest('hex');
  } catch {
    return null;
  }
};

async function version() {
  try {
    const [hash, date] = (await git('log', '-1', '--format=%h|%cI')).split('|');
    return { hash, date };
  } catch {
    return { hash: require('../../package.json').version, date: null };
  }
}

let busy = false;

/** Checks for updates; with apply=true installs them. Returns a status object. */
async function check({ apply = false } = {}) {
  if (!fs.existsSync(path.join(ROOT, '.git'))) return { status: 'no-git' };
  if (busy) return { status: 'busy' };
  busy = true;
  try {
    try {
      await git('fetch', '--quiet');
    } catch (err) {
      return { status: 'fetch-failed', error: err.message.split('\n')[0] };
    }
    let upstream;
    try {
      upstream = await git('rev-parse', '@{u}');
    } catch {
      return { status: 'no-upstream' };
    }
    const local = await git('rev-parse', 'HEAD');
    if (local === upstream) return { status: 'up-to-date' };
    const behind = Number(await git('rev-list', '--count', 'HEAD..@{u}'));
    if (!behind) return { status: 'up-to-date' };
    const log = (await git('log', '--format=%h %s', '-10', 'HEAD..@{u}')).split('\n').filter(Boolean);
    if (!apply) return { status: 'available', behind, log };

    const dirty = (await git('status', '--porcelain', '--untracked-files=no')).trim();
    if (dirty) return { status: 'dirty', files: dirty.split('\n').slice(0, 5) };

    const lockBefore = lockHash();
    await git('merge', '--ff-only', '@{u}');
    const lockChanged = lockHash() !== lockBefore;
    try {
      if (lockChanged) await shell('npm install --omit=dev --no-audit --no-fund');
      await run(process.execPath, [path.join('scripts', 'check.js')]);
    } catch (err) {
      logger.error('التحديث فشل الفحص — رجعت للنسخة السابقة:', err.message.split('\n').slice(0, 3).join(' '));
      await git('reset', '--hard', local);
      if (lockChanged) await shell('npm install --omit=dev --no-audit --no-fund').catch(() => null);
      return { status: 'failed', error: err.message.split('\n')[0] };
    }
    return { status: 'updated', from: local.slice(0, 7), to: upstream.slice(0, 7), behind, log };
  } finally {
    busy = false;
  }
}

async function notifyOwners(client, text) {
  const ids = new Set(require('../config').ownerIds);
  for (const guild of client.guilds.cache.values()) ids.add(guild.ownerId);
  for (const id of ids) {
    const user = await client.users.fetch(id).catch(() => null);
    await user?.send(text).catch(() => null);
  }
}

/** Applies an update and restarts the process (start.bat brings it back). */
async function updateAndRestart(client, { reason = 'تلقائي' } = {}) {
  const result = await check({ apply: true });
  if (result.status !== 'updated') return result;
  logger.info(`⬆️ تحديث (${reason}): ${result.from} → ${result.to} (${result.behind} تعديل) — إعادة تشغيل`);
  await notifyOwners(client, `⬆️ **Sword تحدّث** (${result.from} → ${result.to}):\n${result.log.map((l) => `• ${l}`).join('\n')}`);
  setTimeout(async () => {
    await client.destroy().catch(() => null);
    process.exit(RESTART_CODE);
  }, 2000);
  return result;
}

function schedule(client) {
  if (!enabled()) return logger.info('التحديث التلقائي مقفل (AUTO_UPDATE=false)');
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    return logger.warn('التحديث التلقائي يحتاج تثبيت البوت عن طريق git clone (شوف README)');
  }
  logger.info(`التحديث التلقائي شغال — يفحص كل ${intervalMs() / 60_000} دقيقة`);
  const tick = () => updateAndRestart(client).then((r) => {
    if (['failed', 'dirty', 'fetch-failed', 'no-upstream'].includes(r.status)) logger.warn('التحديث التلقائي:', r.status, r.error || r.files?.join(', ') || '');
  }).catch((err) => logger.error('التحديث التلقائي:', err.message));
  setTimeout(tick, 60_000).unref();
  setInterval(tick, intervalMs()).unref();
}

module.exports = { check, updateAndRestart, schedule, version, RESTART_CODE };
