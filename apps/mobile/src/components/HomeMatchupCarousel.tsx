import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  type AccessibilityActionEvent,
  Image,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import arenaBase from '../../assets/matchup/arena-base.png';
import arenaLeftMask from '../../assets/matchup/arena-left-mask.png';
import arenaRightMask from '../../assets/matchup/arena-right-mask.png';
import {
  buildHomeMatchupFacts,
  reconcileHomeMatchupSelection,
  resolveHomeMatchupColors,
  selectHomeMatchupForScope,
  type HomeWeeklyGame,
} from '../lib/supabase/home';
import { HOME_VISUAL_TOKENS as homeTokens } from '../theme/home';
import TeamLogo from './TeamLogo';

type Props = {
  games: HomeWeeklyGame[];
  scopeKey: string;
  timezone: string | null;
  leagueColor: string | null;
  width: number;
  reduceMotion: boolean;
  onOpenGame: (gameId: string) => void;
};

const REFERENCE_CARD_WIDTH = 358;
const AWAY_REFERENCE_HEIGHT = 124.8;
const HOME_REFERENCE_HEIGHT = 122.4;
const SCENE_ASPECT_RATIO = 1024 / 576;

function teamName(game: HomeWeeklyGame, side: 'away' | 'home') {
  return game[`${side}_team`]?.name ?? game[`${side}_team_id`];
}

function matchupAccessibilityLabel(game: HomeWeeklyGame, timezone: string | null) {
  const facts = buildHomeMatchupFacts(game, timezone);
  const factLabels = [facts.dateLabel, facts.timeLabel, facts.locationLabel].filter(Boolean);
  const score = facts.showScore
    ? `${teamName(game, 'away')} ${facts.awayScoreLabel ?? 'score unavailable'}. ${teamName(game, 'home')} ${facts.homeScoreLabel ?? 'score unavailable'}.`
    : `${teamName(game, 'away')} at ${teamName(game, 'home')}.`;
  return `${facts.statusLabel}. ${score}${factLabels.length ? ` ${factLabels.join('. ')}.` : ''}`;
}

