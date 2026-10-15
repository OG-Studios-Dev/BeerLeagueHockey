import type { NextRequest } from 'next/server';

import { handleMobilePlayerProfileRequest } from '@/lib/mobile-player-profile';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleMobilePlayerProfileRequest(request);
}
