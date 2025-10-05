import { createClient } from '@supabase/supabase-js';

// Pastikan environment variables tersedia
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env.local file');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Type definitions
export interface ShortenedLink {
  id: string;
  slug: string;
  original_url: string;
  created_at: string;
  clicks: number;
}