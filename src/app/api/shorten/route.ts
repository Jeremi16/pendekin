import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    // Parse request body dengan error handling
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON format' }, 
        { status: 400 }
      );
    }

    const { originalUrl, customPath, domain } = body;

    // Log untuk debugging
    console.log('Received request:', { originalUrl, customPath, domain });

    // Validasi input
    if (!originalUrl || typeof originalUrl !== 'string') {
      return NextResponse.json(
        { error: 'URL tidak boleh kosong' }, 
        { status: 400 }
      );
    }

    if (!domain || typeof domain !== 'string') {
      return NextResponse.json(
        { error: 'Domain tidak valid' }, 
        { status: 400 }
      );
    }
    
    // Validasi URL
    let url: URL;
    try {
      url = new URL(originalUrl);
      // Pastikan protokol valid
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch (urlError) {
      console.error('URL validation error:', urlError);
      return NextResponse.json(
        { error: 'URL tidak valid. Pastikan dimulai dengan http:// atau https://' }, 
        { status: 400 }
      );
    }

    // Generate short code
    const shortCode = customPath?.trim() || nanoid(8);
    
    console.log('Generated shortCode:', shortCode);
    
    // Validasi karakter custom path
    if (customPath && !/^[a-zA-Z0-9_-]+$/.test(customPath.trim())) {
      return NextResponse.json(
        { error: 'Path kustom hanya boleh berisi huruf, angka, dash (-), dan underscore (_)' }, 
        { status: 400 }
      );
    }

    // Cek apakah slug sudah ada
    try {
      const { data: existing, error: checkError } = await supabase
        .from('shortened_links')
        .select('slug')
        .eq('slug', shortCode)
        .maybeSingle();

      if (checkError) {
        console.error('Supabase check error:', checkError);
        return NextResponse.json(
          { error: 'Database error: ' + checkError.message }, 
          { status: 500 }
        );
      }

      if (existing) {
        return NextResponse.json(
          { error: 'Path sudah digunakan, pilih yang lain' }, 
          { status: 400 }
        );
      }
    } catch (dbError) {
      console.error('Database check error:', dbError);
      return NextResponse.json(
        { error: 'Gagal memeriksa database' }, 
        { status: 500 }
      );
    }
    
    // Simpan ke Supabase
    try {
      const { data, error: insertError } = await supabase
        .from('shortened_links')
        .insert([
          {
            slug: shortCode,
            original_url: originalUrl,
          }
        ])
        .select()
        .single();

      if (insertError) {
        console.error('Supabase insert error:', insertError);
        return NextResponse.json(
          { error: 'Gagal menyimpan link: ' + insertError.message }, 
          { status: 500 }
        );
      }

      if (!data) {
        console.error('No data returned from insert');
        return NextResponse.json(
          { error: 'Gagal menyimpan link' }, 
          { status: 500 }
        );
      }
      
      const shortUrl = `https://${domain}/${shortCode}`;
      
      console.log('Successfully created:', { shortUrl, shortCode, id: data.id });
      
      return NextResponse.json({ 
        shortUrl, 
        shortCode,
        id: data.id 
      });
    } catch (insertError) {
      console.error('Insert error:', insertError);
      return NextResponse.json(
        { error: 'Gagal menyimpan link ke database' }, 
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error: ' + (error?.message || 'Unknown error') }, 
      { status: 500 }
    );
  }
}

// GET endpoint untuk mengecek link
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const slug = searchParams.get('slug');
    
    if (!slug) {
      return NextResponse.json({ error: 'Slug tidak ditemukan' }, { status: 400 });
    }
    
    const { data, error } = await supabase
      .from('shortened_links')
      .select('original_url, clicks')
      .eq('slug', slug)
      .maybeSingle();
    
    if (error) {
      console.error('GET error:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Link tidak ditemukan' }, { status: 404 });
    }
    
    return NextResponse.json({ 
      originalUrl: data.original_url,
      clicks: data.clicks 
    });
  } catch (error: any) {
    console.error('GET unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}