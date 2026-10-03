// Game visuals drawn at runtime: lobby banners, the roulette wheel and winner cards.
// Uses the bundled Cairo font so Arabic shapes correctly on any server (Windows included).
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { ASSETS } = require('../../core/theme');

GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'Cairo-ExtraBold.ttf'), 'Cairo Heavy');
GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'Cairo-SemiBold.ttf'), 'Cairo Semi');

const C = {
  bg: '#050505',
  text: '#f2f2f2',
  muted: '#9a9a9a',
  silver: '#d9d9d9',
  slate: '#353a45',
  steel: '#5b606b',
  crimson: '#9e1b1b',
  crimsonLight: '#c42a31',
  gold: '#e0b84a',
};

const cache = new Map();
const img = async (file) => {
  if (!cache.has(file)) cache.set(file, await loadImage(path.join(ASSETS, file)));
  return cache.get(file);
};

// Avatars are fetched once and cached; a placeholder circle is drawn when unavailable.
const avatars = new Map();
async function avatar(url) {
  if (!url) return null;
  if (avatars.has(url)) return avatars.get(url);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const image = await loadImage(Buffer.from(await res.arrayBuffer()));
    if (avatars.size > 300) avatars.delete(avatars.keys().next().value);
    avatars.set(url, image);
    return image;
  } catch {
    return null;
  }
}

function fit(ctx, text, maxWidth, font, start) {
  let size = start;
  ctx.font = `${size}px "${font}"`;
  while (size > 14 && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = `${size}px "${font}"`;
  }
  return size;
}

const ellipsis = (text, max) => ([...text].length > max ? `${[...text].slice(0, max - 1).join('')}…` : text);

