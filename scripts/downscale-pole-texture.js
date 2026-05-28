// One-shot: resize the pole's concrete texture from 2K to 1K so the
// repository ships a quarter-size asset (~4.4 MB -> ~1.1 MB).
//
// Usage (run from repo root after `npm i sharp`):
//   node scripts/downscale-pole-texture.js
//
// Overwrites the original JPG in place so room3d.js's path stays valid.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(
  'assets', 'texture', 'gravel_embedded_concrete_2k.blend', 'textures',
  'gravel_embedded_concrete_diff_2k.jpg'
);

(async () => {
  const before = fs.statSync(SRC).size;
  const buf = await sharp(SRC)
    .resize({ width: 1024, withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  fs.writeFileSync(SRC, buf);
  const after = fs.statSync(SRC).size;
  console.log(`${SRC}`);
  console.log(`  ${(before / 1024 / 1024).toFixed(2)} MB -> ${(after / 1024 / 1024).toFixed(2)} MB`);
})().catch(e => { console.error(e); process.exit(1); });
