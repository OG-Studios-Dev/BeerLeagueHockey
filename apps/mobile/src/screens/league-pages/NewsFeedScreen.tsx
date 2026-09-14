import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { categoryCount, filterArticles, type NewsCategory } from '../../lib/leagueContentModel';
import type { LeaguePagesStackParamList } from '../../navigation/types';
import colors from '../../theme/colors';
import { LeaguePageFrame, PageHeader, PageLoadState, useLeaguePageScope } from './LeaguePageCommon';
import { useLeagueContent } from './ContentPageCommon';

type Props = NativeStackScreenProps<LeaguePagesStackParamList, 'NewsFeed'>;
const categories: NewsCategory[] = ['All', 'Recaps', 'News'];

export default function NewsFeedScreen({ route, navigation }: Props) {
  const scope = useLeaguePageScope(route.params);
  const page = useLeagueContent(scope, { view: 'news' });
  const [category, setCategory] = React.useState<NewsCategory>('All');
  React.useEffect(() => setCategory('All'), [scope.leagueId]);
  if (!page.data) return <LeaguePageFrame><PageLoadState loading={page.loading} error={page.error} noSeason={false} retry={page.retry} /></LeaguePageFrame>;
  const data = page.data;
  const articles = filterArticles(data.articles, category);
  const header = <><PageHeader eyebrow="From around the rink" title="League News" detail={`${page.data.total} published stor${page.data.total === 1 ? 'y' : 'ies'} from ${page.data.league.name}`} />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
      {categories.map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: item === category }} onPress={() => setCategory(item)} style={[styles.pill, item === category && styles.pillSelected]}><Text style={[styles.pillText, item === category && styles.pillTextSelected]}>{item} {categoryCount(data.articles, item)}</Text></Pressable>)}
    </ScrollView></>;
  return (
    <LeaguePageFrame scrollable={false}>
      <FlatList
        testID="news-feed-list"
        data={articles}
        keyExtractor={article => article.id}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={5}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={header}
        ListEmptyComponent={<View style={styles.empty}><Ionicons name="newspaper-outline" size={54} color={colors.textInteractive} /><Text style={styles.emptyTitle}>No published stories</Text><Text style={styles.meta}>Check back after the next trip around the rink.</Text></View>}
        renderItem={({ item: article }) => <Pressable accessibilityRole="button" accessibilityLabel={`${article.title}, Read story`} onPress={() => navigation.navigate('NewsArticle', { ...scope, articleSlug: article.slug })} style={styles.card}>
          {article.imageUrl ? <Image source={{ uri: article.imageUrl }} resizeMode="cover" style={styles.image} accessibilityLabel={article.title} alt={article.title} /> : <View style={styles.fallback}><Ionicons name="newspaper" size={42} color={colors.textInteractive} /><Text style={styles.fallbackMark}>{data.league.name}</Text></View>}
          <View style={styles.copy}>
            <Text style={styles.type}>{article.type === 'news' ? 'News' : 'Game Recap'}</Text>
            <Text style={styles.title}>{article.title}</Text>
            <Text style={styles.meta}>{new Date(article.publishedAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}{article.authorName ? ` · ${article.authorName}` : ''}</Text>
            {article.excerpt ? <Text style={styles.excerpt}>{article.excerpt}</Text> : null}
            <Text style={styles.read}>Read Story →</Text>
          </View>
        </Pressable>}
      />
    </LeaguePageFrame>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 }, listContent: { paddingHorizontal: 16, paddingBottom: 136 },
  pills: { gap: 8, paddingVertical: 18 }, pill: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgInteractive }, pillSelected: { backgroundColor: colors.primary, borderColor: colors.primary }, pillText: { color: colors.textSecondary, fontWeight: '800' }, pillTextSelected: { color: colors.textOnPrimary },
  card: { overflow: 'hidden', borderRadius: 22, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface, marginBottom: 16 }, image: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.bgElevated }, fallback: { width: '100%', aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#0B2238' }, fallbackMark: { color: colors.textPrimary, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase', textAlign: 'center', paddingHorizontal: 12 }, copy: { padding: 16 }, type: { color: colors.textInteractive, fontSize: 11, fontWeight: '900', letterSpacing: 1.3, textTransform: 'uppercase' }, title: { color: colors.textPrimary, fontSize: 21, lineHeight: 27, fontWeight: '900', marginTop: 5 }, meta: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6 }, excerpt: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 10 }, read: { color: colors.textInteractive, fontWeight: '900', marginTop: 13 }, empty: { minHeight: 260, alignItems: 'center', justifyContent: 'center', padding: 24 }, emptyTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '900', marginTop: 12 },
});
