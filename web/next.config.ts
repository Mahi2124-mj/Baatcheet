import path from 'node:path';
import type { NextConfig } from 'next';

// In development the API runs on its own port; the browser talks to it through these rewrites so
// the session cookie stays first-party. In production a reverse proxy (Caddy) does the same.
const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace root, so the standalone build includes the shared package.
  outputFileTracingRoot: path.join(__dirname, '..'),
  // The Docker image uses the small standalone server; local `next start` doesn't need it.
  output: process.env.NEXT_STANDALONE === '1' ? 'standalone' : undefined,
  transpilePackages: ['@baatcheet/shared'],
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${api}/api/:path*` },
      { source: '/files/:path*', destination: `${api}/files/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Camera / microphone only for this site itself.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), display-capture=(self), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
