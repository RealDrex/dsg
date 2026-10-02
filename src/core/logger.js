// Console + daily log files (logs/sword-YYYY-MM-DD.log) so a server keeps history.
const fs = require('node:fs');
const path = require('node:path');
const { inspect } = require('node:util');

const c = { reset: '\x1b[0m', gray: '\x1b[90m', red: '\x1b[31m', yellow: '\x1b[33m', white: '\x1b[97m' };
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const LOG_DIR = process.env.LOG_DIR || 'logs';
let fileOk = process.env.LOG_FILES !== 'false';

function toFile(tag, args) {
  if (!fileOk) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const line = args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 4 }))).join(' ');
    fs.appendFileSync(path.join(LOG_DIR, `sword-${stamp().slice(0, 10)}.log`), `${stamp()} ${tag} ${line}\n`);
  } catch {
    fileOk = false; // read-only disk etc. — keep console logging only
  }
}

const write = (color, tag, args) => {
  console.log(`${c.gray}${stamp()}${c.reset} ${color}${tag}${c.reset}`, ...args);
  toFile(tag, args);
};

module.exports = {
  info: (...args) => write(c.white, 'INFO ', args),
  warn: (...args) => write(c.yellow, 'WARN ', args),
  error: (...args) => write(c.red, 'ERROR', args),
};
