/**
 * middleware 逻辑自检 — node test-middleware.mjs
 * 覆盖：无密码放行、错密码401、full全放、limited挡sixteen三类文件、limited放行普通文件。
 */
import assert from 'node:assert';
import mw from './middleware.js';

const basic = (pw) => 'Basic ' + Buffer.from('u:' + pw).toString('base64');
const req = (path, pw) =>
  new Request('https://x.test' + path, {
    headers: pw ? { authorization: basic(pw) } : {},
  });

// 1) 环境变量没配 → 放行（返回 undefined）
delete process.env.PW_FULL; delete process.env.PW_LIMITED;
assert.strictEqual(mw(req('/', 'anything')), undefined, 'no env → pass');

process.env.PW_FULL = 'fullpass';
process.env.PW_LIMITED = 'limitedpass';

// 2) 无/错密码 → 401
assert.strictEqual(mw(req('/')).status, 401, 'no pw → 401');
assert.strictEqual(mw(req('/', 'wrong')).status, 401, 'wrong pw → 401');

// 3) full 密码 → 任何东西都放行
assert.strictEqual(mw(req('/', 'fullpass')), undefined, 'full → home pass');
assert.strictEqual(mw(req('/assets/projects/sixteen/sixteen1.png', 'fullpass')), undefined, 'full → sixteen img pass');
assert.strictEqual(mw(req('/js/stickers-private.js', 'fullpass')), undefined, 'full → private data pass');
assert.strictEqual(mw(req('/assets/projects/nova-chat/B%20(1).png', 'fullpass')), undefined, 'full → nova img pass');

// 4) limited 密码 → 三个保密项目的文件全 404
const block404 = [
  '/assets/projects/sixteen/sixteen1.png',
  '/assets/stickers/sixteen.png',
  '/js/stickers-private.js',
  '/assets/projects/nova-chat/B%20(1).png',   // 空格被 encodeURI 成 %20
  '/assets/stickers/nova-chat.png',
  '/assets/ip-manifest-private.json',
  '/assets/stickers/ip%20stickers/keaitianqi/Object-1.png', // 编码空格
  '/assets/stickers/ip stickers/keaitianqi/Object.png',     // 未编码空格
];
for (const p of block404) {
  assert.strictEqual(mw(req(p, 'limitedpass')).status, 404, `limited → 404: ${p}`);
}

// 5) limited 密码 → 普通内容放行
assert.strictEqual(mw(req('/', 'limitedpass')), undefined, 'limited → home pass');
assert.strictEqual(mw(req('/js/stickers-data.js', 'limitedpass')), undefined, 'limited → common data pass');
assert.strictEqual(mw(req('/assets/ip-manifest.json', 'limitedpass')), undefined, 'limited → public manifest pass');
assert.strictEqual(mw(req('/assets/stickers/ip%20stickers/tianjin/x.png', 'limitedpass')), undefined, 'limited → other IP pass');

console.log('✓ all middleware checks passed');
