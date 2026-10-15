import 'server-only';

export const NEWSPAPER_ARTICLE_FROZEN_ERROR =
  'This newspaper article is frozen. Use the Hockey Life Times workflow; only visibility may be changed here.';

type NewspaperLookupClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: { id: string } | null; error: { message?: string } | null }>;
      };
    };
  };
};

export async function isNewspaperLinkedArticle(
  client: NewspaperLookupClient,
  articleId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('newspaper_editions')
    .select('id')
    .eq('article_id', articleId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to verify newspaper article protection: ${error.message || 'database query failed'}`);
  }
  return Boolean(data);
}

export function isVisibilityOnlyUpdate(updates: object): boolean {
  const keys = Object.entries(updates).filter(([, value]) => value !== undefined).map(([key]) => key);
  return keys.length === 1 && keys[0] === 'published';
}

export function isTitleOnlyUpdate(updates: object): boolean {
  const keys = Object.entries(updates).filter(([, value]) => value !== undefined).map(([key]) => key);
  return keys.includes('title') && keys.every((key) => key === 'title' || key === 'expectedTitle');
}
