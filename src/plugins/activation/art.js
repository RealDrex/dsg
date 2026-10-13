// Activation panel banners drawn at runtime (Sword theme: black steel + silver + crimson).
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { ASSETS } = require('../../core/theme');

GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'Cairo-ExtraBold.ttf'), 'Cairo Heavy');
GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'Cairo-SemiBold.ttf'), 'Cairo Semi');

const cache = new Map();
const imgCache = new Map();
const img = async (file) => {
  if (!imgCache.has(file)) imgCache.set(file, await loadImage(path.join(ASSETS, file)));
  return imgCache.get(file);
};

async function backdrop(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0d0d0f');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rg = ctx.createRadialGradient(w * 0.5, h * 0.35, 10, w * 0.5, h * 0.5, w * 0.6);
  rg.addColorStop(0, 'rgba(158,27,27,0.22)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, w, h);
  // samurai faded on the left
  try {
    const s = await img('samurai.png');
    const sh = h;
    const sw = (s.width / s.height) * sh;
    const layer = createCanvas(Math.ceil(sw), h);
    const lc = layer.getContext('2d');
    lc.drawImage(s, 0, 0, sw, sh);
    lc.globalCompositeOperation = 'destination-in';
    const mask = lc.createLinearGradient(0, 0, sw, 0);
    mask.addColorStop(0, 'rgba(0,0,0,0.55)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = mask;
    lc.fillRect(0, 0, sw, h);
    ctx.drawImage(layer, 0, 0);
  } catch { /* samurai optional */ }
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
}

// A wide banner with a big Latin title and an Arabic subtitle.
async function banner(title, subtitle) {
  const key = `${title}|${subtitle}`;
  if (cache.has(key)) return cache.get(key);
  const w = 1000;
  const h = 360;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  await backdrop(ctx, w, h);

  ctx.textAlign = 'center';
  ctx.direction = 'ltr';
  ctx.textBaseline = 'alphabetic';

  // Latin title
  ctx.letterSpacing = '8px';
  ctx.font = '78px "Cairo Heavy"';
  ctx.fillStyle = '#f2f2f2';
  ctx.fillText(title, w / 2, h / 2 - 2);
  ctx.letterSpacing = '0px';

  // crimson underline
  ctx.fillStyle = '#9e1b1b';
  ctx.fillRect(w / 2 - 110, h / 2 + 26, 220, 5);

  // Arabic subtitle
  ctx.direction = 'rtl';
  ctx.font = '34px "Cairo Semi"';
  ctx.fillStyle = '#b9b9b9';
  ctx.fillText(subtitle, w / 2, h / 2 + 86);

  // logo watermark
  try {
    const logo = await img('logo-round.png');
    ctx.globalAlpha = 0.9;
    ctx.drawImage(logo, w / 2 - 20, 34, 40, 40);
    ctx.globalAlpha = 1;
  } catch { /* logo optional */ }

  const buffer = canvas.toBuffer('image/png');
  cache.set(key, buffer);
  return buffer;
}

module.exports = { banner };
