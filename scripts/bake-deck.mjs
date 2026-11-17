#!/usr/bin/env node
// Bake a deck's court photos with the photo treatments (deck-photo-spec.md, design-handback-2 §1).
//
//   npm run bake -- public/decks/lily
//   npm run bake -- <deck-folder> [--deck <id>] [--treatments tinted,tritone] [--quality 80]
//                                 [--stock #hex] [--black #hex] [--red #hex] [--blue #hex] [--green #hex]
//
// Reads the 4:5 court photos in the folder (JS.jpg, QH.jpg, KD.png … and AS if present; jpg,
// jpeg, png or webp), centre-crops anything that is not 4:5, resizes down to at most 800 x 1000
// (never up), and writes, beside them in <deck-folder>/baked/:
//
//   <CODE>.<treatment>.jpg       treated in the court's two-colour ink (spades and clubs black,
//                                hearts and diamonds red)
//   <CODE>.<treatment>.4c.jpg    treated in its four-colour ink, only where that ink differs
//                                (diamonds blue, clubs green)
//
// for each treatment (tinted and tritone by default; tinted is always baked, because the
// mini-slot under 90 px always shows it). The originals are never touched. The treatment is
// src/cards/photoTreatment.ts itself, run here through Node's TypeScript type stripping, so the
// browser preview and the baked files are the same arithmetic. The deck's tokens (stock and
// inks) come from src/cards/deckTokens.ts when the folder's name (or --deck) is a known deck,
// otherwise the Enamel house tokens; flags override either.
//
// When the folder is under public/, the script records what it baked in src/cards/baked.ts,
// which is how CardView knows the renders exist. Re-run it whenever the photos or the deck's
// stock or inks change: renders baked with other tokens are ignored by the client.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { COURT_CODES, DECKS, suitInk } from '../src/cards/deckTokens.ts';
import { treat } from '../src/cards/photoTreatment.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_W = 800;
const MAX_H = 1000;
const SUITS = 'SHDC';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args._[0] || args.help !== undefined) {
  console.error('Usage: npm run bake -- <deck-folder> [--deck <id>] [--treatments tinted,tritone] [--quality 80]');
  process.exit(args._[0] ? 0 : 1);
}
const folder = resolve(args._[0]);
if (!existsSync(folder) || !statSync(folder).isDirectory()) {
  console.error(`No such folder: ${folder}`);
  process.exit(1);
}
const id = args.deck ?? basename(folder);
const base = DECKS[id] ?? DECKS.enamel;
const deck = {
  ...base,
  id,
  stock: args.stock ?? base.stock,
  inks: {
    black: args.black ?? base.inks.black,
    red: args.red ?? base.inks.red,
    blue: args.blue ?? base.inks.blue,
    green: args.green ?? base.inks.green,
  },
};
const treatments = [...new Set(['tinted', ...(args.treatments ?? 'tinted,tritone').split(',').map((t) => t.trim()).filter(Boolean)])];
for (const t of treatments) {
  if (t !== 'tinted' && t !== 'tritone') {
    console.error(`Unknown treatment "${t}" (tinted or tritone; natural is the original)`);
    process.exit(1);
  }
}
const quality = Number(args.quality ?? 80);
const outDir = join(folder, 'baked');
mkdirSync(outDir, { recursive: true });

const findPhoto = (code) => {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'JPG', 'JPEG', 'PNG', 'WEBP']) {
    const f = join(folder, `${code}.${ext}`);
    if (existsSync(f)) return f;
  }
  return null;
};

console.log(`Baking deck "${id}" from ${relative(ROOT, folder) || folder}`);
console.log(`  stock ${deck.stock} · inks black ${deck.inks.black} red ${deck.inks.red} blue ${deck.inks.blue} green ${deck.inks.green}`);
console.log(`  treatments ${treatments.join(', ')} · JPEG q${quality} · at most ${MAX_W} x ${MAX_H}, never upscaled`);

const codes = [];
const four = [];
let written = 0;
for (const code of [...COURT_CODES, 'AS']) {
  const src = findPhoto(code);
  if (!src) {
    if (code !== 'AS') console.warn(`  ${code}: no photo, skipped`);
    continue;
  }
  const s = SUITS.indexOf(code.slice(-1));
  const img = sharp(src).rotate();
  const meta = await img.metadata();
  // EXIF orientations 5-8 swap width and height.
  const swap = (meta.orientation ?? 1) >= 5;
  const w0 = swap ? meta.height : meta.width;
  const h0 = swap ? meta.width : meta.height;
  // Centre-crop to 4:5.
  let cw = w0;
  let ch = Math.round((w0 * 5) / 4);
  if (ch > h0) {
    ch = h0;
    cw = Math.round((h0 * 4) / 5);
  }
  const left = Math.floor((w0 - cw) / 2);
  const top = Math.floor((h0 - ch) / 2);
  const { data, info } = await img
    .extract({ left, top, width: cw, height: ch })
    .resize({ width: MAX_W, height: MAX_H, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const soft = info.width < 800 ? ' (soft at full size: under 800 x 1000)' : '';
  console.log(`  ${code}: ${w0} x ${h0}${cw !== w0 || ch !== h0 ? `, cropped to ${cw} x ${ch}` : ''} -> ${info.width} x ${info.height}${soft}`);

  const two = suitInk(deck, s, false);
  const fourInk = suitInk(deck, s, true);
  const variants = [{ ink: two, suffix: '' }];
  if (fourInk.toLowerCase() !== two.toLowerCase()) variants.push({ ink: fourInk, suffix: '.4c' });
  for (const t of treatments) {
    for (const v of variants) {
      const px = Buffer.from(data);
      treat(px, { treatment: t, ink: v.ink, stock: deck.stock });
      const file = join(outDir, `${code}.${t}${v.suffix}.jpg`);
      await sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } })
        .removeAlpha()
        .jpeg({ quality, mozjpeg: true })
        .toFile(file);
      written++;
    }
  }
  codes.push(code);
  if (variants.length > 1) four.push(code);
}

console.log(`Wrote ${written} renders to ${relative(ROOT, outDir) || outDir}`);

// Record the deck in src/cards/baked.ts when its renders are served from public/.
const pub = join(ROOT, 'public');
const registryFile = join(ROOT, 'src', 'cards', 'baked.ts');
if (outDir.startsWith(pub + sep)) {
  const dir = '/' + relative(pub, outDir).split(sep).join('/');
  let registry = {};
  if (existsSync(registryFile)) {
    const m = /\/\*BEGIN\*\/([\s\S]*)\/\*END\*\//.exec(readFileSync(registryFile, 'utf8'));
    if (m) registry = JSON.parse(m[1]);
  }
  registry[id] = { dir, treatments, codes, four, stock: deck.stock, inks: deck.inks, quality, bakedAt: new Date().toISOString().slice(0, 10) };
  writeFileSync(registryFile, [
    '// What scripts/bake-deck.mjs has baked, by deck. Written by that script: re-run it rather than',
    '// editing this by hand (npm run bake -- public/decks/<id>).',
    `export default /*BEGIN*/${JSON.stringify(registry, null, 2)}/*END*/;`,
    '',
  ].join('\n'));
  console.log(`Recorded "${id}" in ${relative(ROOT, registryFile)}`);
} else {
  console.log('Folder is outside public/, so nothing was recorded in src/cards/baked.ts.');
}
