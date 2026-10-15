import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
};

type MediaOwner = {
  key: string | null;
  lifetime: number;
};

type ViewerMedia = MediaOwner & {
  status: 'loading' | 'loaded' | 'error';
};

export default function HomePhotoCarousel({ photos, albums, scopeKey, reduceMotion, reduceTransparency }: HomePhotoCarouselProps) {
  const insets = useSafeAreaInsets();
  const poolSignature = photos
    .map((photo) => [photo.id, photo.url, photo.caption ?? '', photo.gallery_id].join('\u0000'))
    .join('\u0001');
  const [selection, setSelection] = React.useState(() => ({
    scopeKey,
    slides: selectHomePhotoSlides(photos),
    index: 0,
  }));
  const photo = selection.slides[selection.index] ?? null;
  const album = photo ? null : albums.find((candidate) => candidate.cover_photo_url) ?? albums[0] ?? null;
  const imageUrl = photo?.url ?? album?.cover_photo_url ?? null;
  const mediaKey = photo || album
    ? `${scopeKey}:${photo ? 'photo' : 'album'}:${photo?.id ?? album!.id}:${imageUrl ?? 'missing'}`
    : null;
  const [failedMedia, setFailedMedia] = React.useState<ReadonlySet<string>>(() => new Set());
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerMedia, setViewerMedia] = React.useState<ViewerMedia>({ key: null, lifetime: 0, status: 'loading' });
  const [cardOwner, setCardOwner] = React.useState<MediaOwner>(() => ({
    key: mediaKey,
    lifetime: mediaKey ? 1 : 0,
  }));
  const [viewerOwner, setViewerOwner] = React.useState<MediaOwner>({ key: null, lifetime: 0 });
  const activeScopeRef = React.useRef(scopeKey);
  const autoplayGenerationRef = React.useRef(0);
  const reduceMotionRef = React.useRef(reduceMotion);
  const viewerOpenRef = React.useRef(false);
  const cardLifetimeRef = React.useRef(cardOwner.lifetime);
  const cardOwnerRef = React.useRef<MediaOwner>(cardOwner);
  const viewerLifetimeRef = React.useRef(0);
  const viewerOwnerRef = React.useRef<MediaOwner>(viewerOwner);
  const viewerVisible = viewerOpen && selection.scopeKey === scopeKey;
  React.useLayoutEffect(() => {
    if (activeScopeRef.current !== scopeKey) {
      activeScopeRef.current = scopeKey;
      autoplayGenerationRef.current += 1;
      viewerOpenRef.current = false;
    }
    reduceMotionRef.current = reduceMotion;
    viewerOpenRef.current = viewerVisible;
  }, [reduceMotion, scopeKey, viewerVisible]);
  React.useLayoutEffect(() => {
    if (cardOwnerRef.current.key === mediaKey) {
      if (
        cardOwner.key !== cardOwnerRef.current.key
        || cardOwner.lifetime !== cardOwnerRef.current.lifetime
      ) setCardOwner(cardOwnerRef.current);
      return;
    }
    const owner = { key: mediaKey, lifetime: ++cardLifetimeRef.current };
    cardOwnerRef.current = owner;
    setCardOwner(owner);
  }, [cardOwner.key, cardOwner.lifetime, mediaKey]);
  React.useLayoutEffect(() => {
    const desiredKey = viewerVisible ? mediaKey : null;
    if (viewerOwnerRef.current.key === desiredKey) {
      if (
        viewerOwner.key !== viewerOwnerRef.current.key
        || viewerOwner.lifetime !== viewerOwnerRef.current.lifetime
      ) setViewerOwner(viewerOwnerRef.current);
      return;
    }
    const owner = { key: desiredKey, lifetime: ++viewerLifetimeRef.current };
    viewerOwnerRef.current = owner;
    setViewerOwner(owner);
    if (desiredKey) setViewerMedia({ ...owner, status: 'loading' });
  }, [mediaKey, viewerOwner.key, viewerOwner.lifetime, viewerVisible]);
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
    setViewerOpen(false);
    setFailedMedia(new Set());
  }, [scopeKey]);
  React.useEffect(() => {
    if (reduceMotion || viewerVisible || selection.slides.length <= 1) return undefined;
    const intervalScope = selection.scopeKey;
    const generation = ++autoplayGenerationRef.current;
    const timer = setInterval(() => {
      if (
        autoplayGenerationRef.current !== generation
        || viewerOpenRef.current
        || reduceMotionRef.current
        || activeScopeRef.current !== intervalScope
      ) return;
      setSelection((current) => (
        autoplayGenerationRef.current !== generation
        || viewerOpenRef.current
        || reduceMotionRef.current
        || activeScopeRef.current !== intervalScope
        || current.scopeKey !== intervalScope
        || current.slides.length <= 1
      ) ? current : {
        ...current,
        index: (current.index + 1) % current.slides.length,
      });
    }, 5500);
    return () => {
      if (autoplayGenerationRef.current === generation) autoplayGenerationRef.current += 1;
      clearInterval(timer);
    };
  }, [reduceMotion, selection.scopeKey, selection.slides.length, viewerVisible]);
  const cardOwnerActive = cardOwner.key === mediaKey
    && cardOwnerRef.current.key === cardOwner.key
    && cardOwnerRef.current.lifetime === cardOwner.lifetime;
  const viewerOwnerActive = viewerVisible
    && viewerOwner.key === mediaKey
    && viewerOwnerRef.current.key === viewerOwner.key
    && viewerOwnerRef.current.lifetime === viewerOwner.lifetime;
  if (!photo && !album) return null;
  const caption = cleanHomePhotoCaption(photo?.caption);
  const imageLabel = caption ?? album?.title ?? 'League photo';
  const mediaUnavailable = !imageUrl || failedMedia.has(mediaKey!);
  const viewerStatus = viewerOwnerActive
    && viewerMedia.key === viewerOwner.key
    && viewerMedia.lifetime === viewerOwner.lifetime
    ? viewerMedia.status
    : 'loading';
  const destinationLabel = photo
    ? `Open league photo ${selection.index + 1} of ${selection.slides.length} viewer${caption ? `: ${caption}` : ''}`
    : `Open ${album!.title} photo viewer`;
  const cardAccessibilityLabel = mediaUnavailable
    ? `Photo unavailable${imageLabel ? `: ${imageLabel}` : ''}`
    : destinationLabel;

  const selectAdjacent = (delta: number) => {
    if (selection.slides.length <= 1) return;
    const retiredCardOwner = { key: null, lifetime: ++cardLifetimeRef.current };
    cardOwnerRef.current = retiredCardOwner;
    setCardOwner(retiredCardOwner);
    if (viewerOpenRef.current) {
      const retiredViewerOwner = { key: null, lifetime: ++viewerLifetimeRef.current };
      viewerOwnerRef.current = retiredViewerOwner;
      setViewerOwner(retiredViewerOwner);
    }
    setSelection((current) => current.slides.length <= 1 ? current : {
      ...current,
      index: (current.index + delta + current.slides.length) % current.slides.length,
    });
  };
  const isCurrentCardOwner = (owner: MediaOwner) => owner.key !== null
    && cardOwnerRef.current.key === owner.key
    && cardOwnerRef.current.lifetime === owner.lifetime;
  const isCurrentViewerOwner = (owner: MediaOwner) => owner.key !== null
    && viewerOpenRef.current
    && viewerOwnerRef.current.key === owner.key
    && viewerOwnerRef.current.lifetime === owner.lifetime;
  const markCardFailed = (owner: MediaOwner) => {
    if (!isCurrentCardOwner(owner)) return;
    setFailedMedia((current) => isCurrentCardOwner(owner) ? new Set(current).add(owner.key!) : current);
  };
  const openViewer = () => {
    if (!mediaKey || mediaUnavailable) return;
    viewerOpenRef.current = true;
    autoplayGenerationRef.current += 1;
    const owner = { key: mediaKey, lifetime: ++viewerLifetimeRef.current };
    viewerOwnerRef.current = owner;
    setViewerOwner(owner);
    setViewerMedia({ ...owner, status: 'loading' });
    setViewerOpen(true);
  };
  const closeViewer = () => {
    viewerOpenRef.current = false;
    autoplayGenerationRef.current += 1;
    const owner = { key: null, lifetime: ++viewerLifetimeRef.current };
    viewerOwnerRef.current = owner;
    setViewerOwner(owner);
    setViewerOpen(false);
  };
  const settleViewerLoaded = (owner: MediaOwner) => {
    if (!isCurrentViewerOwner(owner)) return;
    setViewerMedia((current) => {
      if (!isCurrentViewerOwner(owner)) return current;
      if (current.key === owner.key && current.lifetime === owner.lifetime && current.status === 'error') return current;
      return { ...owner, status: 'loaded' };
    });
  };
  const markViewerFailed = (owner: MediaOwner) => {
    if (!isCurrentViewerOwner(owner)) return;
    setViewerMedia((current) => isCurrentViewerOwner(owner) ? { ...owner, status: 'error' } : current);
    setFailedMedia((current) => isCurrentViewerOwner(owner) ? new Set(current).add(owner.key!) : current);
  };

  return <>
    <View>
      <Pressable
        testID="home-photo-card"
        accessibilityRole="button"
        accessibilityLabel={cardAccessibilityLabel}
        accessibilityState={{ disabled: mediaUnavailable }}
        disabled={mediaUnavailable}
        style={[styles.card, reduceTransparency && styles.cardOpaque]}
        onPress={mediaUnavailable ? undefined : openViewer}
      >
        {mediaUnavailable ? (
          <View testID="home-photo-media-unavailable" accessible={false} style={styles.mediaUnavailable}>
            <Ionicons name="image-outline" size={30} color={colors.textSecondary} />
            <Text style={styles.mediaUnavailableText}>Photo unavailable</Text>
          </View>
        ) : cardOwnerActive ? <Image
          key={`${cardOwner.key}:${cardOwner.lifetime}`}
          source={{ uri: imageUrl! }}
          style={styles.image}
          resizeMode="cover"
          alt={imageLabel}
          onError={() => markCardFailed(cardOwner)}
        /> : null}
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
    <Modal visible={viewerVisible} transparent statusBarTranslucent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={closeViewer}>
      <View style={[styles.viewer, reduceTransparency && styles.viewerOpaque]} accessibilityViewIsModal accessibilityLabel="Home photo viewer" onAccessibilityEscape={closeViewer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close photo viewer"
          onPress={closeViewer}
          style={[
            styles.close,
            { top: insets.top + 8, right: insets.right + 14 },
            reduceTransparency && styles.closeOpaque,
          ]}
        >
          <Ionicons name="close" size={26} color="#FFFFFF" />
        </Pressable>
        {viewerStatus === 'loading' && !mediaUnavailable ? <ActivityIndicator color="#FFFFFF" style={StyleSheet.absoluteFill} /> : null}
        {mediaUnavailable || viewerStatus === 'error' ? (
          <View testID="home-photo-viewer-unavailable" style={styles.viewerUnavailable}>
            <Ionicons name="image-outline" size={64} color="#FFFFFF" />
            <Text style={styles.viewerUnavailableText}>Photo unavailable</Text>
          </View>
        ) : viewerOwnerActive ? <Image
          key={`${viewerOwner.key}:${viewerOwner.lifetime}`}
          source={{ uri: imageUrl! }}
          resizeMode="contain"
          style={StyleSheet.absoluteFill}
          alt={imageLabel}
          accessibilityLabel={imageLabel}
          onLoad={() => settleViewerLoaded(viewerOwner)}
          onLoadEnd={() => settleViewerLoaded(viewerOwner)}
          onError={() => markViewerFailed(viewerOwner)}
        /> : null}
        {selection.slides.length > 1 ? <View style={[
          styles.viewerFooter,
          {
            bottom: insets.bottom + 10,
            left: insets.left + 58,
            right: insets.right + 58,
          },
          reduceTransparency && styles.viewerFooterOpaque,
        ]}>
          <CarouselPager
            currentIndex={selection.index}
            pageCount={selection.slides.length}
            onPrevious={() => selectAdjacent(-1)}
            onNext={() => selectAdjacent(1)}
            previousLabel="Previous photo in viewer"
            nextLabel="Next photo in viewer"
            positionLabel="Home photo viewer position"
            loop
            testID="home-photo-viewer"
          />
        </View> : null}
      </View>
    </Modal>
  </>;
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
  viewer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.96)' },
  viewerOpaque: { backgroundColor: '#000000' },
  close: { position: 'absolute', zIndex: 4, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(38,38,38,0.96)' },
  closeOpaque: { backgroundColor: '#262626' },
  viewerUnavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  viewerUnavailableText: { color: '#FFFFFF', fontSize: 15, lineHeight: 21, fontWeight: '700' },
  viewerFooter: { position: 'absolute', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: 'rgba(0,0,0,0.82)' },
  viewerFooterOpaque: { backgroundColor: '#000000' },
});
