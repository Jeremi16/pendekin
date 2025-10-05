import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Ambil daftar domain dari environment variable
const VALID_DOMAINS = (process.env.VALID_DOMAINS || 'shortly.pp.ua,link.id,s.id,tiny.id,localhost:3000')
  .split(',')
  .map(domain => domain.trim())
  .filter(Boolean); // Hapus yang kosong

// Helper untuk clean host (hilangkan port untuk matching lebih fleksibel)
function getCleanHost(host: string): string {
  return host.split(':')[0]; // Hilangkan port, misal 'localhost:3000' -> 'localhost'
}

export function middleware(request: NextRequest) {
  const { pathname, host } = request.nextUrl;
  const cleanHost = getCleanHost(host);

  // Skip untuk API routes, _next, dan static files
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Validasi domain (menggunakan endsWith pada clean host, mendukung subdomain & port)
  const isValidDomain = VALID_DOMAINS.some(domain => {
    const cleanDomain = domain.split(':')[0]; // Clean domain juga
    return cleanHost.endsWith(cleanDomain);
  });

  if (!isValidDomain) {
    console.log(`Invalid domain access: ${host} (clean: ${cleanHost})`); // Logging untuk debug
    return new NextResponse('Domain not allowed', { status: 403 });
  }

  console.log(`Valid domain: ${host} (clean: ${cleanHost})`); // Logging untuk debug

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
      console.log(`Invalid slug: ${slug}`); // Logging untuk debug
      return new NextResponse('Invalid slug format', { status: 400 });
    }

    // Pass ke redirect handler (route.ts)
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