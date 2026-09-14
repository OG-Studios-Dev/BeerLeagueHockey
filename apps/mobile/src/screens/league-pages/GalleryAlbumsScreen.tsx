/* eslint-disable jsx-a11y/alt-text */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { FocusCard } from '../../components/CardFocus';
import { groupAlbums } from '../../lib/leagueContentModel';
import type { LeaguePagesStackParamList } from '../../navigation/types';
import colors from '../../theme/colors';
import { commonStyles, LeaguePageFrame, PageHeader, PageLoadState, useLeaguePageScope } from './LeaguePageCommon';
import { useLeagueContent } from './ContentPageCommon';

type Props = NativeStackScreenProps<LeaguePagesStackParamList, 'GalleryAlbums'>;

export default function GalleryAlbumsScreen({ route, navigation }: Props) {
  const scope = useLeaguePageScope(route.params); const page = useLeagueContent(scope, { view: 'gallery' });
  if (!page.data) return <LeaguePageFrame><PageLoadState loading={page.loading} error={page.error} noSeason={false} retry={page.retry} /></LeaguePageFrame>;
  const groups = groupAlbums(page.data.albums, page.data.seasons);
  return <LeaguePageFrame><PageHeader eyebrow="Through the lens" title="Photo Gallery" detail={`${page.data.total} published album${page.data.total === 1 ? '' : 's'} from ${page.data.league.name}`} />
    {groups.length === 0 ? <View style={styles.empty}><Ionicons name="images-outline" size={58} color={colors.textInteractive} /><Text style={styles.emptyTitle}>No Photo Albums</Text><Text style={styles.meta}>Check back later for photos from the league.</Text></View> : groups.map(group => <View key={group.key} style={commonStyles.section}><Text style={commonStyles.sectionTitle}>{group.label}</Text>{group.albums.map(album => (
      <FocusCard key={album.id} focusId={`gallery-album:${album.id}`}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${album.title}, ${album.photoCount} photos`} onPress={() => navigation.navigate('GalleryAlbum', { ...scope, albumId: album.id })} style={styles.card}>{album.coverUrl ? <Image source={{ uri: album.coverUrl }} resizeMode="cover" style={styles.cover} accessibilityLabel={album.title} /> : <View style={styles.fallback}><Ionicons name="images" size={48} color={colors.textInteractive} /></View>}<View style={styles.badge}><Text style={styles.badgeText}>{album.photoCount} photo{album.photoCount === 1 ? '' : 's'}</Text></View><View style={styles.copy}><Text style={styles.title}>{album.title}</Text>{album.description ? <Text style={styles.meta}>{album.description}</Text> : null}</View></Pressable>
      </FocusCard>
    ))}</View>)}
  </LeaguePageFrame>;
}
const styles = StyleSheet.create({ card: { overflow: 'hidden', borderRadius: 22, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, marginBottom: 14 }, cover: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.bgElevated }, fallback: { width: '100%', aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B2238' }, badge: { position: 'absolute', top: 12, right: 12, borderRadius: 16, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: 'rgba(0,0,0,0.75)' }, badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' }, copy: { padding: 15 }, title: { color: colors.textPrimary, fontSize: 19, lineHeight: 24, fontWeight: '900' }, meta: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 }, empty: { minHeight: 260, alignItems: 'center', justifyContent: 'center', padding: 24 }, emptyTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '900', marginTop: 12 } });
