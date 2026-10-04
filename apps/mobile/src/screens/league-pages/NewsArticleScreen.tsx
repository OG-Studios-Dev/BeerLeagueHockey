import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { FocusCard } from '../../components/CardFocus';
import NativeNewspaperEdition from '../../components/NativeNewspaperEdition';
import TeamLogo from '../../components/TeamLogo';
import { classifyArticleHref, parseArticleBlocks, parseInlineMarkdown, publicArticleUrl } from '../../lib/leagueContentModel';
import { loadPublishedNewspaperEdition, type PublishedEditionResult } from '../../lib/newspaperReader';
import { useMobileShellData } from '../../navigation/MobileShellDataContext';
import { returnFromNewsArticle } from '../../navigation/newsArticleBack';
import type { LeaguePagesStackParamList } from '../../navigation/types';
import colors from '../../theme/colors';
import { commonStyles, LeaguePageFrame, PageLoadState, useLeaguePageScope } from './LeaguePageCommon';
import { useLeagueContent } from './ContentPageCommon';

type Props = NativeStackScreenProps<LeaguePagesStackParamList, 'NewsArticle'>;
type ReaderState = PublishedEditionResult & { key: string };

export default function NewsArticleScreen({ route, navigation }: Props) {
  const scope = useLeaguePageScope(route.params);
  const page = useLeagueContent(scope, { view: 'article', articleSlug: route.params.articleSlug });
  const { focusAccent } = useMobileShellData();
  const article = page.data?.article;
  const articleId = article?.id;
  const articleSlug = article?.slug;
  const readerKey = articleId && articleSlug ? `${scope.leagueId}:${articleId}:${articleSlug}` : '';
  const currentKeyRef = React.useRef(readerKey);
  const generationRef = React.useRef(0);
  const shareInFlightRef = React.useRef<string | null>(null);
  const [retryKey, setRetryKey] = React.useState(0);
  const [showTextFallback, setShowTextFallback] = React.useState(false);
  const [reader, setReader] = React.useState<ReaderState | { key: string; status: 'loading' } | null>(null);

  React.useEffect(() => {
    if (!articleId || !articleSlug) return;
    const generation = ++generationRef.current;
    currentKeyRef.current = readerKey;
    setShowTextFallback(false);
    setReader({ key: readerKey, status: 'loading' });
    const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
    void loadPublishedNewspaperEdition({ articleId, articleSlug, leagueId: scope.leagueId, leagueSlug: scope.leagueSlug }, undefined, { signal: controller?.signal }).then((result) => {
      if (generationRef.current === generation && currentKeyRef.current === readerKey) setReader({ key: readerKey, ...result });
    });
    return () => { controller?.abort(); generationRef.current += 1; currentKeyRef.current = ''; };
  }, [articleId, articleSlug, readerKey, retryKey, scope.leagueId, scope.leagueSlug]);

  React.useEffect(() => () => { generationRef.current += 1; }, []);

  React.useEffect(() => {
    shareInFlightRef.current = null;
    return () => { shareInFlightRef.current = null; };
  }, [readerKey]);

  const open = (href: string) => {
    const target = classifyArticleHref(href, scope.leagueSlug); if (!target) return;
    if (target.kind === 'external') { void Linking.openURL(target.url).catch(() => {}); return; }
    if (target.kind === 'player') navigation.navigate('LeaguePlayerCard', { playerId: target.id, leagueId: scope.leagueId });
    else if (target.kind === 'team') navigation.navigate('LeagueTeamDetail', { teamId: target.id, leagueId: scope.leagueId });
    else if (target.kind === 'game') navigation.navigate('LeagueGamePreview', { gameId: target.id });
    else if (target.kind === 'article') navigation.push('NewsArticle', { ...scope, articleSlug: target.slug });
  };
  const returnToArticleOrigin = React.useCallback(() => returnFromNewsArticle(navigation), [navigation]);
  if (!page.data || !article) return <LeaguePageFrame onAccessibilityEscape={returnToArticleOrigin}><PageLoadState loading={page.loading} error={page.error} noSeason={false} retry={page.retry} /></LeaguePageFrame>;

  const currentReader = reader?.key === readerKey ? reader : null;
  const showArticleBody = currentReader?.status === 'unavailable' || (currentReader?.status === 'error' && showTextFallback);
  const shareUrl = publicArticleUrl(scope.leagueSlug, article.slug);
  const shareArticle = async () => {
    if (!shareUrl || shareInFlightRef.current) return;
    const shareKey = `${readerKey}:${shareUrl}`;
    shareInFlightRef.current = shareKey;
    try {
      await Share.share(Platform.OS === 'ios'
        ? { title: article.title, url: shareUrl }
        : { title: article.title, message: `${article.title}\n${shareUrl}` });
    } catch {
      // Native share rejection, error, and dismissal do not need app-level feedback.
    } finally {
      if (shareInFlightRef.current === shareKey) shareInFlightRef.current = null;
    }
  };
  return <LeaguePageFrame onAccessibilityEscape={returnToArticleOrigin}>
    {article.imageUrl && currentReader?.status !== 'ready' ? <Image source={{ uri: article.imageUrl }} resizeMode="cover" style={styles.hero} accessibilityLabel={article.title} alt={article.title} /> : null}
    {currentReader?.status !== 'ready' ? <><Text accessibilityRole="header" style={styles.title}>{article.title}</Text><Text style={styles.meta}>{new Date(article.publishedAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}{article.authorName ? ` · ${article.authorName}` : ''}</Text></> : null}
    {shareUrl ? <View style={styles.shareToolbar}><Pressable accessibilityRole="button" accessibilityLabel="Share article" onPress={shareArticle} style={[commonStyles.secondaryButton, styles.shareButton]}><Text style={commonStyles.secondaryButtonText}>Share</Text></Pressable></View> : null}
    {currentReader?.status === 'loading' || !currentReader ? <View testID="newspaper-loading" style={styles.readerState}><ActivityIndicator color={focusAccent} /><Text style={styles.readerCopy}>Checking for the published Hockey Life Times edition…</Text></View> : null}
    {currentReader?.status === 'error' ? <View testID="newspaper-error" accessibilityRole="alert" style={styles.readerState}><Text style={styles.readerTitle}>Couldn’t load the published edition</Text><Text style={styles.readerCopy}>{currentReader.message}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry newspaper edition" onPress={() => setRetryKey((value) => value + 1)} style={[commonStyles.secondaryButton, { borderColor: focusAccent }]}><Text style={commonStyles.secondaryButtonText}>Retry edition</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Read article text instead" onPress={() => setShowTextFallback(true)} style={commonStyles.secondaryButton}><Text style={commonStyles.secondaryButtonText}>Read article text instead</Text></Pressable></View> : null}
    {currentReader?.status === 'ready' ? <NativeNewspaperEdition edition={currentReader.edition} accentColor={focusAccent} /> : null}
    {showArticleBody ? <><Text style={styles.fallbackLabel}>{currentReader?.status === 'error' ? 'ARTICLE TEXT FALLBACK' : 'ARTICLE'}</Text><FocusCard focusId={`news-article:${route.params.articleSlug}:body`} accentColor={focusAccent} style={styles.body}>{parseArticleBlocks(article.content).map((block, index) => <Text key={`${index}:${block.text.slice(0, 12)}`} style={block.kind === 'heading' ? styles.bodyHeading : block.kind === 'bullet' ? styles.bullet : styles.paragraph}>{block.kind === 'bullet' ? '• ' : ''}{parseInlineMarkdown(block.text).map((token, tokenIndex) => token.href ? <Text key={tokenIndex} accessibilityRole="link" onPress={() => open(token.href!)} style={styles.link}>{token.text}</Text> : <Text key={tokenIndex} style={token.strong ? styles.strong : undefined}>{token.text}</Text>)}</Text>)}</FocusCard></> : null}
    {article.relatedGame ? <FocusCard focusId={`news-article:game:${article.relatedGame.id ?? article.relatedGame.homeTeamName}`} accentColor={focusAccent} style={[commonStyles.section, commonStyles.card]}><Text style={commonStyles.sectionTitle}>Related Game</Text><View style={styles.game}><TeamLogo teamId={article.relatedGame.homeTeamId ?? ''} logoUrl={article.relatedGame.homeTeamLogoUrl} teamName={article.relatedGame.homeTeamName} size={40} /><Text style={styles.gameName}>{article.relatedGame.homeTeamName}{article.relatedGame.homeScore === null ? '' : ` ${article.relatedGame.homeScore}`}</Text><Text style={styles.meta}>vs</Text><Text style={styles.gameName}>{article.relatedGame.awayScore === null ? '' : `${article.relatedGame.awayScore} `}{article.relatedGame.awayTeamName}</Text></View>{article.relatedGame.id ? <Pressable accessibilityRole="button" onPress={() => navigation.navigate('LeagueGamePreview', { gameId: article.relatedGame!.id! })} style={commonStyles.secondaryButton}><Text style={commonStyles.secondaryButtonText}>View Game</Text></Pressable> : null}</FocusCard> : null}
  </LeaguePageFrame>;
}

const styles = StyleSheet.create({ hero: { width: '100%', aspectRatio: 16 / 9, borderRadius: 22, backgroundColor: colors.bgElevated }, title: { color: colors.textPrimary, fontSize: 30, lineHeight: 37, fontWeight: '900', marginTop: 18 }, meta: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6 }, shareToolbar: { minHeight: 44, marginTop: 12, alignItems: 'flex-end', justifyContent: 'center' }, shareButton: { minWidth: 92, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, readerState: { gap: 10, marginTop: 18, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface }, readerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '900' }, readerCopy: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 }, fallbackLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginTop: 20 }, body: { marginTop: 8 }, bodyHeading: { color: colors.textPrimary, fontSize: 21, lineHeight: 27, fontWeight: '900', marginTop: 9, marginBottom: 10 }, paragraph: { color: colors.textPrimary, fontSize: 17, lineHeight: 27, marginBottom: 17 }, bullet: { color: colors.textPrimary, fontSize: 16, lineHeight: 25, marginBottom: 7, paddingLeft: 8 }, strong: { fontWeight: '900' }, link: { color: colors.textInteractive, fontWeight: '800' }, game: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }, gameName: { flex: 1, color: colors.textPrimary, fontWeight: '800' } });
