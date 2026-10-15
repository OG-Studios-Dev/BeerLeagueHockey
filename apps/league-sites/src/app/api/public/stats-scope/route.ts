import type { NextRequest } from 'next/server';

import { handlePublicStatsScopeRequest } from '@/lib/public-stats-scope';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  _context: { params: Promise<Record<string, string>> },
) {
  return handlePublicStatsScopeRequest(request);
}
