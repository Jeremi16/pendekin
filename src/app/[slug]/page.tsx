import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface PageProps {
  params: { slug: string };
}

export default async function RedirectPage(props: PageProps) {
  // Di Next.js 15, params bisa berupa Promise atau object biasa
  // Kita handle kedua kasus
  const params = await Promise.resolve(props.params);
  const { slug } = params;
  
  console.log('🔍 Looking for slug:', slug);
  
  try {
    // Ambil URL dari Supabase
    const { data, error } = await supabase
      .from('shortened_links')
      .select('original_url, clicks')
      .eq('slug', slug)
      .single();
    
    console.log('📊 Supabase response:', { data, error });
    
    if (error || !data) {
      console.error('❌ Link not found:', error);
      redirect('/');
      return;
    }
    
    console.log('✅ Found URL:', data.original_url);
    
    // Increment click count (fire and forget - non-blocking)
    supabase
      .from('shortened_links')
      .update({ clicks: (data.clicks || 0) + 1 })
      .eq('slug', slug)
      .then(() => {
        console.log('📈 Click tracked');
      }, (clickError: unknown) => {
        console.error('⚠️ Error tracking click:', clickError);
      });
    
    // Redirect ke URL asli
    console.log('🔄 Redirecting to:', data.original_url);
    redirect(data.original_url);
  } catch (error: unknown) {
    console.error('💥 Error in redirect page:', error);
    redirect('/');
  }
}

// Disable static generation untuk dynamic route
export const dynamic = 'force-dynamic';
export const revalidate = 0;