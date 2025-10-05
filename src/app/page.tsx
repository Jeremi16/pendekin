'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function LinkShortener() {
  const [originalUrl, setOriginalUrl] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [shortUrl, setShortUrl] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState('shortly.pp.ua');

  const availableDomains = [
    'shortly.pp.ua',
    'pendekin.qzz.io'
  ];

  const normalizeUrl = (url: string): string => {
    const trimmedUrl = url.trim();
    if (trimmedUrl.match(/^https?:\/\//i)) {
      return trimmedUrl;
    }
    if (trimmedUrl.startsWith('//')) {
      return `https:${trimmedUrl}`;
    }
    return `https://${trimmedUrl}`;
  };

  const validateUrl = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const domainPattern = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
      
      if (!domainPattern.test(hostname)) {
        return false;
      }
      
      const parts = hostname.split('.');
      if (parts.length < 2) {
        return false;
      }
      
      const lastPart = parts[parts.length - 1];
      if (lastPart.length < 2) {
        return false;
      }
      
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

    const normalizedUrl = normalizeUrl(originalUrl);

    if (!validateUrl(normalizedUrl)) {
      setError('URL tidak valid. Harus berupa domain dengan ekstensi (contoh: google.com, example.co.id)');
      return;
    }

    setError('');
    setIsGenerating(true);

    try {
      const response = await fetch('/api/shorten', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originalUrl: normalizedUrl,
          customPath: customPath.trim() || undefined,
          domain: selectedDomain
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Gagal membuat link pendek');
      }

      setShortUrl(data.shortUrl);
      setOriginalUrl(normalizedUrl);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Terjadi kesalahan saat membuat link. Coba lagi.';
      setError(errorMessage);
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

  const handleUrlBlur = () => {
    if (originalUrl.trim()) {
      const normalized = normalizeUrl(originalUrl);
      if (normalized !== originalUrl) {
        setOriginalUrl(normalized);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      {/* Frosted Glass Container */}
      <div className="relative w-full max-w-2xl">
        {/* Glow Effect */}
        <div className="absolute -inset-1 bg-gradient-to-r from-blue-400/20 via-cyan-400/20 to-slate-400/20 rounded-3xl blur-2xl"></div>
        
        {/* Main Card */}
        <div className="relative bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-3xl shadow-2xl p-8 border border-slate-700/50">
          {/* Header */}
          <div className="text-center mb-10">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-slate-200 via-cyan-200 to-slate-300 bg-clip-text text-transparent mb-3">
              PendekIn
            </h1>
            <p className="text-slate-400 text-sm">
              PendekIn link anda dengan mudah dan cepat!
            </p>
          </div>

          <div className="space-y-6">
            {/* URL Input */}
            <div>
              <label htmlFor="originalUrl" className="block text-sm font-medium text-slate-300 mb-3">
                URL Asli
              </label>
              <input
                id="originalUrl"
                type="text"
                value={originalUrl}
                onChange={(e) => setOriginalUrl(e.target.value)}
                onBlur={handleUrlBlur}
                placeholder="google.com, example.co.id"
                className="w-full px-5 py-4 bg-slate-900/50 border border-slate-700 rounded-2xl text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all backdrop-blur-sm"
              />
              {error && (
                <p className="text-red-400 text-sm mt-2 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  {error}
                </p>
              )}
              <p className="text-slate-500 text-xs mt-2">
                Domain dengan ekstensi akan otomatis ditambahkan https://
              </p>
            </div>

            {/* Domain Dropdown */}
            <div>
              <label htmlFor="domain" className="block text-sm font-medium text-slate-300 mb-3">
                Pilih Domain
              </label>
              <div className="relative">
                <select
                  id="domain"
                  value={selectedDomain}
                  onChange={(e) => setSelectedDomain(e.target.value)}
                  className="w-full px-5 py-4 bg-slate-900/50 border border-slate-700 rounded-2xl text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all backdrop-blur-sm appearance-none cursor-pointer"
                >
                  {availableDomains.map((domain) => (
                    <option key={domain} value={domain} className="bg-slate-900">
                      {domain}
                    </option>
                  ))}
                </select>
                <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Custom Path */}
            <div>
              <label htmlFor="customPath" className="block text-sm font-medium text-slate-300 mb-3">
                Path Kustom (Opsional)
              </label>
              <div className="flex items-center gap-3 bg-slate-900/50 border border-slate-700 rounded-2xl px-5 py-4 backdrop-blur-sm">
                <span className="text-slate-500 text-sm whitespace-nowrap">{selectedDomain}/</span>
                <input
                  id="customPath"
                  type="text"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  placeholder="nama-unik"
                  className="flex-1 bg-transparent text-slate-200 placeholder-slate-600 focus:outline-none"
                />
              </div>
              <p className="text-slate-500 text-xs mt-2">
                Kosongkan untuk slug acak 8 karakter
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleShorten}
                disabled={isGenerating || !originalUrl.trim()}
                className={`flex-1 py-4 px-6 rounded-2xl font-medium transition-all duration-300 ${
                  isGenerating || !originalUrl.trim()
                    ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
                    : 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-500 hover:to-blue-500 shadow-lg shadow-cyan-500/25'
                }`}
              >
                {isGenerating ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Memproses...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Buat Link Pendek
                  </span>
                )}
              </button>
              
              {shortUrl && (
                <button
                  onClick={resetForm}
                  className="px-5 py-4 bg-slate-700/50 text-slate-300 rounded-2xl hover:bg-slate-700 transition-all duration-300 border border-slate-600/50"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              )}
            </div>

            {/* Result */}
            {shortUrl && (
              <div className="mt-6 p-6 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-sm rounded-2xl border border-slate-700/50">
                <h3 className="text-sm font-medium text-cyan-400 mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Link Pendek Berhasil Dibuat
                </h3>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 px-4 py-3 bg-slate-900/70 border border-slate-700/50 rounded-xl">
                    <p className="text-slate-200 font-mono text-sm truncate">{shortUrl}</p>
                  </div>
                  <button
                    onClick={copyToClipboard}
                    className={`px-5 py-3 rounded-xl font-medium transition-all duration-300 whitespace-nowrap ${
                      copied
                        ? 'bg-green-600 text-white'
                        : 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-500 hover:to-blue-500'
                    }`}
                  >
                    {copied ? (
                      <span className="flex items-center gap-2">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Tersalin!
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Salin
                      </span>
                    )}
                  </button>
                </div>
                <p className="text-slate-500 text-xs mt-4 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  Redirect ke: <span className="text-cyan-400 truncate">{originalUrl}</span>
                </p>
              </div>
            )}
          </div>

          {/* Footer Badge */}
          <div className="mt-8 pt-6 border-t border-slate-700/50 text-center">
            <p className="text-slate-500 text-xs">
              <Link href="https://jere.work" target="_blank" className="hover:text-cyan-400 transition-colors">
                Powered by jere.work
              </Link>
              
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}