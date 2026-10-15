import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// Allowed origins for iframe embedding (website editor preview)
// These are the PARENT origins (league-builder) that may embed league-sites in an iframe.
const FRAME_ANCESTORS = [
  "'self'",
  'https://app.beerleaguehockey.ca',
  'https://beerleaguehockey.ca',
  'https://www.beerleaguehockey.ca',
  'https://*.vercel.app',
  process.env.NEXT_PUBLIC_LEAGUE_BUILDER_URL,
  'http://localhost:3000',
].filter(Boolean).join(' ');

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
  },
  // Enable experimental features for multi-tenant subdomain routing
  experimental: {
    // Allow reading from workspace packages
  },

  // Allow league-builder to embed league-sites in an iframe (website editor preview)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${FRAME_ANCESTORS}`,
          },
        ],
      },
    ];
  },

  // Configure images from Supabase storage and external sources
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.in',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'auth.beerleaguehockey.ca',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'hockeylifehl.com',
        pathname: '/wp-content/uploads/**',
      },
      {
        protocol: 'https',
        hostname: 'www.hockeylifehl.com',
        pathname: '/wp-content/uploads/**',
      },
    ],
  },

  // Transpile workspace packages
  transpilePackages: ['@hockey-life/database', '@hockey-life/ui'],

  // Enable static generation with ISR for league pages
  // Top 100 leagues will be pre-rendered at build time
  // Others will be generated on-demand with 60s revalidation
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },

  silent: !process.env.CI,

  // Tunnel Sentry events through the app to avoid ad blockers
  tunnelRoute: '/monitoring',

  telemetry: false,
});
