// Run only the website (no Discord connection) — handy for previewing the design.
const { loadPlugins } = require('../core/loader');
const { plugins } = loadPlugins();
require('./server').start(null, plugins);
