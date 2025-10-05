import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function RedirectPage({ params }: PageProps) {
  const { slug } = await params;
  
  // Ambil URL dari Supabase
  const { data, error } = await supabase
    .from('shortened_links')
    .select('original_url')
    .eq('slug', slug)
    .single();
  
  if (error || !data) {
    // Link tidak ditemukan, redirect ke home
    redirect('/');
  }
  
  // Increment click count menggunakan rpc function
  supabase.rpc('increment_clicks', { slug_param: slug }).then(() => {}).catch(() => {});
  
  // Redirect ke URL asli
  redirect(data.original_url);
}

// Disable static generation untuk dynamic route
export const dynamic = 'force-dynamic';