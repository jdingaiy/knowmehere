/**
 * Vercel Edge Middleware — 全站密码门 + 小红书 NDA 项目按密码放行。
 *
 * 两个密码（存 Vercel 环境变量，前端永远看不到）：
 *   PW_FULL     完整密码 → 放行所有内容，包括 sixteen
 *   PW_LIMITED  对外密码 → 网站正常，但 sixteen 的数据文件与图片一律 404
 *
 * 未登录时返回页面内登录框（不用 Basic Auth 弹窗，兼容微信等内置浏览器）。
 * 表单提交到 /__auth，服务器端校验后写 httpOnly cookie；?logout 清除。
 * 仍兼容 Authorization: Basic（curl / 自动化测试用）。
 */

export const config = {
  // 拦截所有请求；只放行 Vercel 内部路径。
  // 注意：不能排除 .png/.js，因为 sixteen 的图片和数据文件正是要拦的对象。
  matcher: ['/((?!_vercel/).*)'],
};

// 去敏（对外密码）模式下要 404 的敏感文件。新增保密项目就往这里加。
// 前缀用 startsWith，精确路径用全等。注意 encodeURI 后空格是 %20（nova-chat 图片名）。
const PRIVATE_PREFIXES = [
  '/assets/projects/sixteen/',
  '/assets/projects/nova-chat/',
  '/assets/stickers/ip stickers/keaitianqi/',
  '/assets/stickers/ip%20stickers/keaitianqi/',
];
const PRIVATE_EXACT = new Set([
  '/assets/stickers/sixteen.png',
  '/assets/stickers/nova-chat.png',
  '/js/stickers-private.js',
  '/assets/ip-manifest-private.json',
]);

function isPrivateAsset(pathname) {
  const p = decodeURIComponent(pathname);
  return (
    PRIVATE_EXACT.has(pathname) || PRIVATE_EXACT.has(p) ||
    PRIVATE_PREFIXES.some((pre) => pathname.startsWith(pre) || p.startsWith(pre))
  );
}

const COOKIE = 'sv_auth';

function tierFor(pw, PW_FULL, PW_LIMITED) {
  if (PW_FULL && pw === PW_FULL) return 'full';
  if (PW_LIMITED && pw === PW_LIMITED) return 'limited';
  return null;
}

function readCookie(request, name) {
  const c = request.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

// 页面内登录框（替代浏览器 Basic Auth 弹窗；微信等内置浏览器不弹原生框）。
// 密码不出现在此页面，提交后由 middleware 在服务器端校验。
function loginPage(errMsg) {
  const err = errMsg
    ? `<p style="color:#c0392b;font-size:13px;margin:0 0 4px;">${errMsg}</p>`
    : '';
  const html = `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>访问验证</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#f3efe6;font-family:-apple-system,'Noto Sans SC',sans-serif;color:#1a1a18;padding:24px}
  .card{width:100%;max-width:340px;text-align:center}
  h1{font-family:'Noto Serif SC',serif;font-weight:600;font-size:22px;margin:0 0 6px}
  p.sub{color:#8a8780;font-size:13px;margin:0 0 22px;line-height:1.6}
  form{display:flex;flex-direction:column;gap:12px}
  input{font-size:16px;padding:13px 14px;border:1px solid #dcd8cf;border-radius:10px;
    background:#fbf8f1;outline:none;width:100%;text-align:center}
  input:focus{border-color:#c85a28}
  button{font-size:15px;padding:13px;border:0;border-radius:10px;background:#1a1a18;color:#fff;
    cursor:pointer;font-weight:500}
  button:active{opacity:.85}
</style></head><body>
  <div class="card">
    <h1>谭加奇 · 作品集</h1>
    <p class="sub">本站需访问密码，密码见简历</p>
    <form method="POST" action="/__auth">
      ${err}
      <input name="pw" type="password" inputmode="text" autocomplete="current-password"
        placeholder="输入访问密码" autofocus required>
      <button type="submit">进入</button>
    </form>
  </div>
</body></html>`;
  return new Response(html, {
    status: 401,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default async function middleware(request) {
  const PW_FULL = process.env.PW_FULL;
  const PW_LIMITED = process.env.PW_LIMITED;

  // 环境变量没配 → 直接放行，避免把自己锁在门外（部署后记得在 Vercel 配好）。
  // ponytail: fail-open by design；配好密码后即生效。
  if (!PW_FULL && !PW_LIMITED) return;

  const url = new URL(request.url);

  // 退出登录：清 cookie 后回登录页（用于切换完整/对外密码）。
  if (url.searchParams.has('logout')) {
    return new Response(null, {
      status: 303,
      headers: {
        Location: '/',
        'Set-Cookie': `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
      },
    });
  }

  // 登录表单提交：服务器端校验密码，通过则写 httpOnly cookie。
  if (request.method === 'POST' && url.pathname === '/__auth') {
    const form = await request.formData();
    const pw = (form.get('pw') || '').toString();
    if (!tierFor(pw, PW_FULL, PW_LIMITED)) return loginPage('密码不正确，请重试');
    return new Response(null, {
      status: 303,
      headers: {
        Location: '/',
        // 存原始密码于 httpOnly cookie，每次请求由服务器重新校验，前端 JS 读不到。
        // ponytail: 上限——如需过期/吊销粒度更细，改存 HMAC 签名 token。
        'Set-Cookie': `${COOKIE}=${encodeURIComponent(pw)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`,
      },
    });
  }

  // 判定权限：优先 cookie，其次 Basic auth header（保留给 curl / 测试）。
  let pw = readCookie(request, COOKIE);
  if (!pw) {
    const auth = request.headers.get('authorization') || '';
    if (auth.startsWith('Basic ')) {
      const decoded = atob(auth.slice(6));         // "user:password"
      pw = decoded.slice(decoded.indexOf(':') + 1);
    }
  }
  const tier = tierFor(pw, PW_FULL, PW_LIMITED);

  if (!tier) return loginPage('');

  // 对外密码：所有保密项目的一切都当不存在。
  if (tier === 'limited' && isPrivateAsset(url.pathname)) {
    return new Response('Not Found', { status: 404 });
  }

  // 通过：放行。
  return;
}
