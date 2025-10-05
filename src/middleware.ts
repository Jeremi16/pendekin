import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  
  console.log('🔍 Middleware intercepting:', pathname);
  
  // Skip routes yang tidak perlu redirect
  if (
    pathname === '/' || 
    pathname.startsWith('/api/') || 
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/debug') ||
    pathname.startsWith('/test') ||
    pathname.includes('.') // Skip files like favicon.ico
  ) {
    console.log('⏭️  Skipping:', pathname);
    return NextResponse.next();
  }
  
  // Extract slug (remove leading slash)
  const slug = pathname.slice(1);
  
  console.log('🎯 Processing slug:', slug);
  
  try {
    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Query database
    const { data, error } = await supabase
      .from('shortened_links')
      .select('original_url, clicks')
      .eq('slug', slug)
      .maybeSingle();
    
    console.log('📊 Query result:', { 
      found: !!data, 
      error: error?.message 
    });
    
    if (error) {
      console.error('❌ Database error:', error);
      return NextResponse.redirect(new URL('/', request.url));
    }
    
    if (!data) {
      console.log('❌ Slug not found:', slug);
      return NextResponse.redirect(new URL('/', request.url));
    }
    
    console.log('✅ Redirecting to:', data.original_url);
    
    // Increment clicks (fire and forget - proper async handling)
    void supabase
      .from('shortened_links')
      .update({ clicks: (data.clicks || 0) + 1 })
      .eq('slug', slug)
      .then(
        () => console.log('📈 Click tracked'),
        (err: unknown) => console.error('⚠️ Click tracking error:', err)
      );
    
    // Perform redirect
    return NextResponse.redirect(data.original_url, { status: 307 });
    
  } catch (error: unknown) {
    console.error('💥 Middleware error:', error);
    return NextResponse.redirect(new URL('/', request.url));
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};