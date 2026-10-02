const c = { reset: '\x1b[0m', gray: '\x1b[90m', red: '\x1b[31m', yellow: '\x1b[33m', white: '\x1b[97m' };
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const write = (color, tag, args) => console.log(`${c.gray}${stamp()}${c.reset} ${color}${tag}${c.reset}`, ...args);

module.exports = {
  info: (...args) => write(c.white, '⚔  INFO ', args),
  warn: (...args) => write(c.yellow, '⚠  WARN ', args),
  error: (...args) => write(c.red, '✖  ERROR', args),
};
