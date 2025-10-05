// app/api/shorten/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Pastikan environment variables ada
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl!, supabaseKey!);

// Interface untuk domain config
interface DomainConfigItem {
  table: string;
  prefix?: string;
}

// Konfigurasi domain dan tabel mapping
const DOMAIN_CONFIG: Record<string, DomainConfigItem> = {
  'shortly.pp.ua': {
    table: 'links_shortly',
    prefix: 'sh'
  },
  'pendekin.qzz.io': {
    table: 'links_pendekin',
    prefix: 'pk'
  }
};

// Generate random slug
function generateSlug(length: number = 8, prefix?: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let slug = '';
  for (let i = 0; i < length; i++) {
    slug += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return prefix ? `${prefix}-${slug}` : slug;
}

// Validate custom path
function validateCustomPath(path: string): boolean {
  const regex = /^[a-zA-Z0-9-_]+$/;
  return regex.test(path) && path.length >= 3 && path.length <= 50;
}

export async function POST(request: NextRequest) {
  try {
    // Cek environment variables
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Server configuration error: Missing Supabase credentials' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { originalUrl, customPath, domain } = body;

    console.log('Request received:', { originalUrl, customPath, domain });

    // Validasi input
    if (!originalUrl || !domain) {
      return NextResponse.json(
        { error: 'URL dan domain harus diisi' },
        { status: 400 }
      );
    }

    // Validasi domain
    const domainConfig = DOMAIN_CONFIG[domain];
    if (!domainConfig) {
      return NextResponse.json(
        { error: `Domain tidak valid: ${domain}` },
        { status: 400 }
      );
    }

    const { table, prefix } = domainConfig;

    // Generate atau validate slug
    let slug: string;
    
    if (customPath) {
      // Validasi custom path
      if (!validateCustomPath(customPath)) {
        return NextResponse.json(
          { error: 'Path kustom hanya boleh mengandung huruf, angka, dash, dan underscore (3-50 karakter)' },
          { status: 400 }
        );
      }

      // Cek apakah slug sudah ada di tabel domain tersebut
      const { data: existing } = await supabase
        .from(table)
        .select('slug')
        .eq('slug', customPath)
        .maybeSingle();

      if (existing) {
        return NextResponse.json(
          { error: 'Path kustom sudah digunakan' },
          { status: 409 }
        );
      }

      slug = customPath;
    } else {
      // Generate slug acak
      let attempts = 0;
      const maxAttempts = 10;
      slug = '';

      while (attempts < maxAttempts) {
        slug = generateSlug(8, prefix);

        // Cek apakah slug sudah ada
        const { data: existing } = await supabase
          .from(table)
          .select('slug')
          .eq('slug', slug)
          .maybeSingle();

        if (!existing) break;
        attempts++;
      }

      if (attempts >= maxAttempts) {
        return NextResponse.json(
          { error: 'Gagal generate slug unik. Coba lagi.' },
          { status: 500 }
        );
      }
    }

    // Simpan ke database tabel spesifik domain
    const { error } = await supabase
      .from(table)
      .insert([
        {
          slug,
          original_url: originalUrl,
          domain,
          clicks: 0
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: `Gagal menyimpan link: ${error.message}` },
        { status: 500 }
      );
    }

    const shortUrl = `https://${domain}/${slug}`;

    return NextResponse.json({
      success: true,
      shortUrl,
      slug,
      originalUrl,
      domain
    });

  } catch (error) {
    console.error('Error in shorten API:', error);
    const errorMessage = error instanceof Error ? error.message : 'Terjadi kesalahan server';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

// GET endpoint untuk retrieve link (opsional)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get('slug');
    const domain = searchParams.get('domain');

    if (!slug || !domain) {
      return NextResponse.json(
        { error: 'Slug dan domain diperlukan' },
        { status: 400 }
      );
    }

    const domainConfig = DOMAIN_CONFIG[domain];
    if (!domainConfig) {
      return NextResponse.json(
        { error: 'Domain tidak valid' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from(domainConfig.table)
      .select('*')
      .eq('slug', slug)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Link tidak ditemukan' },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in GET:', error);
    const errorMessage = error instanceof Error ? error.message : 'Terjadi kesalahan server';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}