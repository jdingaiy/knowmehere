/**
 * middleware 逻辑自检 — node test-middleware.mjs
 * 覆盖：无配置放行、无/错密码→登录页401、full全放、limited挡保密文件、limited放行普通文件、cookie 登录。
 */
import assert from 'node:assert';
import mw from './middleware.js';

const basic = (pw) => 'Basic ' + Buffer.from('u:' + pw).toString('base64');
const req = (path, pw) =>
  new Request('https://x.test' + path, {
    headers: pw ? { authorization: basic(pw) } : {},
  });
const reqCookie = (path, pw) =>
  new Request('https://x.test' + path, {
    headers: { cookie: 'sv_auth=' + encodeURIComponent(pw) },
  });

// 1) 环境变量没配 → 放行（返回 undefined）
delete process.env.PW_FULL; delete process.env.PW_LIMITED;
assert.strictEqual(await mw(req('/', 'anything')), undefined, 'no env → pass');

process.env.PW_FULL = 'fullpass';
process.env.PW_LIMITED = 'limitedpass';

// 2) 无/错密码 → 登录页 401（不再是 Basic 弹窗）
const noPw = await mw(req('/'));
assert.strictEqual(noPw.status, 401, 'no pw → 401 login page');
assert.strictEqual(noPw.headers.get('www-authenticate'), null, '不应再发 WWW-Authenticate（否则弹原生框）');
assert.match(noPw.headers.get('content-type') || '', /text\/html/, 'login page is html');
assert.strictEqual((await mw(req('/', 'wrong'))).status, 401, 'wrong pw → 401');

// 3) full 密码 → 任何东西都放行
assert.strictEqual(await mw(req('/', 'fullpass')), undefined, 'full → home pass');
assert.strictEqual(await mw(req('/assets/projects/sixteen/sixteen1.png', 'fullpass')), undefined, 'full → sixteen img pass');
assert.strictEqual(await mw(req('/js/stickers-private.js', 'fullpass')), undefined, 'full → private data pass');
assert.strictEqual(await mw(req('/assets/projects/nova-chat/B%20(1).png', 'fullpass')), undefined, 'full → nova img pass');

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
  assert.strictEqual((await mw(req(p, 'limitedpass'))).status, 404, `limited → 404: ${p}`);
}

// 5) limited 密码 → 普通内容放行
assert.strictEqual(await mw(req('/', 'limitedpass')), undefined, 'limited → home pass');
assert.strictEqual(await mw(req('/js/stickers-data.js', 'limitedpass')), undefined, 'limited → common data pass');
assert.strictEqual(await mw(req('/assets/ip-manifest.json', 'limitedpass')), undefined, 'limited → public manifest pass');
assert.strictEqual(await mw(req('/assets/stickers/ip%20stickers/tianjin/x.png', 'limitedpass')), undefined, 'limited → other IP pass');

// 6) cookie 登录（表单提交后的实际路径）→ 与 Basic 等效
assert.strictEqual(await mw(reqCookie('/', 'fullpass')), undefined, 'cookie full → pass');
assert.strictEqual((await mw(reqCookie('/assets/projects/sixteen/sixteen1.png', 'limitedpass'))).status, 404, 'cookie limited → sixteen 404');

console.log('✓ all middleware checks passed');
