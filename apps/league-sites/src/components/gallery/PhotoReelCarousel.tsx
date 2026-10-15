'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PhotoLightboxViewer } from './PhotoLightbox';
import type { ReelPhoto } from '@/lib/types';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function normalizePhotoIndex(index: number, total: number) {
  if (total <= 0) return 0;
  return ((index % total) + total) % total;
}

export function getPhotoSelection<T>(photos: T[], index: number) {
  if (photos.length === 0) return null;
  const normalizedIndex = normalizePhotoIndex(index, photos.length);
  return { index: normalizedIndex, photo: photos[normalizedIndex] };
}

interface PhotoReelCarouselProps {
  photos: ReelPhoto[];
  galleryHref: string;
}

export default function PhotoReelCarousel({ photos }: PhotoReelCarouselProps) {
  const shuffled = useMemo(() => shuffle(photos), [photos]);
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const total = shuffled.length;
  const selection = getPhotoSelection(shuffled, current);
  const normalizedCurrent = selection?.index ?? 0;

  const advance = useCallback(
    (dir: 1 | -1) => {
      setCurrent((previous) => normalizePhotoIndex(previous + dir, total));
    },
    [total],
  );

  useEffect(() => {
    if (paused || isLightboxOpen || total <= 1) return;
    timerRef.current = setInterval(() => advance(1), 8000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [paused, isLightboxOpen, advance, total]);

  if (!selection) return null;

  const activePhoto = selection.photo;
  const activePhotoLabel = activePhoto.caption || `League photo ${normalizedCurrent + 1}`;

  return (
    <>
      <div
        className="relative w-full overflow-hidden rounded-2xl shadow-xl"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="relative aspect-[4/3] w-full bg-black sm:aspect-[16/9] xl:aspect-[21/9]">
          {shuffled.map((photo, index) => (
            <img
              key={photo.id}
              src={photo.url}
              alt={index === normalizedCurrent ? photo.caption || `League photo ${index + 1}` : ''}
              aria-hidden={index !== normalizedCurrent}
              className={`absolute inset-0 h-full w-full object-cover transition-all duration-[1200ms] ease-in-out ${
                index === normalizedCurrent
                  ? 'opacity-100 scale-[1.05]'
                  : 'opacity-0 scale-100'
              }`}
              loading={index < 2 ? 'eager' : 'lazy'}
              draggable={false}
            />
          ))}

          <button
            type="button"
            onClick={() => setIsLightboxOpen(true)}
            aria-label={`Open ${activePhotoLabel} in photo viewer`}
            className="absolute inset-0 z-[1] cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-white"
          />

          {total > 1 && (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  advance(-1);
                }}
                aria-label="Previous photo"
                className="absolute left-3 top-1/2 z-10 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 p-2 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-white"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  advance(1);
                }}
                aria-label="Next photo"
                className="absolute right-3 top-1/2 z-10 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 p-2 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-white"
              >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            </>
          )}

          {total > 1 && (
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
              {shuffled.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setCurrent(index);
                  }}
                  aria-label={`Go to photo ${index + 1}`}
                  aria-current={index === normalizedCurrent ? 'true' : undefined}
                  className={`min-h-11 rounded-full transition-all duration-300 before:block before:h-1.5 before:rounded-full ${
                    index === normalizedCurrent
                      ? 'w-6 before:w-6 before:bg-white'
                      : 'w-3 before:w-1.5 before:bg-white/40 hover:before:bg-white/60'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <PhotoLightboxViewer
        photos={shuffled}
        isOpen={isLightboxOpen}
        currentIndex={normalizedCurrent}
        onIndexChange={setCurrent}
        onClose={() => setIsLightboxOpen(false)}
        dialogLabel="League photos"
      />
    </>
  );
}
