import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@assar/ui'],
  poweredByHeader: false,
  // Next dev blocks a browser on 127.0.0.1 unless this origin is named.
  // The local demo uses 127.0.0.1 so the API cookie and the page share a host.
  allowedDevOrigins: ['127.0.0.1'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};
export default config;
