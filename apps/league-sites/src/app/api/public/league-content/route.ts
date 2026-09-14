import type { NextRequest } from 'next/server';

import { handlePublicLeagueContentRequest } from '@/lib/public-league-content';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handlePublicLeagueContentRequest(request);
}
