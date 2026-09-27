import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { FocusCard } from '../../components/CardFocus';
import Avatar from '../../components/Avatar';
import TeamLogo from '../../components/TeamLogo';
import { classifyArticleHref, parseArticleBlocks, parseInlineMarkdown } from '../../lib/leagueContentModel';
import { loadPublishedNewspaperReaderTarget, openNewspaperReader, type NewspaperReaderTarget } from '../../lib/newspaperReader';
import type { LeaguePagesStackParamList } from '../../navigation/types';
import colors from '../../theme/colors';
import { commonStyles, LeaguePageFrame, PageLoadState, useLeaguePageScope } from './LeaguePageCommon';
import { useLeagueContent } from './ContentPageCommon';

type Props = NativeStackScreenProps<LeaguePagesStackParamList, 'NewsArticle'>;

export default function NewsArticleScreen({ route, navigation }: Props) {
  const scope = useLeaguePageScope(route.params);
  const page = useLeagueContent(scope, { view: 'article', articleSlug: route.params.articleSlug });
  const article = page.data?.article;
  const articleId = article?.id;
  const articleSlug = article?.slug;
  const readerKey = articleId && articleSlug ? `${scope.leagueId}:${articleId}:${articleSlug}` : '';
  const [reader, setReader] = React.useState<{ key: string; checking: boolean; opening: boolean; target: NewspaperReaderTarget | null; error: string | null } | null>(null);
  const [routeFocused, setRouteFocused] = React.useState(() => navigation.isFocused());
  const mountedRef = React.useRef(true);
  const focusedRef = React.useRef(routeFocused);
  const routeKeyRef = React.useRef(readerKey);
  const operationGenerationRef = React.useRef(0);
  const activeOpenRef = React.useRef<{ key: string; generation: number } | null>(null);
  routeKeyRef.current = readerKey;
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationGenerationRef.current += 1;
      activeOpenRef.current = null;
    };
  }, []);
  React.useEffect(() => {
    const setFocused = (focused: boolean) => {
      focusedRef.current = focused;
      operationGenerationRef.current += 1;
      activeOpenRef.current = null;
      setRouteFocused(focused);
    };
    const removeFocusListener = navigation.addListener('focus', () => setFocused(true));
    const removeBlurListener = navigation.addListener('blur', () => setFocused(false));
    setFocused(navigation.isFocused());
    return () => {
      removeFocusListener();
      removeBlurListener();
    };
  }, [navigation]);
  const openReader = React.useCallback(async (target: NewspaperReaderTarget, key: string) => {
    if (!mountedRef.current || !focusedRef.current || !navigation.isFocused() || routeKeyRef.current !== key || activeOpenRef.current?.key === key) return;
    const operation = { key, generation: ++operationGenerationRef.current };
    activeOpenRef.current = operation;
    setReader(value => value?.key === key ? { ...value, opening: true, error: null } : value);
    try {
      if (!mountedRef.current || !focusedRef.current || !navigation.isFocused() || routeKeyRef.current !== key || activeOpenRef.current !== operation || operationGenerationRef.current !== operation.generation) return;
      await openNewspaperReader(target);
      if (!mountedRef.current || !focusedRef.current || !navigation.isFocused() || routeKeyRef.current !== key || activeOpenRef.current !== operation || operationGenerationRef.current !== operation.generation) return;
      setReader(value => value?.key === key ? { ...value, opening: false } : value);
    } catch (reason) {
      if (!mountedRef.current || !focusedRef.current || !navigation.isFocused() || routeKeyRef.current !== key || activeOpenRef.current !== operation || operationGenerationRef.current !== operation.generation) return;
      setReader(value => value?.key === key ? { ...value, opening: false, error: reason instanceof Error ? reason.message : 'Couldn\u2019t open the full newspaper.' } : value);
    } finally {
      if (activeOpenRef.current === operation) activeOpenRef.current = null;
    }
  }, [navigation]);
  React.useEffect(() => {
    if (!routeFocused || !articleId || !articleSlug) return;
    const generation = ++operationGenerationRef.current;
    activeOpenRef.current = null;
    setReader({ key: readerKey, checking: true, opening: false, target: null, error: null });
    void loadPublishedNewspaperReaderTarget({ articleId, articleSlug, leagueId: scope.leagueId, leagueSlug: scope.leagueSlug })
      .then(target => {
        if (!mountedRef.current || !focusedRef.current || !navigation.isFocused() || routeKeyRef.current !== readerKey || operationGenerationRef.current !== generation) return;
        setReader({ key: readerKey, checking: false, opening: Boolean(target), target, error: null });
        if (target) void openReader(target, readerKey);
      })
      .catch(() => {
        if (mountedRef.current && focusedRef.current && navigation.isFocused() && routeKeyRef.current === readerKey && operationGenerationRef.current === generation) setReader({ key: readerKey, checking: false, opening: false, target: null, error: null });
      });
    return () => {
      operationGenerationRef.current += 1;
      activeOpenRef.current = null;
    };
  }, [articleId, articleSlug, navigation, openReader, readerKey, routeFocused, scope.leagueId, scope.leagueSlug]);
  const open = (href: string) => {
    const target = classifyArticleHref(href, scope.leagueSlug); if (!target) return;
    if (target.kind === 'external') { void Linking.openURL(target.url).catch(() => {}); return; }
    if (target.kind === 'player') navigation.navigate('LeaguePlayerCard', { playerId: target.id, leagueId: scope.leagueId });
    else if (target.kind === 'team') navigation.navigate('LeagueTeamDetail', { teamId: target.id, leagueId: scope.leagueId });
    else if (target.kind === 'game') navigation.navigate('LeagueGamePreview', { gameId: target.id });
    else if (target.kind === 'article') navigation.push('NewsArticle', { ...scope, articleSlug: target.slug });
  };
  if (!page.data || !article) return <LeaguePageFrame onAccessibilityEscape={() => navigation.goBack()}><PageLoadState loading={page.loading} error={page.error} noSeason={false} retry={page.retry} /></LeaguePageFrame>;
  const currentReader = reader?.key === readerKey ? reader : null;
  const openMention = (kind: 'player' | 'team' | 'game', id: string) => {
    if (kind === 'player') navigation.navigate('LeaguePlayerCard', { playerId: id, leagueId: scope.leagueId });
    else if (kind === 'team') navigation.navigate('LeagueTeamDetail', { teamId: id, leagueId: scope.leagueId });
    else navigation.navigate('LeagueGamePreview', { gameId: id });
  };
  return <LeaguePageFrame onAccessibilityEscape={() => navigation.goBack()}>
    {article.imageUrl ? <Image source={{ uri: article.imageUrl }} resizeMode="cover" style={styles.hero} accessibilityLabel={article.title} alt={article.title} /> : null}
    <Text accessibilityRole="header" style={styles.title}>{article.title}</Text>
    <Text style={styles.meta}>{new Date(article.publishedAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}{article.authorName ? ` · ${article.authorName}` : ''}</Text>
    {currentReader?.target ? <View style={styles.readerNotice} accessibilityRole={currentReader.error ? 'alert' : undefined}>
      <Text style={styles.readerTitle}>Hockey Life Times newspaper edition</Text>
      <Text style={styles.readerCopy}>{currentReader.error ?? 'The complete newspaper opens in the in-app browser. The article text below is an accessibility and offline fallback.'}</Text>
      <Pressable accessibilityRole="button" disabled={currentReader.opening} onPress={() => void openReader(currentReader.target!, readerKey)} style={commonStyles.secondaryButton}><Text style={commonStyles.secondaryButtonText}>{currentReader.opening ? 'Opening newspaper…' : currentReader.error ? 'Retry full newspaper' : 'Open full newspaper'}</Text></Pressable>
    </View> : null}
    <FocusCard focusId={`news-article:${route.params.articleSlug}:body`} style={styles.body}>{parseArticleBlocks(article.content).map((block, index) => <Text key={`${index}:${block.text.slice(0, 12)}`} style={block.kind === 'heading' ? styles.bodyHeading : block.kind === 'bullet' ? styles.bullet : styles.paragraph}>{block.kind === 'bullet' ? '• ' : ''}{parseInlineMarkdown(block.text).map((token, tokenIndex) => token.href ? <Text key={tokenIndex} accessibilityRole="link" onPress={() => open(token.href!)} style={styles.link}>{token.text}</Text> : <Text key={tokenIndex} style={token.strong ? styles.strong : undefined}>{token.text}</Text>)}</Text>)}</FocusCard>
    {article.mentions.length ? <View style={commonStyles.section}><Text style={commonStyles.sectionTitle}>Mentioned in this story</Text><View style={styles.mentions}>{article.mentions.map((mention, index) => <Pressable key={`${mention.kind}:${mention.id}:${index}`} accessibilityRole="button" accessibilityLabel={`View ${mention.text}`} onPress={() => openMention(mention.kind, mention.id)} style={styles.mention}><Text style={styles.link}>{mention.text}</Text></Pressable>)}</View></View> : null}
    {article.taggedPlayers.length ? <View style={commonStyles.section}><Text style={commonStyles.sectionTitle}>Players in this story</Text>{article.taggedPlayers.map(player => <FocusCard key={player.id} focusId={`news-article:player:${player.id}`}><Pressable accessibilityRole="button" onPress={() => navigation.navigate('LeaguePlayerCard', { playerId: player.id, leagueId: scope.leagueId })} style={[commonStyles.card, styles.person]}><Avatar uri={player.photoUrl} name={player.name} size={44} /><View style={styles.grow}><Text style={styles.personName}>{player.name}</Text><Text style={styles.meta}>{player.teamName ?? 'Team not listed'}</Text></View></Pressable></FocusCard>)}</View> : null}
    {article.relatedGame ? <FocusCard focusId={`news-article:game:${article.relatedGame.id ?? article.relatedGame.homeTeamName}`} style={[commonStyles.section, commonStyles.card]}><Text style={commonStyles.sectionTitle}>Related Game</Text><View style={styles.game}><TeamLogo teamId={article.relatedGame.homeTeamId ?? ''} logoUrl={article.relatedGame.homeTeamLogoUrl} teamName={article.relatedGame.homeTeamName} size={40} /><Text style={styles.gameName}>{article.relatedGame.homeTeamName}{article.relatedGame.homeScore === null ? '' : ` ${article.relatedGame.homeScore}`}</Text><Text style={styles.meta}>vs</Text><Text style={styles.gameName}>{article.relatedGame.awayScore === null ? '' : `${article.relatedGame.awayScore} `}{article.relatedGame.awayTeamName}</Text></View>{article.relatedGame.id ? <Pressable accessibilityRole="button" onPress={() => navigation.navigate('LeagueGamePreview', { gameId: article.relatedGame!.id! })} style={commonStyles.secondaryButton}><Text style={commonStyles.secondaryButtonText}>View Game</Text></Pressable> : null}</FocusCard> : null}
  </LeaguePageFrame>;
}

