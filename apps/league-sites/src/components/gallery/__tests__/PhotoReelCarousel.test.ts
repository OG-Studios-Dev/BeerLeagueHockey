import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PhotoReelCarousel, {
  getPhotoSelection,
  normalizePhotoIndex,
} from '../PhotoReelCarousel';
import {
  getAdjacentPhotoIndex,
  isBackdropClick,
  PhotoLightbox,
  PhotoLightboxViewer,
  restoreFocusToInvoker,
  trapFocusWithinDialog,
} from '../PhotoLightbox';
import type { GalleryPhoto, ReelPhoto } from '@/lib/types';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const photos: ReelPhoto[] = [
  {
    id: 'photo-1',
    url: 'https://images.example.com/championship.jpg',
    caption: 'Championship celebration',
    album_id: 'album-1',
    album_title: 'Finals',
    album_href: '/london/gallery/album-1',
  },
];

const galleryPhotos: GalleryPhoto[] = [
  {
    id: 'grid-photo-1',
    gallery_id: 'gallery-1',
    url: '/grid-photo.jpg',
    thumbnail_url: '/grid-photo-thumbnail.jpg',
    caption: 'Grid championship photo',
    display_order: 0,
    created_at: '2026-10-15T12:00:00.000Z',
  },
];

describe('PhotoReelCarousel', () => {
  it('renders the current photo as an in-page lightbox button instead of a link', () => {
    const html = renderToStaticMarkup(
      React.createElement(PhotoReelCarousel, {
        photos,
        galleryHref: '/london/gallery',
      }),
    );

    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Open Championship celebration in photo viewer"');
    expect(html).not.toContain('<a');
  });

  it('normalizes a retained carousel index before a shorter photo list is read', () => {
    expect(normalizePhotoIndex(4, 2)).toBe(0);
    expect(normalizePhotoIndex(3, 2)).toBe(1);
    expect(normalizePhotoIndex(4, 0)).toBe(0);

    const shortenedPhotos = [photos[0]];
    expect(getPhotoSelection(shortenedPhotos, 4)).toEqual({
      index: 0,
      photo: shortenedPhotos[0],
    });
    expect(getPhotoSelection([], 4)).toBeNull();
  });

  it('keeps the existing grid consumer on a native lightbox trigger', () => {
    const html = renderToStaticMarkup(
      React.createElement(PhotoLightbox, { photos: galleryPhotos }),
    );

    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Open Grid championship photo in photo viewer"');
    expect(html).not.toContain('<a');
  });

  it('traps forward and reverse Tab navigation inside the dialog', () => {
    const backdrop = {
      focus: jest.fn(),
      hasAttribute: jest.fn(() => false),
      getAttribute: jest.fn(() => null),
      tabIndex: -1,
    } as unknown as HTMLElement;
    const first = {
      focus: jest.fn(),
      hasAttribute: jest.fn(() => false),
      getAttribute: jest.fn(() => null),
      tabIndex: 0,
    } as unknown as HTMLElement;
    const last = {
      focus: jest.fn(),
      hasAttribute: jest.fn(() => false),
      getAttribute: jest.fn(() => null),
      tabIndex: 0,
    } as unknown as HTMLElement;
    const dialog = {
      querySelectorAll: jest.fn(() => [backdrop, first, last]),
      contains: jest.fn(() => true),
    } as unknown as HTMLElement;
    const forwardEvent = {
      key: 'Tab',
      shiftKey: false,
      preventDefault: jest.fn(),
    } as unknown as KeyboardEvent;
    const reverseEvent = {
      key: 'Tab',
      shiftKey: true,
      preventDefault: jest.fn(),
    } as unknown as KeyboardEvent;

    trapFocusWithinDialog(forwardEvent, dialog, last);
    trapFocusWithinDialog(reverseEvent, dialog, first);

    expect(forwardEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(backdrop.focus).not.toHaveBeenCalled();
    expect(first.focus).toHaveBeenCalledTimes(1);
    expect(reverseEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(last.focus).toHaveBeenCalledTimes(1);
  });

  it('restores focus only to a connected invoker', () => {
    const connectedInvoker = {
      isConnected: true,
      focus: jest.fn(),
    } as unknown as HTMLElement;
    const detachedInvoker = {
      isConnected: false,
      focus: jest.fn(),
    } as unknown as HTMLElement;

    restoreFocusToInvoker(connectedInvoker);
    restoreFocusToInvoker(detachedInvoker);

    expect(connectedInvoker.focus).toHaveBeenCalledTimes(1);
    expect(detachedInvoker.focus).not.toHaveBeenCalled();
  });

  it('closes only for a true backdrop activation', () => {
    const backdrop = {};
    const content = {};

    expect(
      isBackdropClick({ target: backdrop, currentTarget: backdrop } as unknown as React.MouseEvent),
    ).toBe(true);
    expect(
      isBackdropClick({ target: content, currentTarget: backdrop } as unknown as React.MouseEvent),
    ).toBe(false);
  });

  it('renders accessible lightbox controls with the selected caption metadata', () => {
    const html = renderToStaticMarkup(
      React.createElement(PhotoLightboxViewer, {
        photos: [
          { id: 'photo-1', url: '/championship.jpg', caption: 'Championship celebration' },
          { id: 'photo-2', url: '/team-photo.jpg', caption: null },
        ],
        isOpen: true,
        currentIndex: 0,
        onClose: jest.fn(),
        onIndexChange: jest.fn(),
        dialogLabel: 'League photos',
      }),
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="League photos"');
    expect(html).toContain('alt="Championship celebration"');
    expect(html).toContain('Championship celebration');
    expect(html).toContain('aria-label="Close photo viewer"');
    expect(html).toContain('pointer-events-none');
    expect(html).toContain('pointer-events-auto');
    expect(html).toContain('aria-label="Close lightbox"');
    expect(html).toContain('aria-label="Previous photo"');
    expect(html).toContain('aria-label="Next photo"');
    expect(html).toContain('1 / 2');
  });

  it('wraps previous and next navigation within the lightbox', () => {
    expect(getAdjacentPhotoIndex(0, -1, 3)).toBe(2);
    expect(getAdjacentPhotoIndex(2, 1, 3)).toBe(0);
  });
});