export default function HomeMatchupCarousel({ games, scopeKey, timezone, leagueColor, width, reduceMotion, onOpenGame }: Props) {
  const cardWidth = Math.max(1, width - 32);
  const scale = cardWidth / REFERENCE_CARD_WIDTH;
  const artHeight = cardWidth / SCENE_ASPECT_RATIO;
  const ceilingHeight = 18 * scale;
  const sceneHeight = artHeight + ceilingHeight;
  const plinthTop = ceilingHeight + artHeight * 0.585 - 2 * scale;
  const pager = React.useRef<ScrollView>(null);
  const suppressPressUntil = React.useRef(0);
  const activeScope = React.useRef({ key: scopeKey, generation: 0 });
  if (activeScope.current.key !== scopeKey) {
    activeScope.current = { key: scopeKey, generation: activeScope.current.generation + 1 };
  }
  const callbackGeneration = activeScope.current.generation;
  const previousScope = React.useRef(scopeKey);
  const [selection, setSelection] = React.useState(() => reconcileHomeMatchupSelection(games, null, 0, true));
  const gameIds = games.map((game) => game.id).join('|');

  React.useEffect(() => {
    const scopeChanged = previousScope.current !== scopeKey;
    previousScope.current = scopeKey;
    setSelection((current) => {
      const next = reconcileHomeMatchupSelection(games, current.gameId, current.index, scopeChanged);
      return next.gameId === current.gameId && next.index === current.index ? current : next;
    });
  }, [gameIds, games, scopeKey]);

  React.useEffect(() => {
    pager.current?.scrollTo({ x: selection.index * cardWidth, animated: false });
  }, [cardWidth, selection.index, scopeKey]);

  const select = (index: number, scroll: boolean) => {
    const next = selectHomeMatchupForScope(
      games,
      index,
      activeScope.current.key,
      scopeKey,
      activeScope.current.generation,
      callbackGeneration,
    );
    if (!next) return;
    setSelection(next);
    if (scroll) pager.current?.scrollTo({ x: next.index * cardWidth, animated: !reduceMotion });
  };
  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const pageWidth = event.nativeEvent.layoutMeasurement.width || cardWidth;
    select(Math.round(event.nativeEvent.contentOffset.x / pageWidth), false);
    suppressPressUntil.current = Date.now() + 100;
  };
  const selectAdjacent = (offset: -1 | 1) => {
    const nextIndex = selection.index + offset;
    if (nextIndex < 0 || nextIndex >= games.length) return;
    select(nextIndex, true);
  };
  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') selectAdjacent(1);
    if (event.nativeEvent.actionName === 'decrement') selectAdjacent(-1);
  };
  const isFirstGame = selection.index === 0;
  const isLastGame = selection.index === games.length - 1;

  return (
    <View testID="home-matchup-carousel">
      <ScrollView
        ref={pager}
        testID="home-matchup-pager"
        horizontal
        pagingEnabled
        directionalLockEnabled
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        onScrollBeginDrag={() => { suppressPressUntil.current = Number.POSITIVE_INFINITY; }}
        onScrollEndDrag={() => { suppressPressUntil.current = Date.now() + 250; }}
        onMomentumScrollEnd={handleMomentumEnd}
        style={{ width: cardWidth }}
      >
        {games.map((game) => {
          const facts = buildHomeMatchupFacts(game, timezone);
          const teamColors = resolveHomeMatchupColors(game.away_team?.primary_color ?? null, game.home_team?.primary_color ?? null, leagueColor);
          return (
            <View key={game.id} style={{ width: cardWidth }}>
              <Pressable
                testID={`home-matchup-card-${game.id}`}
                accessibilityRole="button"
                accessibilityLabel={matchupAccessibilityLabel(game, timezone)}
                onPress={() => {
                  if (Date.now() < suppressPressUntil.current) return;
                  suppressPressUntil.current = 0;
                  onOpenGame(game.id);
                }}
                style={styles.card}
              >
                <View testID="home-matchup-fact-row" style={styles.factRow}>
                  <Text testID="home-matchup-date" style={[styles.fact, styles.dateFact]}>{facts.dateLabel}</Text>
                  <Text testID="home-matchup-location" style={[styles.fact, styles.locationFact]}>{facts.locationLabel}</Text>
                  <Text testID="home-matchup-time" style={[styles.fact, styles.timeFact]}>{facts.timeLabel}</Text>
                </View>
                <View testID="home-matchup-scene" style={{ width: cardWidth, height: sceneHeight }}>
                  <Image testID="home-matchup-arena-base" source={arenaBase} accessible={false} resizeMode="cover" style={{ position: 'absolute', top: ceilingHeight, width: cardWidth, height: artHeight }} />
                  <Image testID="home-matchup-arena-left-mask" source={arenaLeftMask} accessible={false} resizeMode="cover" tintColor={teamColors.away} style={[styles.sceneLayer, { top: ceilingHeight, width: cardWidth, height: artHeight }]} />
                  <Image testID="home-matchup-arena-right-mask" source={arenaRightMask} accessible={false} resizeMode="cover" tintColor={teamColors.home} style={[styles.sceneLayer, { top: ceilingHeight, width: cardWidth, height: artHeight }]} />
                  <View style={[styles.crestStage, { width: cardWidth, height: sceneHeight }]}>
                    <View testID="home-matchup-away-stage" style={[styles.teamSide, { height: plinthTop }]}>
                      <TeamLogo
                        key={`${game.away_team_id}:${game.away_team?.logo_url ?? 'none'}`}
                        transparentBacking
                        teamId={game.away_team_id}
                        logoUrl={game.away_team?.logo_url ?? null}
                        teamName={teamName(game, 'away')}
                        primaryColor={teamColors.away}
                        size={AWAY_REFERENCE_HEIGHT * scale}
                      />
                      {facts.showScore ? <Text style={styles.score}>{facts.awayScoreLabel ?? '—'}</Text> : null}
                    </View>
                    <View style={[styles.centerFacts, { height: plinthTop }]}>
                      <Text style={[styles.status, facts.statusLabel === 'Live' && styles.live]}>{facts.statusLabel}</Text>
                      <Text style={styles.versus}>VS</Text>
                    </View>
                    <View testID="home-matchup-home-stage" style={[styles.teamSide, { height: plinthTop }]}>
                      <TeamLogo
                        key={`${game.home_team_id}:${game.home_team?.logo_url ?? 'none'}`}
                        transparentBacking
                        teamId={game.home_team_id}
                        logoUrl={game.home_team?.logo_url ?? null}
                        teamName={teamName(game, 'home')}
                        primaryColor={teamColors.home}
                        size={HOME_REFERENCE_HEIGHT * scale}
                      />
                      {facts.showScore ? <Text style={styles.score}>{facts.homeScoreLabel ?? '—'}</Text> : null}
                    </View>
                  </View>
                </View>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
      {games.length > 1 ? (
        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous game"
            accessibilityState={{ disabled: isFirstGame }}
            disabled={isFirstGame}
            style={[styles.control, isFirstGame && styles.controlDisabled]}
            onPress={() => selectAdjacent(-1)}
          >
            <Ionicons name="chevron-back" size={18} color={isFirstGame ? homeTokens.textSecondary : homeTokens.text} />
          </Pressable>
          <View
            testID="home-matchup-position"
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="This week’s games position"
            accessibilityActions={[
              { name: 'increment', label: 'Next game' },
              { name: 'decrement', label: 'Previous game' },
            ]}
            onAccessibilityAction={handleAccessibilityAction}
            accessibilityValue={{ min: 1, max: games.length, now: selection.index + 1, text: `${selection.index + 1} of ${games.length}` }}
            style={styles.position}
          >
            {games.map((game, index) => <View key={game.id} style={[styles.dot, index === selection.index && styles.dotActive]} />)}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next game"
            accessibilityState={{ disabled: isLastGame }}
            disabled={isLastGame}
            style={[styles.control, isLastGame && styles.controlDisabled]}
            onPress={() => selectAdjacent(1)}
          >
            <Ionicons name="chevron-forward" size={18} color={isLastGame ? homeTokens.textSecondary : homeTokens.text} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', borderRadius: 24, borderWidth: 1, borderColor: homeTokens.stroke, backgroundColor: '#050B12' },
  factRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, gap: 6, backgroundColor: 'rgba(4,10,17,0.96)' },
  fact: { color: homeTokens.text, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  dateFact: { width: 70, flexShrink: 0 },
  locationFact: { flex: 1, minWidth: 0, textAlign: 'center' },
  timeFact: { width: 70, flexShrink: 0, textAlign: 'right' },
  sceneLayer: { position: 'absolute', left: 0 },
  crestStage: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 7 },
  teamSide: { position: 'relative', flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'flex-end' },
  centerFacts: { width: 54, alignItems: 'center', justifyContent: 'center', gap: 6 },
  status: { color: homeTokens.textSecondary, fontSize: 9, lineHeight: 12, fontWeight: '900', textAlign: 'center', textTransform: 'uppercase' },
  live: { color: '#FB7185' },
  versus: { color: homeTokens.text, fontSize: 25, lineHeight: 30, fontWeight: '900' },
  score: { position: 'absolute', bottom: -27, color: homeTokens.text, fontSize: 22, lineHeight: 27, fontWeight: '900' },
  controls: { minHeight: 44, marginTop: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  control: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  controlDisabled: { opacity: 0.35 },
  position: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#536276' },
  dotActive: { width: 24, backgroundColor: '#C8B8FF' },
});
