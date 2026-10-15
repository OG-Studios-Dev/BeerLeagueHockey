import type { NextRequest } from 'next/server';

import { handlePublicSeasonStatsRequest } from '@/lib/public-stat-metrics';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  _context: { params: Promise<Record<string, string>> },
) {
  return handlePublicSeasonStatsRequest(request);
}