const styles = StyleSheet.create({ hero: { width: '100%', aspectRatio: 16 / 9, borderRadius: 22, backgroundColor: colors.bgElevated }, title: { color: colors.textPrimary, fontSize: 30, lineHeight: 37, fontWeight: '900', marginTop: 18 }, meta: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6 }, readerNotice: { gap: 10, marginTop: 18, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.glassStroke, backgroundColor: colors.bgSurface }, readerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '900' }, readerCopy: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 }, body: { marginTop: 22 }, bodyHeading: { color: colors.textPrimary, fontSize: 21, lineHeight: 27, fontWeight: '900', marginTop: 9, marginBottom: 10 }, paragraph: { color: colors.textPrimary, fontSize: 17, lineHeight: 27, marginBottom: 17 }, bullet: { color: colors.textPrimary, fontSize: 16, lineHeight: 25, marginBottom: 7, paddingLeft: 8 }, strong: { fontWeight: '900' }, link: { color: colors.textInteractive, fontWeight: '800' }, mentions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, mention: { minHeight: 48, maxWidth: '100%', justifyContent: 'center', borderRadius: 24, backgroundColor: colors.bgInteractive, borderColor: colors.glassStroke, borderWidth: 1, paddingHorizontal: 15 }, person: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 9 }, grow: { flex: 1, minWidth: 0 }, personName: { color: colors.textPrimary, fontSize: 16, fontWeight: '900' }, game: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }, gameName: { flex: 1, color: colors.textPrimary, fontWeight: '800' } });
