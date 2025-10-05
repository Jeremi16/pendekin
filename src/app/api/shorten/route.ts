import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { originalUrl, customPath, domain } = await request.json();
    
    // Validasi URL
    let url: URL;
    try {
      url = new URL(originalUrl);
    } catch {
      return NextResponse.json(
        { error: 'URL tidak valid' }, 
        { status: 400 }
      );
    }

    // Generate short code
    const shortCode = customPath?.trim() || nanoid(8);
    
    // Validasi karakter custom path
    if (customPath && !/^[a-zA-Z0-9_-]+$/.test(customPath)) {
      return NextResponse.json(
        { error: 'Path kustom hanya boleh berisi huruf, angka, dash, dan underscore' }, 
        { status: 400 }
      );
    }

    // Cek apakah slug sudah ada
    const { data: existing } = await supabase
      .from('shortened_links')
      .select('slug')
      .eq('slug', shortCode)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: 'Path sudah digunakan, pilih yang lain' }, 
        { status: 400 }
      );
    }
    
    // Simpan ke Supabase
    const { data, error } = await supabase
      .from('shortened_links')
      .insert([
        {
          slug: shortCode,
          original_url: originalUrl,
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json(
        { error: 'Gagal menyimpan link' }, 
        { status: 500 }
      );
    }
    
    const shortUrl = `https://${domain}/${shortCode}`;
    
    return NextResponse.json({ 
      shortUrl, 
      shortCode,
      id: data.id 
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}

// GET endpoint untuk mengecek link
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const slug = searchParams.get('slug');
  
  if (!slug) {
    return NextResponse.json({ error: 'Slug tidak ditemukan' }, { status: 400 });
  }
  
  const { data, error } = await supabase
    .from('shortened_links')
    .select('original_url, clicks')
    .eq('slug', slug)
    .single();
  
  if (error || !data) {
    return NextResponse.json({ error: 'Link tidak ditemukan' }, { status: 404 });
  }
  
  return NextResponse.json({ 
    originalUrl: data.original_url,
    clicks: data.clicks 
  });
}