function circleImage(ctx, image, x, y, r, fallbackText) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (image) ctx.drawImage(image, x - r, y - r, r * 2, r * 2);
  else {
    ctx.fillStyle = C.slate;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = C.text;
    ctx.font = `${Math.round(r * 0.9)}px "Cairo Heavy"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText([...(fallbackText || '?')][0], x, y + 2);
  }
  ctx.restore();
}

// Dark Sword backdrop: gradient, crimson glow, samurai on the left, logo watermark.
async function backdrop(ctx, w, h, { samurai = true, glow = 'crimson' } = {}) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0d0d0f');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (glow) {
    const rg = ctx.createRadialGradient(w * 0.78, h * 0.45, 10, w * 0.78, h * 0.45, w * 0.55);
    // 'crimson' for most games, 'mono' (white) for the black-and-white roulette
    rg.addColorStop(0, glow === 'mono' ? 'rgba(220,220,230,0.14)' : 'rgba(158,27,27,0.28)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
  }

  if (samurai) {
    // Samurai faded into the background through an alpha mask (no hard edge).
    const s = await img('samurai.png');
    const sh = h;
    const sw = (s.width / s.height) * sh;
    const layer = createCanvas(Math.ceil(sw), h);
    const lc = layer.getContext('2d');
    lc.translate(sw, 0);
    lc.scale(-1, 1); // face towards the text
    lc.drawImage(s, 0, 0, sw, sh);
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'destination-in';
    const mask = lc.createLinearGradient(0, 0, sw, 0);
    mask.addColorStop(0, 'rgba(0,0,0,0.75)');
    mask.addColorStop(0.55, 'rgba(0,0,0,0.6)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = mask;
    lc.fillRect(0, 0, sw, h);
    ctx.drawImage(layer, 0, 0);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
}

async function footer(ctx, w, h) {
  const logo = await img('logo-round.png');
  ctx.globalAlpha = 0.85;
  ctx.drawImage(logo, 26, h - 58, 34, 34);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '18px "Cairo Semi"';
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '6px';
  ctx.fillText('SWORD GAMES', 72, h - 40);
  ctx.letterSpacing = '0px';
  ctx.textBaseline = 'alphabetic';
}

/** Lobby banner for a game (title, subtitle and its icon). */
async function banner(game, subtitle = 'للدخول إلى اللعبة اضغط دخول') {
  const key = `banner:${game.key}:${subtitle}`;
  if (cache.has(key)) return cache.get(key);
  const w = 1000;
  const h = 400;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  await backdrop(ctx, w, h);

  const right = w - 70;
  // icon badge
  const icon = await img(`icons/${game.icon}.png`);
  ctx.fillStyle = '#141417';
  ctx.strokeStyle = '#2a2a2f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(right - 92, 52, 92, 92, 22);
  ctx.fill();
  ctx.stroke();
  ctx.drawImage(icon, right - 74, 70, 56, 56);

  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.text;
  fit(ctx, game.name, 560, 'Cairo Heavy', 110);
  ctx.fillText(game.name, right, 262);
  ctx.fillStyle = C.muted;
  fit(ctx, subtitle, 560, 'Cairo Semi', 32);
  ctx.fillText(subtitle, right, 314);
  ctx.fillStyle = C.crimson;
  ctx.fillRect(right - 170, 350, 170, 5);
  await footer(ctx, w, h);

  const buffer = canvas.toBuffer('image/png');
  cache.set(key, buffer);
  return buffer;
}

/**
 * Roulette wheel: one slice per player, rotated so the chosen slice sits at the pointer,
 * with the chosen player's avatar in the middle.
 */
// Draws the wheel body (rim, slices, labels, hub ring, pointer) rotated by `rotation`.
// `hubImage` is drawn in the center circle when given (the chosen avatar on the final frame).
function drawWheelBody(ctx, players, rotation, { cx, cy, R, hubImage, hubName }) {
  const n = players.length;
  const slice = (Math.PI * 2) / n;

  // rim
  ctx.beginPath();
  ctx.arc(cx, cy, R + 16, 0, Math.PI * 2);
  ctx.fillStyle = '#17181c';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#2b2d33';
  ctx.stroke();

  const palette = ['#eeeeee', '#0a0a0b']; // pure black & white
  players.forEach((p, i) => {
    const a0 = rotation + i * slice;
    const a1 = a0 + slice;
    let fill = palette[i % 2];
    if (n % 2 === 1 && i === n - 1 && n > 1) fill = '#1a1a1d'; // avoid two equal neighbours
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a0, a1);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = '#3a3a40'; // light separator so black slices stay distinct
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    const mid = a0 + slice / 2;
    ctx.rotate(mid);
    const light = fill === '#eeeeee';
    ctx.fillStyle = light ? '#111' : '#f2f2f2';
    ctx.textBaseline = 'middle';
    const label = ellipsis(p.name, 12);
    const flip = Math.cos(mid) < 0; // keep text upright on the left half
    if (flip) ctx.rotate(Math.PI);
    ctx.textAlign = 'center';
    ctx.font = `${n > 14 ? 18 : 24}px "Cairo Heavy"`;
    ctx.fillText(String(i + 1), flip ? -(R - 30) : R - 30, 0);
    fit(ctx, label, R - 150, 'Cairo Heavy', n > 14 ? 18 : 26);
    ctx.textAlign = flip ? 'left' : 'right';
    ctx.fillText(label, flip ? -(R - 58) : R - 58, 0);
    ctx.restore();
  });

  // hub
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = '#0b0b0d';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = C.silver;
  ctx.stroke();
  if (hubImage !== undefined) circleImage(ctx, hubImage, cx, cy, R * 0.26, hubName);

  // pointer (fixed at the right)
  ctx.beginPath();
  ctx.moveTo(cx + R - 10, cy);
  ctx.lineTo(cx + R + 42, cy - 26);
  ctx.lineTo(cx + R + 42, cy + 26);
  ctx.closePath();
  ctx.fillStyle = C.silver;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#0b0b0d';
  ctx.stroke();
}

// Rotation that puts slice `index` centred under the pointer (angle 0, to the right).
const finalRotation = (index, n) => -(index + 0.5) * ((Math.PI * 2) / n);

/** Static wheel PNG with the chosen slice under the pointer and its avatar in the hub. */
async function wheel(players, chosenIndex, { title } = {}) {
  const size = 640;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  await backdrop(ctx, size, size, { samurai: true, glow: 'mono' });
  const cx = size / 2;
  const cy = size / 2 + 8;
  const R = 268;
  drawWheelBody(ctx, players, finalRotation(chosenIndex, players.length), {
    cx, cy, R, hubImage: await avatar(players[chosenIndex]?.avatar), hubName: players[chosenIndex]?.name,
  });
  if (title) {
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.fillStyle = C.text;
    fit(ctx, title, size - 80, 'Cairo Heavy', 30);
    ctx.fillText(title, cx, 38);
  }
  return canvas.toBuffer('image/png');
}

/**
 * Animated spinning wheel GIF that decelerates and lands on `chosenIndex`.
 * Plays once and holds on the final frame (so it "stops" on the winner).
 */
async function spinGif(players, chosenIndex, { title } = {}) {
  const { GIFEncoder, quantize, applyPalette } = require('gifenc');
  const size = 420;
  const cx = size / 2;
  const cy = size / 2 + 6;
  const R = 176;
  const n = players.length;
  const target = finalRotation(chosenIndex, n);
  const turns = 4 + (chosenIndex % 3); // a little variety
  const start = target - (Math.PI * 2 * turns) - Math.PI; // spin clockwise into place
  const frames = 26;

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const bg = await (async () => {
    const c = createCanvas(size, size);
    await backdrop(c.getContext('2d'), size, size, { samurai: true, glow: 'mono' });
    return c;
  })();

  const gif = GIFEncoder();
  const easeOut = (t) => 1 - (1 - t) ** 3;
  for (let f = 0; f < frames; f += 1) {
    const t = easeOut(f / (frames - 1));
    const rotation = start + (target - start) * t;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(bg, 0, 0);
    drawWheelBody(ctx, players, rotation, { cx, cy, R });
    if (title) {
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.fillStyle = C.text;
      fit(ctx, title, size - 60, 'Cairo Heavy', 24);
      ctx.fillText(title, cx, 30);
    }
    const { data } = ctx.getImageData(0, 0, size, size);
    const palette = quantize(data, 128);
    const index = applyPalette(data, palette);
    const last = f === frames - 1;
    gif.writeFrame(index, size, size, {
      palette,
      delay: last ? 2000 : 45 + Math.round(70 * t), // slows down as it lands, holds at the end
      repeat: -1, // play once, then freeze on the last frame
    });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

/** Winner card: avatar, name, game and points. */
async function winnerCard(player, game, amount) {
  const w = 1000;
  const h = 360;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  await backdrop(ctx, w, h);
  const ax = w - 190;
  const ay = h / 2 + 6;
  ctx.beginPath();
  ctx.arc(ax, ay, 118, 0, Math.PI * 2);
  ctx.fillStyle = '#0b0b0d';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = C.gold;
  ctx.stroke();
  circleImage(ctx, await avatar(player.avatar), ax, ay, 106, player.name);
  const crown = await img('icons/crown.png');
  ctx.drawImage(crown, ax - 36, ay - 176, 72, 72);

  const right = ax - 160;
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.fillStyle = C.crimsonLight;
  ctx.font = '30px "Cairo Heavy"';
  ctx.fillText(`الفائز في ${game.name}`, right, 120);
  ctx.fillStyle = C.text;
  fit(ctx, player.name, 560, 'Cairo Heavy', 84);
  ctx.fillText(player.name, right, 214);
  ctx.fillStyle = C.gold;
  ctx.font = '36px "Cairo Heavy"';
  ctx.fillText(`+${amount} نقطة`, right, 276);
  await footer(ctx, w, h);
  return canvas.toBuffer('image/png');
}

module.exports = { banner, wheel, spinGif, winnerCard };
