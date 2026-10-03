/* eslint-disable @typescript-eslint/no-require-imports */
import React, { act } from 'react';

const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, options?: object) => any };

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ locale: 'en', id: 'league-1', articleId: 'article-1' }),
}));
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => ({
  articleTitle: 'Title',
  newspaperTitleLabel: 'Article title',
  newspaperProtectedBanner: 'Protected newspaper snapshot',
  newspaperProtectedImage: 'Protected image',
  featuredImage: 'Featured image',
  uploadFeaturedImage: 'Upload featured image',
  titleRequired: 'Title is required.',
  saveFailed: 'Failed to save article. Please try again.',
}[key] || key) }));
jest.mock('next/link', () => ({ __esModule: true, default: (props: any) => <a {...props} /> }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => <span /> }));
jest.mock('@hockey-life/ui', () => ({ cn: (...values: string[]) => values.filter(Boolean).join(' ') }));
jest.mock('@/components/news/ArticleEntityLinksEditor', () => ({ ArticleEntityLinksEditor: () => <div data-testid="entity-editor" /> }));
jest.mock('@/components/news/ArticleFormatEditor', () => ({ ArticleFormatEditor: () => <div data-testid="format-editor" /> }));
jest.mock('@/components/ui/logo-uploader', () => ({
  LogoUploader: ({ disabled, onUpload, onRemove }: any) => (
    <div>
      <button type="button" data-testid="image-upload" disabled={disabled} onClick={() => onUpload(new File(['x'], 'x.png', { type: 'image/png' }))}>Upload</button>
      <button type="button" data-testid="image-remove" disabled={disabled} onClick={() => onRemove()}>Remove</button>
    </div>
  ),
}));
jest.mock('@/lib/news/article-format-editor', () => ({ serializeArticleEditorContent: (value: string) => value }));
jest.mock('@/lib/actions/article-entities', () => ({
  getArticleEntityEditorContext: jest.fn(), suggestArticleEntities: jest.fn(),
}));
jest.mock('@/lib/actions/image-upload', () => ({ uploadNewsImage: jest.fn(), deleteNewsImage: jest.fn() }));
jest.mock('@/lib/actions/news', () => ({
  getNewsArticle: jest.fn(), updateNewsArticle: jest.fn(), deleteNewsArticle: jest.fn(),
}));

import { getArticleEntityEditorContext } from '@/lib/actions/article-entities';
import { uploadNewsImage, deleteNewsImage } from '@/lib/actions/image-upload';
import { getNewsArticle, updateNewsArticle } from '@/lib/actions/news';
import EditNewsArticlePage from '../page';

const getArticle = getNewsArticle as jest.MockedFunction<typeof getNewsArticle>;
const updateArticle = updateNewsArticle as jest.MockedFunction<typeof updateNewsArticle>;
const getContext = getArticleEntityEditorContext as jest.MockedFunction<typeof getArticleEntityEditorContext>;
const uploadImage = uploadNewsImage as jest.MockedFunction<typeof uploadNewsImage>;
const deleteImage = deleteNewsImage as jest.MockedFunction<typeof deleteNewsImage>;

function article(newspaperLinked: boolean, title = 'Original title') {
  return {
    id: 'article-1', league_id: 'league-1', title, slug: 'original-slug', content: 'original body',
    excerpt: 'original excerpt', image_url: 'https://example.invalid/original.png', type: newspaperLinked ? 'weekly_wrap' : 'news',
    published: newspaperLinked, author_id: 'admin-1', season_id: 'season-1', game_id: 'game-1',
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', newspaper_linked: newspaperLinked,
  };
}

const context = {
  seasonId: 'season-1', resolvedSeasonId: 'season-1', activeSeasonId: 'season-1', seasons: [], players: [], teams: [], games: [],
  linkedPlayerIds: [], linkedTeamIds: [], linkedGameIds: [], primaryGameId: null,
};

async function waitFor(check: () => void) {
  let error: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { check(); return; } catch (caught) { error = caught; }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
  throw error;
}

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

