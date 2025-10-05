'use client';

import { useState } from 'react';

export default function LinkShortener() {
  const [originalUrl, setOriginalUrl] = useState('');
  const [customPath, setCustomPath] = useState(''); // Opsional: custom path
  const [shortUrl, setShortUrl] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Domain Anda sendiri
  const yourDomain = 'shortly.pp.ua'; // Ganti dengan domain Anda

  const validateUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const handleShorten = async () => {
    if (!originalUrl.trim()) {
      setError('Silakan masukkan URL yang valid');
      return;
    }

    if (!validateUrl(originalUrl)) {
      setError('URL tidak valid. Pastikan dimulai dengan http:// atau https://');
      return;
    }

    setError('');
    setIsGenerating(true);

    try {
      // Panggil API backend Anda
      const response = await fetch('/api/shorten', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originalUrl,
          customPath: customPath.trim() || undefined,
          domain: yourDomain
        }),
      });

      if (!response.ok) {
        throw new Error('Gagal membuat link pendek');
      }

      const data = await response.json();
      setShortUrl(data.shortUrl);
    } catch (err) {
      setError('Terjadi kesalahan saat membuat link. Coba lagi.');
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = async () => {
    if (shortUrl) {
      try {
        await navigator.clipboard.writeText(shortUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy: ', err);
      }
    }
  };

  const resetForm = () => {
    setOriginalUrl('');
    setCustomPath('');
    setShortUrl('');
    setError('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-2xl border border-gray-100">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            {yourDomain}
          </h1>
          <p className="text-gray-600">
            Buat link pendek dengan domain Anda sendiri
          </p>
        </div>

        <div className="space-y-6">
          {/* URL Input */}
          <div>
            <label htmlFor="originalUrl" className="block text-sm font-medium text-gray-700 mb-2">
              URL Asli
            </label>
            <input
              id="originalUrl"
              type="text"
              value={originalUrl}
              onChange={(e) => setOriginalUrl(e.target.value)}
              placeholder="https://masukkan.url.panjang.anda.di.sini/"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
            {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
          </div>

          {/* Custom Path (Opsional) */}
          <div>
            <label htmlFor="customPath" className="block text-sm font-medium text-gray-700 mb-2">
              Path Kustom (Opsional)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">https://{yourDomain}/</span>
              <input
                id="customPath"
                type="text"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="nama-link-anda"
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Biarkan kosong untuk path acak
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleShorten}
              disabled={isGenerating || !originalUrl.trim()}
              className={`flex-1 py-3 px-6 rounded-lg font-medium transition-all ${
                isGenerating || !originalUrl.trim()
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {isGenerating ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.644z"></path>
                  </svg>
                  Memproses...
                </span>
              ) : 'Buat Link Pendek'}
            </button>
            
            {shortUrl && (
              <button
                onClick={resetForm}
                className="px-4 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Reset
              </button>
            )}
          </div>

          {/* Result */}
          {shortUrl && (
            <div className="mt-6 p-5 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
              <h3 className="text-sm font-medium text-blue-800 mb-3">Link Pendek Anda:</h3>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={shortUrl}
                  readOnly
                  className="flex-1 px-4 py-3 bg-white border border-blue-300 rounded-lg text-blue-800 truncate font-mono text-sm"
                />
                <button
                  onClick={copyToClipboard}
                  className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
                >
                  {copied ? 'Disalin!' : 'Salin Link'}
                </button>
              </div>
              <p className="text-xs text-blue-600 mt-3">
                Link ini akan mengarahkan ke: {originalUrl}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}