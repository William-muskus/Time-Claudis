#!/usr/bin/env node
/**
 * Measure a rendered frame against the palette contract.
 *
 * src/render/palette.js promises one thing above all: everything is either
 * warm (hue 20-50) or cool (hue 230-280), and nothing in between, because
 * flat-shaded low-poly geometry has no surface detail and so the SHADING has
 * to carry hue information rather than only brightness.
 *
 * That promise is easy to state and impossible to eyeball, especially at
 * golden hour where every honest frame is warm-dominated. So measure it. A
 * frame that is 72% warm and 9% cool is not a split; it is a monochrome
 * orange wash that happens to contain a few blue shutters.
 *
 *   node tools/verify/palette-check.mjs artifacts/foo/bar.png [...]
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** Minimal PNG decoder: enough for what Playwright writes. */
function readPng(path) {
  const d = readFileSync(path);
  let pos = 8, w = 0, h = 0, colorType = 6, idat = [];
  while (pos < d.length) {
    const len = d.readUInt32BE(pos);
    const type = d.toString('ascii', pos + 4, pos + 8);
    const body = d.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); colorType = body[9]; }
    else if (type === 'IDAT') idat.push(body);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const ch = colorType === 2 ? 3 : 4;
  const stride = w * ch + 1;
  const rows = [];
  let prev = Buffer.alloc(stride - 1);
  for (let y = 0, i = 0; y < h; y++, i += stride) {
    const f = raw[i];
    const line = Buffer.from(raw.subarray(i + 1, i + stride));
    for (let x = 0; x < line.length; x++) {
      const a = x >= ch ? line[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      if (f === 1) line[x] = (line[x] + a) & 255;
      else if (f === 2) line[x] = (line[x] + b) & 255;
      else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    rows.push(line); prev = line;
  }
  return { w, h, ch, rows };
}

function hue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return { h: 0, s: 0, v: mx / 255 };
  let hh;
  if (mx === r) hh = ((g - b) / d) % 6;
  else if (mx === g) hh = (b - r) / d + 2;
  else hh = (r - g) / d + 4;
  return { h: ((hh * 60) + 360) % 360, s: d / mx, v: mx / 255 };
}

export function analyse(path) {
  const { w, h, ch, rows } = readPng(path);
  let clipped = 0, dark = 0, n = 0, warm = 0, cool = 0, mid = 0, sat = 0;
  // Skip the HUD bands top and bottom; we are judging the world.
  for (let y = Math.floor(h * 0.12); y < Math.floor(h * 0.88); y += 2) {
    const row = rows[y];
    for (let x = 0; x < w; x += 2) {
      const r = row[x * ch], g = row[x * ch + 1], b = row[x * ch + 2];
      n++;
      if (r > 250 && g > 245) clipped++;
      if (r < 18 && g < 18 && b < 18) dark++;
      const { h: hh, s, v } = hue(r, g, b);
      if (s < 0.12 || v < 0.1) continue;
      sat++;
      if (hh < 65 || hh >= 330) warm++;
      else if (hh >= 180 && hh < 300) cool++;
      else mid++;
    }
  }
  return {
    file: path.split('/').slice(-2).join('/'),
    clippedPct: +(clipped / n * 100).toFixed(1),
    darkPct: +(dark / n * 100).toFixed(1),
    warmPct: +(warm / sat * 100).toFixed(1),
    coolPct: +(cool / sat * 100).toFixed(1),
    midPct: +(mid / sat * 100).toFixed(1),
  };
}

/**
 * The contract, as numbers.
 *
 * Golden hour is legitimately warm-dominated, so the target is not balance —
 * it is that the cool side is PRESENT enough to read as a second hue rather
 * than as an accident.
 */
export const TARGET = {
  clippedPct: 4.0,   // above this the sunlit stone is blowing out
  darkPct: 3.0,      // above this the shadows are holes
  coolPct: 16.0,     // below this there is no split, only a wash
};

if (process.argv[1]?.endsWith('palette-check.mjs')) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: palette-check.mjs <png...>'); process.exit(2); }
  let worst = 0;
  console.log('file'.padEnd(34), 'clip%'.padStart(6), 'dark%'.padStart(6), 'warm%'.padStart(6), 'cool%'.padStart(6), 'mid%'.padStart(6));
  for (const f of files) {
    const a = analyse(f);
    const bad = (a.clippedPct > TARGET.clippedPct ? 1 : 0)
              + (a.darkPct > TARGET.darkPct ? 1 : 0)
              + (a.coolPct < TARGET.coolPct ? 1 : 0);
    worst = Math.max(worst, bad);
    console.log(
      a.file.padEnd(34),
      String(a.clippedPct).padStart(6),
      String(a.darkPct).padStart(6),
      String(a.warmPct).padStart(6),
      String(a.coolPct).padStart(6),
      String(a.midPct).padStart(6),
      bad ? '  <-- ' + [
        a.clippedPct > TARGET.clippedPct && 'clipping',
        a.darkPct > TARGET.darkPct && 'crushed',
        a.coolPct < TARGET.coolPct && 'no cool side',
      ].filter(Boolean).join(', ') : '');
  }
  process.exit(worst ? 1 : 0);
}
