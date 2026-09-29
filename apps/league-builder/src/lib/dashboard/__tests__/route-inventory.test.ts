import fs from 'node:fs';
import path from 'node:path';
import {
  DASHBOARD_REDIRECT_MAP,
  DASHBOARD_ROUTE_CLASSIFICATION_COUNTS,
  DASHBOARD_ROUTE_INVENTORY,
} from '@/lib/dashboard/route-inventory';

function discoverDashboardPageRoutes() {
  const dashboardRoot = path.resolve(__dirname, '../../../app/[locale]/dashboard');

  return fs
    .readdirSync(dashboardRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === 'page.tsx')
    .map((entry) => {
      const relativePath = path.relative(dashboardRoot, path.join(entry.parentPath, entry.name));
      const normalizedPath = relativePath.split(path.sep).join('/');
      if (normalizedPath === 'page.tsx') {
        return '/';
      }

      return `/${normalizedPath.replace(/\/page\.tsx$/, '')}`;
    })
    .sort();
}

describe('dashboard route inventory', () => {
  it('covers every dashboard page route exactly once', () => {
    const discoveredRoutes = discoverDashboardPageRoutes();
    const inventoryRoutes = DASHBOARD_ROUTE_INVENTORY.map((entry) => entry.route).sort();

    expect(new Set(inventoryRoutes).size).toBe(inventoryRoutes.length);
    expect(inventoryRoutes).toEqual(discoveredRoutes);
  });

  it('keeps redirect map entries aligned with redirect-shim inventory routes', () => {
    const redirectShimRoutes = DASHBOARD_ROUTE_INVENTORY.filter((entry) => entry.classification === 'redirect-shim').map(
      (entry) => entry.route
    );

    const redirectMapSources = DASHBOARD_REDIRECT_MAP.map((entry) => entry.from);

    expect(DASHBOARD_REDIRECT_MAP.length).toBeGreaterThanOrEqual(redirectShimRoutes.length);
    for (const route of redirectShimRoutes) {
      const fullRoute = `/dashboard${route}`;
      expect(
        redirectMapSources.some((source) => source === fullRoute || source.endsWith('*') && fullRoute.startsWith(source.slice(0, -1)))
      ).toBe(true);
    }
  });

  it('keeps season-owned workflow routes canonical and legacy season routes as shims', () => {
    const canonicalRoutes = new Set(
      DASHBOARD_ROUTE_INVENTORY
        .filter((entry) => entry.classification === 'canonical-workspace')
        .map((entry) => entry.route)
    );
    const redirectRoutes = new Set(
      DASHBOARD_ROUTE_INVENTORY
        .filter((entry) => entry.classification === 'redirect-shim')
        .map((entry) => entry.route)
    );

    for (const route of [
      '/leagues/[id]/seasons/[seasonId]/draft',
      '/leagues/[id]/seasons/[seasonId]/ratings',
      '/leagues/[id]/seasons/[seasonId]/standings',
      '/leagues/[id]/seasons/[seasonId]/eligibility',
    ]) {
      expect(canonicalRoutes.has(route)).toBe(true);
    }

    for (const route of [
      '/leagues/[id]/draft',
      '/leagues/[id]/ratings',
      '/seasons/[seasonId]/schedule',
      '/seasons/[seasonId]/standings',
      '/seasons/[seasonId]/eligibility',
    ]) {
      expect(redirectRoutes.has(route)).toBe(true);
    }
  });

  it('closes the prior candidate-delete routes with explicit outcomes', () => {
    const candidateDeleteRoutes = DASHBOARD_ROUTE_INVENTORY.filter((entry) => entry.classification === 'candidate-delete').map(
      (entry) => entry.route
    );
    const analyticsRoute = DASHBOARD_ROUTE_INVENTORY.find((entry) => entry.route === '/analytics');
    const socialRoute = DASHBOARD_ROUTE_INVENTORY.find((entry) => entry.route === '/leagues/[id]/social');

    expect(candidateDeleteRoutes).toEqual([]);
    expect(analyticsRoute).toMatchObject({
      classification: 'redirect-shim',
      canonicalPath: '/dashboard',
    });
    expect(socialRoute).toMatchObject({
      classification: 'public-supporting',
      canonicalPath: '/dashboard/leagues/[id]/social',
    });
  });

  it('reports the expected classification totals', () => {
    expect(DASHBOARD_ROUTE_INVENTORY).toHaveLength(93);
    expect(DASHBOARD_ROUTE_CLASSIFICATION_COUNTS).toEqual({
      'canonical-workspace': 21,
      'canonical-settings': 17,
      'detail-route': 14,
      'public-supporting': 26,
      'redirect-shim': 15,
      'candidate-delete': 0,
    });
  });
});
