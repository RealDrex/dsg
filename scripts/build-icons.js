// Dev tool: regenerates the icon assets from src/core/icon-list.js.
//   npm i -D lucide-static @resvg/resvg-js && node scripts/build-icons.js
// Outputs (committed, so servers never need these dev packages):
//   assets/icons/<name>.png    128px PNGs uploaded to Discord as app emojis
//   src/web/public/icons.svg   SVG sprite for the website
const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');
const LIST = require('../src/core/icon-list');

const ROOT = path.join(__dirname, '..');
const LUCIDE = path.dirname(require.resolve('lucide-static/package.json'));
const OUT_PNG = path.join(ROOT, 'assets', 'icons');
fs.mkdirSync(OUT_PNG, { recursive: true });

const DOT = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>';

function source(icon) {
  if (icon.src === 'dot') return DOT;
  return fs.readFileSync(path.join(LUCIDE, 'icons', `${icon.src}.svg`), 'utf8').replace(/<!--.*?-->/s, '').trim();
}

const symbols = [];
for (const [name, icon] of Object.entries(LIST)) {
  const svg = source(icon);
  // PNG for Discord: coloured, slightly thicker strokes so it reads at emoji size.
  const colored = svg.replace(/currentColor/g, icon.color).replace(/stroke-width="2"/, 'stroke-width="2.2"');
  const png = new Resvg(colored, { fitTo: { mode: 'width', value: 128 } }).render().asPng();
  fs.writeFileSync(path.join(OUT_PNG, `${name}.png`), png);
  // Sprite symbol for the website (inherits CSS colour).
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  const attrs = icon.src === 'dot' ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  symbols.push(`<symbol id="${name}" viewBox="0 0 24 24" ${attrs}>${inner.replace(/\s*\n\s*/g, '')}</symbol>`);
}
fs.writeFileSync(path.join(ROOT, 'src', 'web', 'public', 'icons.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg"><!-- Icons: Lucide (ISC) https://lucide.dev -->${symbols.join('')}</svg>\n`);
console.log(`✔ ${symbols.length} icons → assets/icons/*.png + src/web/public/icons.svg`);
