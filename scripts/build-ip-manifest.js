// scripts/build-ip-manifest.js
// Walk assets/stickers/ip-stickers/<ip>/ and assets/projects/ip/<ip>/
// to produce assets/ip-manifest.json 和 assets/ip-manifest-private.json。
// Run after adding/removing IP assets:
//   node scripts/build-ip-manifest.js
import fs from 'node:fs';
import path from 'node:path';

const STICKER_ROOT = path.join('assets', 'stickers', 'ip-stickers');
const PROJECT_ROOT = path.join('assets', 'projects', 'ip');
const OUT_PUBLIC = path.join('assets', 'ip-manifest.json');
const OUT_PRIVATE = path.join('assets', 'ip-manifest-private.json');

// 原保密 IP（全站公开后仅作历史拆分保留）。name → 显示名（hover tag / 详情页）。
const PRIVATE_IPS = { keaitianqi: '可爱天气' };

const IMG_RE = /\.(png|jpg|jpeg|webp)$/i;

function listDirs(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readdirSync(p, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
}

// Sort by the trailing integer in the filename so "...g 2.png" comes before
// "...g 10.png". Files without a trailing number fall back to lexical sort.
function naturalSort(a, b) {
  const ra = a.match(/(\d+)(?=\.[^.]+$)/);
  const rb = b.match(/(\d+)(?=\.[^.]+$)/);
  if (ra && rb) {
    const da = parseInt(ra[1], 10), db = parseInt(rb[1], 10);
    if (da !== db) return da - db;
  }
  return a.localeCompare(b);
}
function listImages(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readdirSync(p)
    .filter(n => IMG_RE.test(n))
    .sort(naturalSort)
    .map(n => path.join(p, n).split(path.sep).join('/'));
}

const ipNames = listDirs(STICKER_ROOT);
const pub = { ips: [] }, prv = { ips: [] };
for (const name of ipNames) {
  const stickers   = listImages(path.join(STICKER_ROOT, name));
  const longImages = listImages(path.join(PROJECT_ROOT, name));
  if (PRIVATE_IPS[name]) {
    prv.ips.push({ name, label: PRIVATE_IPS[name], stickers, longImages });
  } else {
    pub.ips.push({ name, stickers, longImages });
  }
}
fs.writeFileSync(OUT_PUBLIC, JSON.stringify(pub, null, 2));
fs.writeFileSync(OUT_PRIVATE, JSON.stringify(prv, null, 2));
console.log(`wrote ${OUT_PUBLIC} (${pub.ips.length} IPs)`);
console.log(`wrote ${OUT_PRIVATE} (${prv.ips.length} private IPs)`);
for (const ip of [...pub.ips, ...prv.ips]) {
  console.log(`  - ${ip.name}: ${ip.stickers.length} stickers, ${ip.longImages.length} long images`);
}
