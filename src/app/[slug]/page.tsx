import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function RedirectPage({ params }: PageProps) {
  const { slug } = await params;
  
  try {
    // Ambil URL dari Supabase
    const { data, error } = await supabase
      .from('shortened_links')
      .select('original_url, clicks')
      .eq('slug', slug)
      .single();
    
    if (error || !data) {
      console.error('Link not found:', error);
      redirect('/');
    }
    
    // Increment click count (non-blocking)
    supabase
      .from('shortened_links')
      .update({ clicks: (data.clicks || 0) + 1 })
      .eq('slug', slug)
      .then(() => console.log('Click tracked'), (err) => console.error('Error tracking click:', err));
    
    // Redirect ke URL asli
    redirect(data.original_url);
  } catch (error) {
    console.error('Error in redirect page:', error);
    redirect('/');
  }
}

// Disable static generation untuk dynamic route
export const dynamic = 'force-dynamic';
export const revalidate = 0;