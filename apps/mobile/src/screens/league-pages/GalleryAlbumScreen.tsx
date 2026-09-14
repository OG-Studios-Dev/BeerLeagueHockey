/* eslint-disable jsx-a11y/alt-text */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ImageStyle, type StyleProp } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAccessibilityPreferences } from '../../context/AccessibilityPreferencesContext';
import type { GalleryPhoto } from '../../lib/leagueContent';
import type { LeaguePagesStackParamList } from '../../navigation/types';
import colors from '../../theme/colors';
import { LeaguePageFrame, PageLoadState, useLeaguePageScope } from './LeaguePageCommon';
import { useLeagueContent } from './ContentPageCommon';

type Props = NativeStackScreenProps<LeaguePagesStackParamList, 'GalleryAlbum'>;
const INITIAL_PHOTOS = 8;

function Thumbnail({ photo, label, style }: { photo: GalleryPhoto; label: string; style: StyleProp<ImageStyle> }) {
  const sourceUrl = photo.thumbnailUrl ?? photo.imageUrl;
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [photo.id, sourceUrl]);
  return failed ? (
    <View style={[style, styles.broken]} accessibilityLabel={`${label}, image unavailable`}>
      <Ionicons name="image-outline" size={34} color={colors.textSecondary} />
      <Text style={styles.brokenText}>Image unavailable</Text>
    </View>
  ) : (
    <Image source={{ uri: sourceUrl }} resizeMode="cover" style={style} accessibilityLabel={label} onError={() => setFailed(true)} />
  );
}

