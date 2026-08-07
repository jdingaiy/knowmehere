// scripts/optimize-images.mjs
// 全站图片压缩：assets/projects 与 assets/stickers 下的 PNG/JPG 原地转 WebP，
// 超限宽度的等比缩小；forest_pan.jpg 原地重压缩。转换成功后删除原文件。
//
// 用法：node scripts/optimize-images.mjs
// 幂等：已是 .webp 的文件会跳过，可重复跑。
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const JOBS = [
  // 详情页长图/图集：展示宽 1100，留 2x → 1600 足够
  { dir: 'assets/projects', maxW: 1600, quality: 80 },
  // 电线杆贴纸：屏幕上最大 ~400px，2x DPR → 1024 足够；保留 alpha
  { dir: 'assets/stickers', maxW: 1024, quality: 90 },
];

const IMG_RE = /\.(png|jpg|jpeg)$/i;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (IMG_RE.test(e.name)) out.push(p);
  }
  return out;
}

const mb = (n) => (n / 1048576).toFixed(2);

let totalBefore = 0, totalAfter = 0, converted = 0;

for (const job of JOBS) {
  if (!fs.existsSync(job.dir)) continue;
  for (const src of walk(job.dir)) {
    const dst = src.replace(IMG_RE, '.webp');
    const before = fs.statSync(src).size;
    try {
      const img = sharp(src);
      const meta = await img.metadata();
      if (meta.width > job.maxW) img.resize({ width: job.maxW });
      await img.webp({ quality: job.quality }).toFile(dst);
      const after = fs.statSync(dst).size;
      fs.unlinkSync(src);
      totalBefore += before; totalAfter += after; converted++;
      console.log(`${src} -> ${path.basename(dst)}  ${mb(before)} -> ${mb(after)} MB`);
    } catch (e) {
      console.error(`FAIL ${src}: ${e.message}`);
    }
  }
}

// 森林全景背景：原地重压缩（文件名被多处引用，保持不变）
const pano = 'assets/texture/forest_pan.jpg';
if (fs.existsSync(pano)) {
  const before = fs.statSync(pano).size;
  // 先读进内存再处理：Windows 上 sharp 读流未关闭时无法覆写同一文件
  const buf = await sharp(fs.readFileSync(pano)).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
  fs.writeFileSync(pano, buf);
  const after = fs.statSync(pano).size;
  totalBefore += before; totalAfter += after;
  console.log(`${pano}  ${mb(before)} -> ${mb(after)} MB`);
}

console.log(`\nconverted ${converted} files; total ${mb(totalBefore)} -> ${mb(totalAfter)} MB`);
