import type { NextRequest } from 'next/server';

import { handlePublicPlayerCareerRequest } from '@/lib/public-native-stats';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  _context: { params: Promise<Record<string, string>> },
) {
  return handlePublicPlayerCareerRequest(request);
}
