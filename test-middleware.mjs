/**
 * middleware 逻辑自检 — node test-middleware.mjs
 * 覆盖：无密码放行、错密码401、full全放、limited挡sixteen三类文件、limited放行普通文件。
 */
import assert from 'node:assert';
import mw from './middleware.mjs';

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
assert.strictEqual(mw(req('/js/stickers-sixteen.js', 'fullpass')), undefined, 'full → sixteen data pass');

// 4) limited 密码 → sixteen 三类文件全 404
assert.strictEqual(mw(req('/assets/projects/sixteen/sixteen1.png', 'limitedpass')).status, 404, 'limited → sixteen img 404');
assert.strictEqual(mw(req('/assets/stickers/sixteen.png', 'limitedpass')).status, 404, 'limited → sixteen sticker 404');
assert.strictEqual(mw(req('/js/stickers-sixteen.js', 'limitedpass')).status, 404, 'limited → sixteen data 404');

// 5) limited 密码 → 普通内容放行
assert.strictEqual(mw(req('/', 'limitedpass')), undefined, 'limited → home pass');
assert.strictEqual(mw(req('/js/stickers-data.js', 'limitedpass')), undefined, 'limited → common data pass');
assert.strictEqual(mw(req('/assets/projects/nova-chat/nova-chat1.png', 'limitedpass')), undefined, 'limited → other project pass');

console.log('✓ all middleware checks passed');