export default function GalleryAlbumScreen({ route, navigation }: Props) {
  const scope = useLeaguePageScope(route.params);
  const page = useLeagueContent(scope, { view: 'album', albumId: route.params.albumId });
  const [selected, setSelected] = React.useState<number | null>(null);
  const [fullStatus, setFullStatus] = React.useState<'loading' | 'loaded' | 'error'>('loading');
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { reduceMotion, reduceTransparency } = useAccessibilityPreferences();

  React.useEffect(() => {
    setSelected(null);
    setFullStatus('loading');
  }, [scope.leagueId, route.params.albumId]);

  const photo = selected === null ? null : page.data?.photos[selected] ?? null;
  React.useEffect(() => setFullStatus('loading'), [photo?.id, photo?.imageUrl]);

  if (!page.data) return <LeaguePageFrame><PageLoadState loading={page.loading} error={page.error} noSeason={false} retry={page.retry} /></LeaguePageFrame>;

  const data = page.data;
  const itemWidth = Math.max(0, (width - 40) / 2);
  const move = (delta: number) => {
    if (!data.photos.length || selected === null) return;
    setSelected((selected + delta + data.photos.length) % data.photos.length);
  };
  const close = () => setSelected(null);
  const header = (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.back}><Text style={styles.link}>← Back to Gallery</Text></Pressable>
      <Text accessibilityRole="header" style={styles.title}>{data.album.title}</Text>
      {data.album.description ? <Text style={styles.description}>{data.album.description}</Text> : null}
      <Text style={styles.meta}>{data.total} photo{data.total === 1 ? '' : 's'}</Text>
    </View>
  );

  return <>
    <LeaguePageFrame scrollable={false}>
      <FlatList
        testID="gallery-grid"
        data={data.photos}
        keyExtractor={item => item.id}
        numColumns={2}
        initialNumToRender={INITIAL_PHOTOS}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.row}
        ListHeaderComponent={header}
        ListEmptyComponent={<View style={styles.empty}><Ionicons name="images-outline" size={54} color={colors.textInteractive} /><Text style={styles.description}>No photos in this album yet.</Text></View>}
        renderItem={({ item, index }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.caption ?? 'Photo'}; Open photo ${index + 1} of ${data.total}`}
            onPress={() => setSelected(index)}
            style={[styles.thumbButton, { width: itemWidth }]}
          >
            <Thumbnail photo={item} label={item.caption ?? `Photo ${index + 1}`} style={styles.thumb} />
            {item.caption ? <Text numberOfLines={2} style={styles.caption}>{item.caption}</Text> : null}
          </Pressable>
        )}
      />
    </LeaguePageFrame>
    <Modal visible={photo !== null} transparent statusBarTranslucent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={close}>
      <View style={[styles.viewer, reduceTransparency && styles.viewerOpaque]} accessibilityViewIsModal accessibilityLabel="Photo viewer">
        <Pressable accessibilityRole="button" accessibilityLabel="Close photo viewer" onPress={close} style={[styles.close, { top: insets.top + 8 }]}><Ionicons name="close" size={26} color="#FFFFFF" /></Pressable>
        {photo ? <>
          <View style={[styles.fullWrap, { width, height: Math.max(200, height - insets.top - insets.bottom - 150) }]}>
            {fullStatus === 'loading' ? <ActivityIndicator color="#FFFFFF" style={StyleSheet.absoluteFill} /> : null}
            {fullStatus === 'error' ? <View style={styles.fullBroken}><Ionicons name="image-outline" size={64} color="#FFFFFF" /><Text style={styles.viewerText}>Image unavailable</Text></View> : <Image key={`${photo.id}:${photo.imageUrl}`} source={{ uri: photo.imageUrl }} resizeMode="contain" style={StyleSheet.absoluteFill} accessibilityLabel={photo.caption ?? `Photo ${selected! + 1}`} onLoad={() => setFullStatus('loaded')} onLoadEnd={() => setFullStatus(status => status === 'error' ? status : 'loaded')} onError={() => setFullStatus('error')} />}
          </View>
          {data.photos.length > 1 ? <>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous photo" onPress={() => move(-1)} style={[styles.nav, styles.prev]}><Ionicons name="chevron-back" size={30} color="#FFFFFF" /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next photo" onPress={() => move(1)} style={[styles.nav, styles.next]}><Ionicons name="chevron-forward" size={30} color="#FFFFFF" /></Pressable>
          </> : null}
          <View style={[styles.viewerFooter, { bottom: insets.bottom + 10, maxHeight: Math.max(84, height * 0.28) }]}>
            {photo.caption ? <ScrollView showsVerticalScrollIndicator contentContainerStyle={styles.footerScroll}><Text style={styles.viewerText}>{photo.caption}</Text></ScrollView> : null}
            <Text style={styles.counter}>{selected! + 1} of {data.total}</Text>
          </View>
        </> : null}
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 136 },
  row: { gap: 8 },
  header: { marginBottom: 22 },
  back: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
  link: { color: colors.textInteractive, fontWeight: '900' },
  title: { color: colors.textPrimary, fontSize: 30, lineHeight: 37, fontWeight: '900', marginTop: 9 },
  description: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 6 },
  meta: { color: colors.textSecondary, fontSize: 13, marginTop: 8 },
  thumbButton: { minHeight: 154, marginBottom: 8, overflow: 'hidden', borderRadius: 14, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface },
  thumb: { width: '100%', aspectRatio: 1 },
  caption: { color: colors.textSecondary, fontSize: 12, lineHeight: 16, padding: 8 },
  broken: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgElevated },
  brokenText: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  empty: { minHeight: 240, alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.96)' },
  viewerOpaque: { backgroundColor: '#000000' },
  close: { position: 'absolute', zIndex: 4, right: 14, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(38,38,38,0.96)' },
  fullWrap: { alignSelf: 'center' },
  fullBroken: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  nav: { position: 'absolute', zIndex: 4, top: '46%', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(38,38,38,0.96)' },
  prev: { left: 10 },
  next: { right: 10 },
  viewerFooter: { position: 'absolute', left: 58, right: 58, alignItems: 'stretch', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: 'rgba(0,0,0,0.82)' },
  footerScroll: { paddingBottom: 2 },
  viewerText: { color: '#FFFFFF', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  counter: { color: 'rgba(255,255,255,0.78)', fontSize: 13, marginTop: 5, textAlign: 'center' },
});
