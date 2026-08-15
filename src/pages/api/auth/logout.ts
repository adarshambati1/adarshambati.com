import type { APIRoute } from 'astro';
import { COOKIE } from '../../../lib/auth';

export const prerender = false;

const clear: APIRoute = async ({ cookies }) => {
  cookies.delete(COOKIE, { path: '/' });
  return new Response(null, { status: 302, headers: { location: '/login?error=out' } });
};

export const POST = clear;
export const GET = clear;
