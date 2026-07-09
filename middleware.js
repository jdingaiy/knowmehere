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
  const err = errMsg ? String(errMsg) : '';
  const html = `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>访问验证</title>
<style>
  *{box-sizing:border-box}
  :root{--accent:#391FE4}
  html,body{height:100%}
  body{margin:0;display:flex;align-items:center;justify-content:center;padding:24px;
    font-family:-apple-system,BlinkMacSystemFont,'Noto Sans SC',sans-serif;
    color:#fff;overflow:hidden}
  /* 森林背景：模糊 + 压暗，保证前景可读 */
  .bg{position:fixed;inset:-40px;z-index:-2;
    background:url('/assets/texture/forest_pan.jpg') center/cover no-repeat;
    filter:blur(18px) brightness(.62) saturate(1.05);transform:scale(1.08)}
  .bg::after{content:'';position:absolute;inset:0;background:rgba(20,28,18,.28)}
  /* 整体略微下移 */
  .card{width:100%;max-width:340px;display:flex;flex-direction:column;align-items:center;
    gap:14px;margin-top:14vh}
  .logo{width:60px;height:60px;margin-bottom:26px}
  .logo svg{width:100%;height:100%;display:block;filter:drop-shadow(0 2px 12px rgba(0,0,0,.4))}
  form{width:100%;display:flex;flex-direction:column;align-items:center;gap:12px}
  input{width:100%;font-size:16px;padding:14px 16px;text-align:center;color:#fff;
    border:1.5px solid rgba(255,255,255,.45);border-radius:14px;
    background:rgba(255,255,255,.12);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
    outline:none;transition:border-color .15s,background .15s}
  input::placeholder{color:rgba(255,255,255,.7)}
  input:focus{border-color:var(--accent);background:rgba(255,255,255,.18)}
  /* 报错位：始终占位，出错才显字 → 不抖动 */
  .err{min-height:18px;font-size:12.5px;line-height:18px;color:#ff6b6b;text-align:center;
    text-shadow:0 1px 3px rgba(0,0,0,.4)}
  /* 蓝色实心按钮 */
  button{width:100%;font-size:15px;font-weight:600;padding:14px;color:#fff;cursor:pointer;
    border:0;border-radius:18px;background:var(--accent);
    box-shadow:0 6px 20px rgba(57,31,228,.4)}
  button:active{background:#2e19bd}
  /* 提示贴近按钮 */
  .hint{font-size:11.5px;color:rgba(255,255,255,.8);text-align:center;margin-top:-4px;
    text-shadow:0 1px 3px rgba(0,0,0,.45)}
</style></head><body>
  <div class="bg"></div>
  <div class="card">
    <div class="logo"><svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><path d="M177.143 22.8571H200V71.4286H176.669C175.483 85.8982 172.061 100.121 166.487 113.577C159.452 130.562 149.138 145.996 136.138 158.996C123.138 171.996 107.705 182.309 90.7199 189.344C74.7962 195.94 57.7995 199.534 40.5887 199.958L37.1429 200H0V151.429H100C115.78 151.429 128.571 138.637 128.571 122.857V71.4286H0V22.8571H128.571V0H177.143V22.8571Z" fill="#391FE4"/></svg></div>
    <form method="POST" action="/__auth" novalidate>
      <input name="pw" type="password" inputmode="text" autocomplete="current-password"
        placeholder="输入访问密码" autofocus>
      <div class="err">${err}</div>
      <button type="submit">进入</button>
    </form>
    <p class="hint">本站需访问密码，密码见简历</p>
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
    if (!pw) return loginPage('请填写该字段');
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

  // 登录页背景图需在未登录时也能加载，否则登录页背景空白。仅此一张，非敏感。
  if (!tier && url.pathname === '/assets/texture/forest_pan.jpg') return;

  if (!tier) return loginPage('');

  // 对外密码：所有保密项目的一切都当不存在。
  if (tier === 'limited' && isPrivateAsset(url.pathname)) {
    return new Response('Not Found', { status: 404 });
  }

  // 通过：放行。
  return;
}
