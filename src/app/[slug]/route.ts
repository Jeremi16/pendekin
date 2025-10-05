// app/[slug]/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';

// Pastikan environment variables ada
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl!, supabaseKey!);

// Interface untuk domain config (sinkron dengan /api/shorten)
interface DomainConfigItem {
  table: string;
  prefix?: string;
}

// Konfigurasi domain dan tabel mapping (bisa dynamic dari env nanti)
const DOMAIN_CONFIG: Record<string, DomainConfigItem> = {
  'shortly.pp.ua': {
    table: 'links_shortly',
    prefix: 'sh'
  },
  'pendekin.qzz.io': {
    table: 'links_pendekin',
    prefix: 'pk'
  }
  // Tambah domain lain di sini atau dari env
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    // Await params karena di Next.js 15+ dynamic params adalah Promise
    const { slug } = await context.params;

    // Cek environment variables
    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase config missing');
      return new NextResponse('Server configuration error', { status: 500 });
    }

    // Await headers karena di Next.js 15+ headers() return Promise
    const headersList = await headers();
    const host = headersList.get('host') || '';

    console.log(`Redirect attempt: slug="${slug}", host="${host}"`);

    // Validasi slug format (sama seperti middleware)
    const slugPattern = /^[a-zA-Z0-9-_]+$/;
    if (!slug || !slugPattern.test(slug)) {
      console.log(`Invalid slug: ${slug}`);
      return new NextResponse('Invalid slug format', { status: 400 });
    }

    // Deteksi domain dari host (support subdomain jika ada)
    let domain = '';
    for (const [key] of Object.entries(DOMAIN_CONFIG)) {
      if (host.endsWith(key)) {
        domain = key;
        break;
      }
    }

    if (!domain) {
      console.log(`Invalid domain: ${host}`);
      return new NextResponse('Domain not allowed', { status: 403 });
    }

    const domainConfig = DOMAIN_CONFIG[domain];
    const { table } = domainConfig;

    // Query DB untuk cari link
    const { data, error } = await supabase
      .from(table)
      .select('original_url, clicks')
      .eq('slug', slug)
      .single();

    if (error || !data) {
      console.log(`No link found for slug "${slug}" in table "${table}":`, error?.message);
      return new NextResponse('Link not found', { status: 404 });
    }

    // Increment clicks
    const { error: updateError } = await supabase
      .from(table)
      .update({ clicks: data.clicks + 1 })
      .eq('slug', slug);

    if (updateError) {
      console.error(`Failed to update clicks for "${slug}":`, updateError.message);
    }

    const redirectUrl = data.original_url;
    console.log(`Success: Redirecting "${slug}" on "${domain}" -> "${redirectUrl}"`);

    return NextResponse.redirect(redirectUrl, 302);

  } catch (error) {
    console.error('Unexpected error in [slug] route:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}