import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('news editor page integration', () => {
  it.each([
    'src/app/[locale]/dashboard/leagues/[id]/news/new/page.tsx',
    'src/app/[locale]/dashboard/leagues/[id]/news/[articleId]/page.tsx',
  ])('uses the shared structured editor while preserving the content save state in %s', (pagePath) => {
    const page = source(pagePath);

    expect(page).toContain("import { ArticleFormatEditor } from '@/components/news/ArticleFormatEditor';");
    expect(page).toContain('<ArticleFormatEditor');
    expect(page).toContain('value={content}');
    expect(page).toContain('onChange={setContent}');
    expect(page).toContain('serializeArticleEditorContent(content)');
    expect(page).not.toContain('id="content"');
  });

  it('converts structured content to readable text before entity detection', () => {
    const action = source('src/lib/actions/article-entities.ts');

    expect(action).toContain('articleContentToPlainText(input.content)');
  });

  it('validates structured content at both article write boundaries', () => {
    const action = source('src/lib/actions/news.ts');

    expect(action.match(/validateArticleContentForStorage/g)).toHaveLength(3);
    expect(action).toContain("error: 'Invalid article content format'");
  });
});
