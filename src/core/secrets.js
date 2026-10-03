// AES-256-GCM for secrets at rest (e.g. voice bot tokens).
// Key: TOKEN_SECRET in .env, or a random key generated once into data/secret.key.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');

let key;
function getKey() {
  if (key) return key;
  if (process.env.TOKEN_SECRET) {
    key = crypto.createHash('sha256').update(process.env.TOKEN_SECRET).digest();
    return key;
  }
  const file = path.join(path.dirname(path.resolve(config.dbPath)), 'secret.key');
  if (fs.existsSync(file)) key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  else {
    key = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, key.toString('hex'), { mode: 0o600 });
  }
  return key;
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decrypt(payload) {
  const [version, iv, tag, data] = String(payload).split(':');
  if (version !== 'v1') throw new Error('unknown secret format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
