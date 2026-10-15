import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';
import withSerwistInit from '@serwist/next';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Redirects for navigation redesign — old routes → new routes
  async redirects() {
    return [
      // Old floating season routes → under league hierarchy
      {
        source: '/:locale/dashboard/seasons/:seasonId/standings',
        destination: '/:locale/dashboard/leagues/:leagueId/seasons/:seasonId/standings',
        permanent: true,
        has: [{ type: 'query', key: 'leagueId' }],
      },
      {
        source: '/:locale/dashboard/seasons/:seasonId/eligibility',
        destination: '/:locale/dashboard/leagues/:leagueId/seasons/:seasonId/eligibility',
        permanent: true,
        has: [{ type: 'query', key: 'leagueId' }],
      },
      {
        source: '/:locale/dashboard/seasons/:seasonId/schedule',
        destination: '/:locale/dashboard/leagues/:leagueId/seasons/:seasonId/schedule',
        permanent: true,
        has: [{ type: 'query', key: 'leagueId' }],
      },
      // Old company route → settings
      {
        source: '/:locale/dashboard/company',
        destination: '/:locale/dashboard/settings',
        permanent: true,
      },
      // Old staffing route → staff pool
      {
        source: '/:locale/dashboard/staffing/:path*',
        destination: '/:locale/dashboard/staff',
        permanent: true,
      },
    ];
  },
  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.stripe.com https://connect-js.stripe.com https://b.stripecdn.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self' https://*.supabase.co https://*.supabase.in https://api.stripe.com https://connect-js.stripe.com https://b.stripecdn.com https://q.stripe.com https://r.stripe.com https://merchant-ui-api.stripe.com https://fonts.googleapis.com https://fonts.gstatic.com https://api.openai.com https://*.sentry.io",
              "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://connect-js.stripe.com https://b.stripecdn.com",
              "worker-src 'self' blob:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "upgrade-insecure-requests",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(withSerwist(withNextIntl(nextConfig)), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Upload source maps for readable stack traces
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },

  // Suppress Sentry CLI logs in build output
  silent: !process.env.CI,

  // Tunnel Sentry events through the app to avoid ad blockers
  tunnelRoute: '/monitoring',

  // Disable Sentry telemetry
  telemetry: false,
});
