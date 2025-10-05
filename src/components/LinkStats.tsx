'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface LinkStats {
  slug: string;
  original_url: string;
  clicks: number;
  created_at: string;
}

export default function LinkStats() {
  const [stats, setStats] = useState<LinkStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const { data, error } = await supabase
        .from('shortened_links')
        .select('slug, original_url, clicks, created_at')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setStats(data || []);
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-4">Loading...</div>;
  }

  if (stats.length === 0) {
    return null;
  }

  return (
    <div className="mt-8 bg-white rounded-xl shadow-lg p-6 border border-gray-100">
      <h2 className="text-xl font-bold text-gray-800 mb-4">
        Link Terbaru (10 terakhir)
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-3 font-medium text-gray-700">Short URL</th>
              <th className="text-left py-2 px-3 font-medium text-gray-700">Original URL</th>
              <th className="text-center py-2 px-3 font-medium text-gray-700">Clicks</th>
              <th className="text-left py-2 px-3 font-medium text-gray-700">Created</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((link) => (
              <tr key={link.slug} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-3">
                  <code className="text-blue-600 font-mono text-xs">
                    /{link.slug}
                  </code>
                </td>
                <td className="py-2 px-3 max-w-xs truncate text-gray-600">
                  {link.original_url}
                </td>
                <td className="py-2 px-3 text-center">
                  <span className="inline-flex items-center justify-center bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                    {link.clicks}
                  </span>
                </td>
                <td className="py-2 px-3 text-gray-500 text-xs">
                  {new Date(link.created_at).toLocaleDateString('id-ID')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}