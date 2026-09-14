import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyArticleHref, filterArticles, groupAlbums, parseArticleBlocks, parseInlineMarkdown, splitRichTextParagraphs } from '../../src/lib/leagueContentModel.ts';

describe('native league content model', () => {
  it('preserves published paragraphs and routes only safe, known links', () => {
    const body = 'First **published** paragraph.\n\nSecond line\ncontinues.\n\n[Player](https://hockey-life.beerleaguehockey.ca/players/11111111-1111-4111-8111-111111111111)';
    assert.deepEqual(splitRichTextParagraphs(body), [
      'First **published** paragraph.',
      'Second line\ncontinues.',
      '[Player](https://hockey-life.beerleaguehockey.ca/players/11111111-1111-4111-8111-111111111111)',
    ]);
    assert.deepEqual(classifyArticleHref('https://hockey-life.beerleaguehockey.ca/players/11111111-1111-4111-8111-111111111111', 'hockey-life'), { kind: 'player', id: '11111111-1111-4111-8111-111111111111' });
    assert.deepEqual(classifyArticleHref('/teams/id/22222222-2222-4222-8222-222222222222', 'hockey-life'), { kind: 'team', id: '22222222-2222-4222-8222-222222222222' });
    assert.deepEqual(classifyArticleHref('https://hockey-life.beerleaguehockey.ca/news/linked-story?source=article#result', 'hockey-life'), { kind: 'article', slug: 'linked-story' });
    assert.deepEqual(classifyArticleHref('https://example.com/reference', 'hockey-life'), { kind: 'external', url: 'https://example.com/reference' });
    assert.equal(classifyArticleHref('javascript:alert(1)', 'hockey-life'), null);
    assert.equal(classifyArticleHref('mailto:synthetic@example.com', 'hockey-life'), null);
  });

  it('projects readable markdown blocks without dropping published body text', () => {
    const body = '## Final Score\n\nA **complete** paragraph with [the team](/teams/id/22222222-2222-4222-8222-222222222222).\n\n- First recorded goal\n- Second recorded goal';
    const blocks = parseArticleBlocks(body);
    assert.deepEqual(blocks.map(block => [block.kind, block.text]), [
      ['heading', 'Final Score'],
      ['paragraph', 'A **complete** paragraph with [the team](/teams/id/22222222-2222-4222-8222-222222222222).'],
      ['bullet', 'First recorded goal'],
      ['bullet', 'Second recorded goal'],
    ]);
    assert.deepEqual(parseInlineMarkdown(blocks[1]!.text), [
      { text: 'A ', href: null, strong: false },
      { text: 'complete', href: null, strong: true },
      { text: ' paragraph with ', href: null, strong: false },
      { text: 'the team', href: '/teams/id/22222222-2222-4222-8222-222222222222', strong: false },
      { text: '.', href: null, strong: false },
    ]);
    assert.equal(blocks.map(block => parseInlineMarkdown(block.text).map(token => token.text).join('')).join('|'), 'Final Score|A complete paragraph with the team.|First recorded goal|Second recorded goal');
  });

  it('matches website recap categories and deduplicates season-grouped albums', () => {
    // SYNTHETIC FIXTURES: labels only; no league facts.
    const articles = [
      { id: '1', type: 'news' }, { id: '2', type: 'game_recap' }, { id: '3', type: 'weekly_wrap' },
    ] as never[];
    assert.equal(filterArticles(articles, 'Recaps').length, 2);
    assert.equal(filterArticles(articles, 'News').length, 1);
    const albums = [
      { id: 'a', seasonId: 's1' }, { id: 'a', seasonId: 's1' }, { id: 'b', seasonId: null },
    ] as never[];
    assert.deepEqual(groupAlbums(albums, [{ id: 's1', name: 'Synthetic season' }] as never[]).map(group => [group.label, group.albums.length]), [['Synthetic season', 1], ['Other', 1]]);
  });
});
