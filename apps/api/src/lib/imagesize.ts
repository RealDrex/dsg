/**
 * Width in pixels of an image from its header bytes (PNG, GIF, ICO — the
 * largest icon inside —, WebP, JPEG), or null when the format is unknown.
 * Used to skip blurry icons and tiny placeholder images.
 */
export function imageWidth(b: Buffer): number | null {
  if (b.length < 24) return null;
  // PNG: signature, then IHDR width
  if (b.readUInt32BE(0) === 0x89504e47) return b.readUInt32BE(16);
  // GIF87a / GIF89a
  if (b.toString('ascii', 0, 4) === 'GIF8') return b.readUInt16LE(6);
  // ICO: reserved 0, type 1, count; 16-byte entries, width 0 means 256
  if (b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1) {
    const n = Math.min(b.readUInt16LE(4), 32);
    let max = 0;
    for (let i = 0; i < n && 6 + i * 16 < b.length; i++) max = Math.max(max, b[6 + i * 16] || 256);
    return max || null;
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X chunk
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' && b.length >= 30) {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return b.readUInt16LE(26) & 0x3fff;
    if (chunk === 'VP8L') return 1 + (((b[22]! & 0x3f) << 8) | b[21]!);
    if (chunk === 'VP8X') return 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16));
    return null;
  }
  // JPEG: walk segments to the first SOFn marker
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return b.readUInt16BE(i + 7);
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  }
  return null;
}

export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/avif']);
