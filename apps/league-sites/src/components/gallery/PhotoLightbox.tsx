'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { GalleryPhoto } from '@/lib/types';

interface LightboxPhoto {
  id: string;
  url: string;
  caption?: string | null;
}

interface PhotoLightboxViewerProps {
  photos: LightboxPhoto[];
  isOpen: boolean;
  currentIndex: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  dialogLabel?: string;
}

export function getAdjacentPhotoIndex(
  currentIndex: number,
  direction: 1 | -1,
  total: number,
) {
  if (total <= 0) return 0;
  return (currentIndex + direction + total) % total;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function trapFocusWithinDialog(
  event: KeyboardEvent,
  dialog: HTMLElement,
  activeElement: Element | null = document.activeElement,
) {
  if (event.key !== 'Tab') return;

  const focusableElements = Array.from(
    dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.hasAttribute('hidden') &&
      element.getAttribute('aria-hidden') !== 'true',
  );

  if (focusableElements.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  const focusIsOutside = !activeElement || !dialog.contains(activeElement);

  if (event.shiftKey && (activeElement === firstElement || focusIsOutside)) {
    event.preventDefault();
    lastElement.focus();
  } else if (!event.shiftKey && (activeElement === lastElement || focusIsOutside)) {
    event.preventDefault();
    firstElement.focus();
  }
}

export function restoreFocusToInvoker(invoker: HTMLElement | null) {
  if (invoker?.isConnected) {
    invoker.focus();
  }
}

export function isBackdropClick(
  event: Pick<React.MouseEvent, 'currentTarget' | 'target'>,
) {
  return event.target === event.currentTarget;
}

export function PhotoLightboxViewer({
  photos,
  isOpen,
  currentIndex,
  onClose,
  onIndexChange,
  dialogLabel = 'Photo viewer',
}: PhotoLightboxViewerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const total = photos.length;
  const normalizedIndex = total > 0 ? ((currentIndex % total) + total) % total : 0;
  const currentPhoto = photos[normalizedIndex];

  const goNext = useCallback(() => {
    onIndexChange(getAdjacentPhotoIndex(normalizedIndex, 1, total));
  }, [normalizedIndex, onIndexChange, total]);

  const goPrev = useCallback(() => {
    onIndexChange(getAdjacentPhotoIndex(normalizedIndex, -1, total));
  }, [normalizedIndex, onIndexChange, total]);

  useEffect(() => {
    if (!isOpen) return;

    const invoker =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      restoreFocusToInvoker(invoker);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
        case 'ArrowRight':
          event.preventDefault();
          goNext();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          goPrev();
          break;
        case 'Tab':
          if (dialogRef.current) {
            trapFocusWithinDialog(event, dialogRef.current);
          }
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [goNext, goPrev, isOpen, onClose]);

  if (!isOpen || !currentPhoto) return null;

  const photoLabel = currentPhoto.caption || `Photo ${normalizedIndex + 1}`;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={dialogLabel}
      tabIndex={-1}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/90 backdrop-blur-sm"
        onClick={(event) => {
          if (isBackdropClick(event)) onClose();
        }}
        aria-label="Close photo viewer"
        tabIndex={-1}
      />

      <div className="pointer-events-none relative z-10 flex h-full w-full flex-col items-center justify-center p-4 sm:p-8">
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="pointer-events-auto absolute right-4 top-4 z-20 flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Close lightbox"
        >
          <X className="h-6 w-6" aria-hidden="true" />
        </button>

        {total > 1 && (
          <button
            type="button"
            onClick={goPrev}
            className="pointer-events-auto absolute left-4 top-1/2 z-20 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Previous photo"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden="true" />
          </button>
        )}

        <div className="pointer-events-auto relative flex h-full max-h-[80vh] w-full max-w-full items-center justify-center">
          <Image
            src={currentPhoto.url}
            alt={photoLabel}
            fill
            className="object-contain"
            priority
          />
        </div>

        {total > 1 && (
          <button
            type="button"
            onClick={goNext}
            className="pointer-events-auto absolute right-4 top-1/2 z-20 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Next photo"
          >
            <ChevronRight className="h-6 w-6" aria-hidden="true" />
          </button>
        )}

        <div
          className="pointer-events-auto absolute bottom-4 left-1/2 z-20 -translate-x-1/2 text-center"
          aria-live="polite"
        >
          {currentPhoto.caption && (
            <p className="mb-2 max-w-md text-sm text-white">{currentPhoto.caption}</p>
          )}
          <p className="text-xs text-white/60">
            {normalizedIndex + 1} / {total}
          </p>
        </div>
      </div>
    </div>
  );
}

interface PhotoLightboxProps {
  photos: GalleryPhoto[];
  initialIndex?: number;
}

export function PhotoLightbox({ photos, initialIndex = 0 }: PhotoLightboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  const open = useCallback((index: number) => {
    setCurrentIndex(index);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <>
      {/* Photo Grid (clickable thumbnails) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:auto-rows-[150px] lg:grid-cols-6 xl:auto-rows-[170px]">
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => open(index)}
            className={`group relative aspect-square overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] transition-all hover:border-[var(--league-primary)]/50 lg:aspect-auto lg:rounded-2xl ${
              index % 9 === 0
                ? 'lg:col-span-2 lg:row-span-2'
                : index % 7 === 0
                  ? 'lg:col-span-2'
                  : ''
            }`}
            aria-label={`Open ${photo.caption || `photo ${index + 1}`} in photo viewer`}
          >
            <Image
              src={photo.thumbnail_url || photo.url}
              alt={photo.caption || `Photo ${index + 1}`}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
            />
            {photo.caption && (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-xs text-white truncate">{photo.caption}</p>
              </div>
            )}
          </button>
        ))}
      </div>

      <PhotoLightboxViewer
        photos={photos}
        isOpen={isOpen}
        currentIndex={currentIndex}
        onClose={close}
        onIndexChange={setCurrentIndex}
      />
    </>
  );
}
