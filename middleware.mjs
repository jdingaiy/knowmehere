/**
 * Vercel Edge Middleware — 全站密码门 + 小红书 NDA 项目按密码放行。
 *
 * 两个密码（存 Vercel 环境变量，前端永远看不到）：
 *   PW_FULL     完整密码 → 放行所有内容，包括 sixteen
 *   PW_LIMITED  对外密码 → 网站正常，但 sixteen 的数据文件与图片一律 404
 *
 * 用 HTTP Basic Auth：浏览器弹原生登录框，用户名随便填，密码决定看到什么。
 * 认证结果写进 cookie，避免每个请求都弹框。
 */

export const config = {
  // 拦截所有请求，排除 middleware 自身与常见静态元数据。
  matcher: ['/((?!_next/|favicon.ico).*)'],
};

// sixteen 的敏感文件：对外密码下全部 404。
function isSixteenAsset(pathname) {
  return (
    pathname.startsWith('/assets/projects/sixteen/') ||
    pathname === '/assets/stickers/sixteen.png' ||
    pathname === '/js/stickers-sixteen.js'
  );
}

function unauthorized() {
  return new Response('需要访问密码', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="portfolio", charset="UTF-8"' },
  });
}

export default function middleware(request) {
  const PW_FULL = process.env.PW_FULL;
  const PW_LIMITED = process.env.PW_LIMITED;

  // 环境变量没配 → 直接放行，避免把自己锁在门外（部署后记得在 Vercel 配好）。
  // ponytail: fail-open by design；配好密码后即生效。
  if (!PW_FULL && !PW_LIMITED) return;

  const auth = request.headers.get('authorization') || '';
  let tier = null; // 'full' | 'limited' | null

  if (auth.startsWith('Basic ')) {
    const decoded = atob(auth.slice(6));         // "user:password"
    const pw = decoded.slice(decoded.indexOf(':') + 1);
    if (PW_FULL && pw === PW_FULL) tier = 'full';
    else if (PW_LIMITED && pw === PW_LIMITED) tier = 'limited';
  }

  if (!tier) return unauthorized();

  // 对外密码：sixteen 的一切都当不存在。
  if (tier === 'limited' && isSixteenAsset(new URL(request.url).pathname)) {
    return new Response('Not Found', { status: 404 });
  }

  // 通过：放行。
  return;
}
