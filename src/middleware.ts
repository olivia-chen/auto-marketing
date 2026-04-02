import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Middleware that protects all routes except:
 * - /auth/* (sign-in page)
 * - /api/auth/* (NextAuth API)
 * - /_next/* (Next.js internals)
 * - /favicon.ico, /tjcf-logo.png (public assets)
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (
    pathname.startsWith('/auth') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico' ||
    pathname === '/tjcf-logo.png'
  ) {
    return NextResponse.next();
  }

  // Check for auth token
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // If no token, redirect to sign-in
  if (!token) {
    const signInUrl = new URL('/auth/signin', request.url);
    signInUrl.searchParams.set('callbackUrl', request.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except Next.js internals and static assets
     */
    '/((?!_next/static|_next/image|favicon\\.ico|tjcf-logo\\.png).*)',
  ],
};
