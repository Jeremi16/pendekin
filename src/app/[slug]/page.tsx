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
  'link.id': 'links_linkid',
  's.id': 'links_sid',
  'tiny.id': 'links_tiny'
};

export default async function RedirectPage({
  params,
}: {
  params: { slug: string };
}) {
  const headersList = await headers();
  const host = headersList.get('host') || '';
  
  // Tentukan tabel berdasarkan domain
  const table = DOMAIN_CONFIG[host];
  
  if (!table) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-red-400 mb-4">Domain Tidak Valid</h1>
          <p className="text-slate-400">Domain ini tidak terdaftar dalam sistem</p>
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
      .single();

    if (error || !data) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-red-400 mb-4">404</h1>
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

    // Update click count
    await supabase
      .from(table)
      .update({ clicks: (data.clicks || 0) + 1 })
      .eq('slug', params.slug);

    // Redirect ke URL asli
    redirect(data.original_url);
    
  } catch (error) {
    console.error('Redirect error:', error);
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-red-400 mb-4">Error</h1>
          <p className="text-slate-400">Terjadi kesalahan saat mengalihkan link</p>
        </div>
      </div>
    );
  }
}

// Generate static params untuk ISR (opsional)
export const dynamicParams = true;
export const revalidate = 3600; // Revalidate setiap jam