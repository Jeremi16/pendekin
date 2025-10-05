'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface ShortenedLink {
  id: string;
  slug: string;
  original_url: string;
  created_at: string;
  clicks: number;
}

export default function DebugPage() {
  const [links, setLinks] = useState<ShortenedLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadLinks();
  }, []);

  const loadLinks = async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('shortened_links')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
        console.error('Error:', fetchError);
      } else {
        setLinks(data || []);
        console.log('Loaded links:', data);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const testRedirect = (slug: string) => {
    const url = `${window.location.origin}/${slug}`;
    window.open(url, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h1 className="text-2xl font-bold mb-4">🔍 Debug - All Links</h1>
          
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              <strong>Error:</strong> {error}
            </div>
          )}

          <div className="mb-4">
            <button
              onClick={loadLinks}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              🔄 Refresh
            </button>
          </div>

          {links.length === 0 ? (
            <div className="text-gray-500 text-center py-8">
              Tidak ada link. Buat link baru terlebih dahulu.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-2 text-left">Slug</th>
                    <th className="px-4 py-2 text-left">Original URL</th>
                    <th className="px-4 py-2 text-center">Clicks</th>
                    <th className="px-4 py-2 text-left">Created</th>
                    <th className="px-4 py-2 text-center">Test</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((link) => (
                    <tr key={link.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <code className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                          /{link.slug}
                        </code>
                      </td>
                      <td className="px-4 py-2 max-w-md truncate">
                        <a 
                          href={link.original_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {link.original_url}
                        </a>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span className="bg-green-100 text-green-800 px-2 py-1 rounded">
                          {link.clicks || 0}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {new Date(link.created_at).toLocaleString('id-ID')}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => testRedirect(link.slug)}
                          className="bg-purple-600 text-white px-3 py-1 rounded text-xs hover:bg-purple-700"
                        >
                          Test Redirect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-6 text-sm text-gray-600">
            <strong>Total Links:</strong> {links.length}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-bold mb-2">📝 How to Test:</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
            <li>Buat link pendek di halaman utama</li>
            <li>Klik &quot;Refresh&quot; di atas untuk melihat link</li>
            <li>Klik &quot;Test Redirect&quot; untuk test apakah redirect berfungsi</li>
            <li>Atau copy slug dan buka manual: <code className="bg-gray-100 px-2 py-1 rounded">localhost:3000/[slug]</code></li>
          </ol>
        </div>
      </div>
    </div>
  );
}