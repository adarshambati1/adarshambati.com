import { defineMiddleware } from 'astro:middleware';
import { COOKIE, authorize, sameOrigin } from './lib/auth';

/**
 * Public by default; the app section and its data API are gated.
 *
 * The site staying public matters — those pages should be indexable. Only /todo
 * and the data endpoints need a credential. /api/auth/* must stay open, since
 * that's how you get one.
 */
const PROTECTED = [/^\/todo(\/|$)/, /^\/api\/(sync|quick-add|list)(\/|$)/];

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export const onRequest = defineMiddleware(async (ctx, next) => {
  // todo.adarshambati.com serves the app at its root. Same deployment, same
  // code — the subdomain is just an alias so the app gets its own home screen
  // identity rather than living at a path on the main site.
  if (ctx.url.hostname.startsWith('todo.') && ctx.url.pathname === '/') {
    return ctx.rewrite('/todo');
  }

  const path = ctx.url.pathname;
  if (!PROTECTED.some((re) => re.test(path))) return next();

  const via = authorize(ctx.request, ctx.cookies.get(COOKIE)?.value);

  if (!via) {
    // API callers get a status they can act on; humans get sent to the form.
    if (path.startsWith('/api/')) return json({ error: 'unauthorized' }, 401);
    return ctx.redirect(`/login?next=${encodeURIComponent(path)}`, 302);
  }

  // CSRF: a cookie rides along on cross-site requests whether the user meant it
  // or not, so cookie-authenticated writes must prove they came from us.
  // SameSite=Lax already covers this; the origin check is the belt to its braces.
  // Bearer callers are exempt — Shortcuts and curl don't send Origin at all.
  if (via === 'cookie' && ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') {
    if (!sameOrigin(ctx.request, ctx.url.origin)) return json({ error: 'bad origin' }, 403);
  }

  return next();
});
