import type { NextRequest } from 'next/server';

import { handlePublicHomeRequest } from '@/lib/public-home';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  _context: { params: Promise<Record<string, string>> },
) {
  return handlePublicHomeRequest(request);
}
