import type { NextRequest } from 'next/server';

import { handlePublicCareerLeaguesRequest } from '@/lib/public-career-leagues';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  _context: { params: Promise<Record<string, string>> },
) {
  return handlePublicCareerLeaguesRequest(request);
}
