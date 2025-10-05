// app/[slug]/page.tsx
import { createClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Domain to table mapping
const DOMAIN_CONFIG: Record<string, string> = {
  'shortly.pp.ua': 'links_shortly',
  'pendekin.qzz.io': 'links_pendekin',
  'localhost:3000': 'links_shortly', // untuk development
  'localhost': 'links_shortly'
};

export default async function RedirectPage({
  params,
}: {
  params: { slug: string };
}) {
  const headersList = await headers();
  const host = headersList.get('host') || '';
  
  console.log('🔍 Redirect Debug - Host:', host, 'Slug:', params.slug);
  
  // Tentukan tabel berdasarkan domain
  let table = DOMAIN_CONFIG[host];
  
  // Fallback untuk localhost atau domain yang mengandung port
  if (!table && host.includes('localhost')) {
    table = 'links_shortly';
  }
  
  // Fallback untuk domain yang tidak exact match
  if (!table) {
    const matchedDomain = Object.keys(DOMAIN_CONFIG).find(domain => 
      host.includes(domain.replace(':3000', ''))
    );
    if (matchedDomain) {
      table = DOMAIN_CONFIG[matchedDomain];
    }
  }
  
  console.log('📊 Table selected:', table);
  
  if (!table) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-red-400 mb-4">Domain Tidak Valid</h1>
          <p className="text-slate-400 mb-2">Host: {host}</p>
          <p className="text-slate-500 text-xs">Domain ini tidak terdaftar dalam sistem</p>
          <Link
            href="/"
            className="mt-6 inline-block px-6 py-3 bg-cyan-600 text-white rounded-xl hover:bg-cyan-500 transition"
          >
            Kembali ke Home
          </Link>
        </div>
      </div>
    );
  }

  try {
    // Ambil data dari tabel spesifik domain
    const { data, error } = await supabase
      .from(table)
      .select('original_url, clicks')
      .eq('slug', params.slug)
      .maybeSingle();

    console.log('📦 Query result:', { data, error });

    if (error) {
      console.error('❌ Supabase error:', error);
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-red-400 mb-4">Database Error</h1>
            <p className="text-slate-400">{error.message}</p>
            <Link
              href="/"
              className="mt-6 inline-block px-6 py-3 bg-cyan-600 text-white rounded-xl hover:bg-cyan-500 transition"
            >
              Kembali ke Home
            </Link>
          </div>
        </div>
      );
    }

    if (!data) {
      console.log('⚠️ Link not found');
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-red-400 mb-4">404</h1>
            <p className="text-slate-400 mb-2">Link tidak ditemukan</p>
            <p className="text-slate-500 text-sm">Slug: {params.slug}</p>
            <p className="text-slate-500 text-sm">Table: {table}</p>
            <Link
              href="/"
              className="mt-6 inline-block px-6 py-3 bg-cyan-600 text-white rounded-xl hover:bg-cyan-500 transition"
            >
              Kembali ke Home
            </Link>
          </div>
        </div>
      );
    }

    console.log('✅ Redirecting to:', data.original_url);

    // Update click count (non-blocking)
    try {
      await supabase
        .from(table)
        .update({ clicks: (data.clicks || 0) + 1 })
        .eq('slug', params.slug);
      console.log('📈 Click count updated');
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Failed to update clicks:', errorMsg);
    }

    console.log('✅ Redirecting to:', data.original_url);

    // Redirect ke URL asli
    redirect(data.original_url);
    
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('💥 Redirect error:', errorMessage);
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-red-400 mb-4">Error</h1>
          <p className="text-slate-400">Terjadi kesalahan saat mengalihkan link</p>
          <p className="text-slate-500 text-sm mt-2">{errorMessage}</p>
          <Link
            href="/"
            className="mt-6 inline-block px-6 py-3 bg-cyan-600 text-white rounded-xl hover:bg-cyan-500 transition"
          >
            Kembali ke Home
          </Link>
        </div>
      </div>
    );
  }
}

// Force dynamic rendering - penting untuk redirect!
export const dynamic = 'force-dynamic';
export const revalidate = 0;