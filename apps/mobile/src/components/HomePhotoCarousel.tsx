import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { cleanHomePhotoCaption, HOME_PHOTO_SLIDE_LIMIT, selectHomePhotoSlides } from '../lib/homePhotoCarousel';
import type { HomeAlbum, HomePhoto } from '../lib/supabase/home';
import colors from '../theme/colors';
import CarouselPager from './CarouselPager';

export type HomePhotoCarouselProps = {
  photos: HomePhoto[];
  albums: HomeAlbum[];
  scopeKey: string;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  onOpenGallery: (galleryId: string) => void;
};

export default function HomePhotoCarousel({ photos, albums, scopeKey, reduceMotion, reduceTransparency, onOpenGallery }: HomePhotoCarouselProps) {
  const poolSignature = photos
    .map((photo) => [photo.id, photo.url, photo.caption ?? '', photo.gallery_id].join('\u0000'))
    .join('\u0001');
  const [selection, setSelection] = React.useState(() => ({
    scopeKey,
    slides: selectHomePhotoSlides(photos),
    index: 0,
  }));
  const [failedMedia, setFailedMedia] = React.useState<ReadonlySet<string>>(() => new Set());
  React.useEffect(() => {
    setSelection((current) => {
      if (current.scopeKey !== scopeKey) {
        return { scopeKey, slides: selectHomePhotoSlides(photos), index: 0 };
      }
      const poolById = new Map<string, HomePhoto>();
      for (const photo of photos) {
        if (!poolById.has(photo.id)) poolById.set(photo.id, photo);
      }
      const retained = current.slides.flatMap((photo) => {
        const refreshed = poolById.get(photo.id);
        return refreshed ? [refreshed] : [];
      });
      const retainedIds = new Set(retained.map((photo) => photo.id));
      const additions = selectHomePhotoSlides(
        [...poolById.values()].filter((photo) => !retainedIds.has(photo.id)),
        Math.random,
        HOME_PHOTO_SLIDE_LIMIT - retained.length,
      );
      const slides = [...retained, ...additions];
      const selectedId = current.slides[current.index]?.id;
      const retainedIndex = selectedId ? slides.findIndex((photo) => photo.id === selectedId) : -1;
      const index = retainedIndex >= 0
        ? retainedIndex
        : Math.max(0, Math.min(slides.length - 1, current.index));
      return { scopeKey, slides, index };
    });
  // The signature refreshes changed photo facts without reshuffling equivalent arrays.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolSignature, scopeKey]);
  React.useEffect(() => {
    if (reduceMotion || selection.slides.length <= 1) return undefined;
    const intervalScope = selection.scopeKey;
    const timer = setInterval(() => {
      setSelection((current) => current.scopeKey !== intervalScope || current.slides.length <= 1 ? current : {
        ...current,
        index: (current.index + 1) % current.slides.length,
      });
    }, 5500);
    return () => clearInterval(timer);
  }, [reduceMotion, selection.scopeKey, selection.slides.length]);
  const photo = selection.slides[selection.index] ?? null;
  const album = photo ? null : albums.find((candidate) => candidate.cover_photo_url) ?? albums[0] ?? null;
  if (!photo && !album) return null;
  const imageUrl = photo?.url ?? album?.cover_photo_url ?? null;
  const caption = cleanHomePhotoCaption(photo?.caption);
  const imageLabel = caption ?? album?.title ?? 'League photo';
  const galleryId = photo?.gallery_id ?? album!.id;
  const mediaKey = `${photo ? 'photo' : 'album'}:${photo?.id ?? album!.id}:${imageUrl ?? 'missing'}`;
  const mediaUnavailable = !imageUrl || failedMedia.has(mediaKey);
  const destinationLabel = photo
    ? `Open league photo ${selection.index + 1} of ${selection.slides.length} gallery${caption ? `: ${caption}` : ''}`
    : `Open ${album!.title} gallery`;
  const cardAccessibilityLabel = mediaUnavailable ? `Photo unavailable. ${destinationLabel}` : destinationLabel;

  const selectAdjacent = (delta: number) => {
    setSelection((current) => current.slides.length <= 1 ? current : {
      ...current,
      index: (current.index + delta + current.slides.length) % current.slides.length,
    });
  };

  return (
    <View>
      <Pressable
        testID="home-photo-card"
        accessibilityRole="link"
        accessibilityLabel={cardAccessibilityLabel}
        style={[styles.card, reduceTransparency && styles.cardOpaque]}
        onPress={() => onOpenGallery(galleryId)}
      >
        {!mediaUnavailable ? <Image source={{ uri: imageUrl! }} style={styles.image} resizeMode="cover" alt={imageLabel} onError={() => setFailedMedia((current) => new Set(current).add(mediaKey))} /> : (
          <View testID="home-photo-media-unavailable" accessible={false} style={styles.mediaUnavailable}>
            <Ionicons name="image-outline" size={30} color={colors.textSecondary} />
            <Text style={styles.mediaUnavailableText}>Photo unavailable</Text>
          </View>
        )}
      </Pressable>
      <CarouselPager
        currentIndex={selection.index}
        pageCount={selection.slides.length}
        onPrevious={() => selectAdjacent(-1)}
        onNext={() => selectAdjacent(1)}
        previousLabel="Previous league photo"
        nextLabel="Next league photo"
        positionLabel="League Photos position"
        loop
        testID="home-photo"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(125, 190, 255, 0.16)',
    backgroundColor: colors.bgMedia,
    overflow: 'hidden',
  },
  cardOpaque: { backgroundColor: '#0C1B31', borderColor: '#41607F' },
  image: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  mediaUnavailable: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 8 },
  mediaUnavailableText: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '700' },
});
