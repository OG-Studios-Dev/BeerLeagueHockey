import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import colors from '../theme/colors';

export default function NewsArticleHeader({
  title,
  publishedAt,
  authorName,
  shareUrl,
  onShare,
}: {
  title: string;
  publishedAt: string;
  authorName?: string | null;
  shareUrl?: string | null;
  onShare(): void;
}) {
  const { fontScale, width } = useWindowDimensions();
  const stackActions = width <= 430 && fontScale >= 1.2;

  return <View testID="article-newspaper-header" style={[styles.articleHeader, stackActions ? styles.articleHeaderStacked : null]}>
    <View testID="article-title-block" style={styles.articleTitleBlock}>
      <Text testID="article-title" accessibilityRole="header" style={styles.title}>{title}</Text>
      <Text style={styles.meta}>{new Date(publishedAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}{authorName ? ` · ${authorName}` : ''}</Text>
    </View>
    {shareUrl ? <Pressable accessibilityRole="button" accessibilityLabel="Share article" onPress={onShare} style={[styles.shareButton, stackActions ? styles.shareButtonStacked : null]}>
      <Ionicons name="share-outline" size={20} color={colors.textOnPrimary} accessible={false} accessibilityElementsHidden />
      <Text style={styles.shareButtonText}>Share</Text>
    </Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  articleHeader: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 14 },
  articleHeaderStacked: { flexDirection: 'column' },
  articleTitleBlock: { flex: 1, minWidth: 0, width: '100%' },
  title: { color: colors.textPrimary, fontSize: 30, lineHeight: 37, fontWeight: '900' },
  meta: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6 },
  shareButton: { minWidth: 96, minHeight: 44, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 10, backgroundColor: colors.buttonDefault, paddingHorizontal: 13, paddingVertical: 10 },
  shareButtonStacked: { alignSelf: 'flex-end' },
  shareButtonText: { color: colors.textOnPrimary, fontSize: 15, lineHeight: 20, fontWeight: '900' },
});
