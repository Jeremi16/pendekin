// middleware.ts (di root project)
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Daftar domain yang valid
const VALID_DOMAINS = [
  'shortly.pp.ua',
  'link.id',
  's.id',
  'tiny.id',
  'localhost:3000', // untuk development
];

export function middleware(request: NextRequest) {
  const { pathname, host } = request.nextUrl;

  // Skip untuk API routes, _next, dan static files
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Validasi domain
  const isValidDomain = VALID_DOMAINS.some(domain => 
    host.includes(domain)
  );

  if (!isValidDomain) {
    return new NextResponse('Domain not allowed', { status: 403 });
  }

  // Homepage route (/)
  if (pathname === '/') {
    // Tambahkan header untuk domain detection
    const response = NextResponse.next();
    response.headers.set('x-current-domain', host);
    return response;
  }

  // Slug route (redirect)
  // Format: /[slug]
  const slug = pathname.substring(1); // Remove leading slash

  if (slug && slug.length > 0) {
    // Validasi slug format
    const slugPattern = /^[a-zA-Z0-9-_]+$/;
    
    if (!slugPattern.test(slug)) {
      return new NextResponse('Invalid slug format', { status: 400 });
    }

    // Pass ke redirect handler
    const response = NextResponse.next();
    response.headers.set('x-current-domain', host);
    response.headers.set('x-slug', slug);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match semua request paths kecuali:
     * - api routes
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};