describe('news article editor lifecycle', () => {
  let dom: any;
  let container: HTMLDivElement;
  let root: import('react-dom/client').Root;

  beforeEach(() => {
    jest.clearAllMocks();
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      HTMLElement: dom.window.HTMLElement,
      HTMLInputElement: dom.window.HTMLInputElement,
      Event: dom.window.Event,
      File: dom.window.File,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    getContext.mockResolvedValue(context as never);
    container = document.getElementById('root') as HTMLDivElement;
    const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
  });

  async function renderLoaded() {
    await act(async () => root.render(<EditNewsArticlePage />));
    await waitFor(() => expect(container.querySelector('form')).not.toBeNull());
  }

  it('loads, changes, saves, and reloads a linked title through the real React lifecycle', async () => {
    let stored = article(true);
    getArticle.mockImplementation(async () => ({ success: true, data: { ...stored } }));
    updateArticle.mockImplementation(async (_id, update) => {
      stored = { ...stored, title: update.title! };
      return { success: true, data: { ...stored } };
    });
    await renderLoaded();

    await act(async () => changeInput(container.querySelector('#title') as HTMLInputElement, 'HLT: Week 1 - Fall 2026'));
    await act(async () => container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    await waitFor(() => expect(updateArticle).toHaveBeenCalledWith('article-1', {
      title: 'HLT: Week 1 - Fall 2026',
      expectedTitle: 'Original title',
    }));
    expect(push).toHaveBeenCalledWith('/en/dashboard/leagues/league-1/news');

    await act(async () => root.unmount());
    container = document.createElement('div');
    document.body.appendChild(container);
    const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
    root = createRoot(container);
    await renderLoaded();
    expect((container.querySelector('#title') as HTMLInputElement).value).toBe('HLT: Week 1 - Fall 2026');
  });

  it('rejects the first of two stale editors while keeping its title editable', async () => {
    let stored = article(true);
    getArticle.mockImplementation(async () => ({ success: true, data: { ...stored } }));
    updateArticle.mockImplementation(async (_id, update) => {
      if (update.expectedTitle !== stored.title) {
        return { success: false, error: 'The article title changed while you were editing. Reload and try again.' };
      }
      stored = { ...stored, title: update.title! };
      return { success: true, data: { ...stored } };
    });
    await renderLoaded();

    const staleContainer = container;
    const newerContainer = document.createElement('div');
    document.body.appendChild(newerContainer);
    const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
    const newerRoot = createRoot(newerContainer);
    await act(async () => newerRoot.render(<EditNewsArticlePage />));
    await waitFor(() => expect(newerContainer.querySelector('form')).not.toBeNull());
    await act(async () => changeInput(newerContainer.querySelector('#title') as HTMLInputElement, 'Newer editor title'));
    await act(async () => newerContainer.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    await waitFor(() => expect(stored.title).toBe('Newer editor title'));

    await act(async () => changeInput(staleContainer.querySelector('#title') as HTMLInputElement, 'Stale editor title'));
    await act(async () => container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    await waitFor(() => expect(staleContainer.querySelector('[role="alert"]')?.textContent).toMatch(/changed while/i));
    expect((staleContainer.querySelector('#title') as HTMLInputElement).value).toBe('Stale editor title');
    expect((staleContainer.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
    expect(stored.title).toBe('Newer editor title');
    expect(updateArticle).toHaveBeenLastCalledWith('article-1', {
      title: 'Stale editor title', expectedTitle: 'Original title',
    });
    await act(async () => newerRoot.unmount());
  });

  it('keeps ordinary article saves on the normal full-payload path', async () => {
    getArticle.mockResolvedValue({ success: true, data: article(false) });
    updateArticle.mockResolvedValue({ success: true, data: article(false, 'Ordinary update') });
    await renderLoaded();
    await act(async () => changeInput(container.querySelector('#title') as HTMLInputElement, 'Ordinary update'));
    await act(async () => container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    await waitFor(() => expect(updateArticle).toHaveBeenCalled());
    expect(updateArticle).toHaveBeenCalledWith('article-1', expect.objectContaining({
      title: 'Ordinary update', content: 'original body', slug: 'original-slug', seasonId: 'season-1',
    }));
  });

  it('uses native disabled semantics and prevents image network side effects for linked editions', async () => {
    getArticle.mockResolvedValue({ success: true, data: article(true) });
    await renderLoaded();
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    const upload = container.querySelector('[data-testid="image-upload"]') as HTMLButtonElement;
    const remove = container.querySelector('[data-testid="image-remove"]') as HTMLButtonElement;
    expect(upload.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    await act(async () => { upload.click(); remove.click(); });
    expect(uploadImage).not.toHaveBeenCalled();
    expect(deleteImage).not.toHaveBeenCalled();
    expect((container.querySelector('#title') as HTMLInputElement).disabled).toBe(false);
  });
});
