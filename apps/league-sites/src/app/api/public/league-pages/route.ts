import type { NextRequest } from 'next/server';

import { handlePublicLeaguePagesRequest } from '@/lib/public-league-pages';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  _context: { params: Promise<Record<string, string>> },
) {
  return handlePublicLeaguePagesRequest(request);
}
