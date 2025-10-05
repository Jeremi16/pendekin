import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';

// Simpan di database Anda (ini contoh sederhana)
const links: Record<string, string> = {};

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
    const shortCode = customPath || nanoid(8);
    
    // Simpan ke database (ganti dengan database Anda)
    links[shortCode] = originalUrl;
    
    const shortUrl = `https://${domain}/${shortCode}`;
    
    return NextResponse.json({ shortUrl });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}