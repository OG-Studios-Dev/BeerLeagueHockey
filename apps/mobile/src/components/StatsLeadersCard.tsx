import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import Avatar from './Avatar';
import type { PlayerStatRow } from '../lib/supabase/data';
import { formatPublicMetric } from '../lib/supabase/publicStats';
import { ui } from '../theme/ui';

export type StatsLeaderMetric = 'goals' | 'assists' | 'points';
export type StatsCardLeader = PlayerStatRow & { avatar_url: string | null };
export type StatsLeaderStatus = 'loading' | 'ready' | 'error';
const METRICS: ReadonlyArray<{ key: StatsLeaderMetric; label: string }> = [
  { key: 'goals', label: 'Goals' }, { key: 'assists', label: 'Assists' }, { key: 'points', label: 'Points' },
];

type Props = {
  leagueName: string;
  divisionName?: string;
  metric: StatsLeaderMetric;
  leaders: readonly StatsCardLeader[];
  status: StatsLeaderStatus;
  reduceTransparency?: boolean;
  onMetricChange: (metric: StatsLeaderMetric) => void;
  onRetry: () => void;
  onOpenPlayer: (playerId: string) => void;
};

function LeaderAvatar({ player, featured }: { player: StatsCardLeader; featured: boolean }) {
  const size = featured ? 54 : 32;
  const initials = player.player_name.trim().split(/\s+/).map((word) => word[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  return (
    <View style={[styles.avatarFrame, featured && styles.avatarFrameFeatured, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]}>
      {player.avatar_url ? <Avatar uri={player.avatar_url} name={player.player_name} size={size} /> : (
        <View style={[styles.monogram, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text allowFontScaling={false} style={[styles.monogramText, featured && styles.monogramTextFeatured]}>{initials}</Text>
        </View>
      )}
      {featured ? <View style={styles.firstBadge}><Text allowFontScaling={false} style={styles.firstBadgeText}>1</Text></View> : null}
    </View>
  );
}

export default function StatsLeadersCard({ leagueName, divisionName, metric, leaders, status, reduceTransparency = false, onMetricChange, onRetry, onOpenPlayer }: Props) {
  const rows = leaders.slice(0, 5);
  const numericValue = (row: StatsCardLeader) => row.metrics?.[metric].value ?? row[metric] ?? 0;
  const displayValue = (row: StatsCardLeader) => row.metrics ? formatPublicMetric(row.metrics[metric]).value : row[metric] ?? '—';
  const maximum = Math.max(1, ...rows.map(numericValue));
  return (
    <View testID="stats-leaders-card" style={styles.card}>
      <LinearGradient colors={reduceTransparency ? ['#0C1925', '#0C1925'] : ['#112B35', '#0B1723', '#090F19']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={styles.surface}>
        <View style={styles.heading}>
          <View style={styles.headingCopy}>
            <View style={styles.eyebrowRow}><Ionicons name="flash" size={12} color="#E8C779" /><Text style={styles.eyebrow}>{divisionName || leagueName}</Text></View>
            <Text accessibilityRole="header" style={styles.title}>League leaders</Text>
          </View>
          <View style={styles.topFive}><Text style={styles.topFiveText}>TOP 5</Text></View>
        </View>

        <View style={styles.toggle}>
          {METRICS.map(({ key, label }) => (
            <Pressable key={key} testID={`stats-leaders-tab-${key}`} accessibilityRole="button" accessibilityLabel={`Show ${key} leaders`} accessibilityState={{ selected: metric === key }} aria-pressed={metric === key} onPress={() => onMetricChange(key)} style={({ pressed }) => [styles.toggleButton, metric === key && styles.toggleSelected, pressed && styles.pressed]}>
              <Text style={[styles.toggleText, metric === key && styles.toggleTextSelected]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {status === 'loading' ? (
          <View testID="stats-leaders-loading" style={styles.state}><ActivityIndicator color="#61E2E8" accessibilityLabel={`Loading ${metric} leaders`} /><Text style={styles.stateText}>Loading leaders…</Text></View>
        ) : status === 'error' ? (
          <View testID="stats-leaders-error" style={styles.state}>
            <Ionicons name="cloud-offline-outline" size={25} color="#AAB8C9" />
            <Text style={styles.stateText}>Leaders are temporarily unavailable.</Text>
            <Pressable testID="stats-leaders-retry" accessibilityRole="button" accessibilityLabel="Retry loading leaders" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View testID="stats-leaders-empty" style={styles.state}><Ionicons name="stats-chart-outline" size={26} color="#61E2E8" /><Text style={styles.stateTitle}>No leaders available yet</Text><Text style={styles.stateText}>Player stats will appear here when available.</Text></View>
        ) : (
          <View style={styles.rankings}>
            {rows.map((player, index) => {
              const featured = index === 0;
              const teamName = player.team_name || player.team_short_name;
              return (
                <Pressable key={player.player_id} testID={`stats-leader-row-${player.player_id}`} accessibilityRole="button" accessibilityLabel={`${index + 1}. ${player.player_name}, ${teamName}, ${displayValue(player)} ${metric}. Open player card.`} onPress={() => onOpenPlayer(player.player_id)} style={({ pressed }) => [featured ? styles.featured : styles.row, pressed && styles.pressed]}>
                  {!featured ? <Text allowFontScaling={false} style={styles.rank}>{String(index + 1).padStart(2, '0')}</Text> : null}
                  <LeaderAvatar player={player} featured={featured} />
                  <View style={styles.playerCopy}>
                    {featured ? <Text style={styles.leadingLabel}>SETTING THE PACE</Text> : null}
                    <Text style={[styles.playerName, featured && styles.featuredName]}>{player.player_name}</Text>
                    <Text style={styles.teamName}>{teamName}</Text>
                  </View>
                  <View style={styles.score}>
                    <Text testID={`stats-leader-value-${player.player_id}`} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.3} style={[styles.value, featured && styles.featuredValue]}>{displayValue(player)}</Text>
                    {featured ? <Text style={styles.valueLabel}>{metric.toUpperCase()}</Text> : null}
                  </View>
                  {!featured ? <View pointerEvents="none" style={styles.track}><View style={[styles.fill, { width: `${Math.max(0, numericValue(player)) / maximum * 100}%` }]} /></View> : null}
                </Pressable>
              );
            })}
            <View style={styles.footer}><Text style={styles.footerText}>Tap a player for the full picture</Text><Ionicons name="arrow-forward" size={13} color="#849BAD" /></View>
          </View>
        )}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 28, borderWidth: 1, borderColor: '#24404C', overflow: 'hidden', backgroundColor: '#0B1723', marginBottom: 22 },
  surface: { padding: 16 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }, headingCopy: { flex: 1, minWidth: 0 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 }, eyebrow: { flexShrink: 1, color: '#93B4C1', fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  title: { color: '#F5FAFF', fontSize: 23, lineHeight: 29, fontWeight: '900', letterSpacing: -0.6 }, topFive: { borderRadius: 999, borderWidth: 1, borderColor: '#49605D', backgroundColor: '#182E31', paddingHorizontal: 10, paddingVertical: 7 }, topFiveText: { color: '#E8C779', fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 0.8 },
  toggle: { flexDirection: 'row', padding: 4, gap: 3, borderRadius: 999, backgroundColor: '#07111C', borderWidth: 1, borderColor: '#223541', marginBottom: 17 },
  toggleButton: { flex: 1, minWidth: 0, minHeight: ui.minTouchTarget, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 8, borderRadius: 999 }, toggleSelected: { backgroundColor: '#6BE3DF' }, toggleText: { color: '#ADBCCA', fontSize: 12, lineHeight: 17, fontWeight: '800', textAlign: 'center' }, toggleTextSelected: { color: '#072028' }, pressed: { opacity: 0.78 },
  rankings: { gap: 4 }, featured: { minHeight: 110, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 16, marginBottom: 5, backgroundColor: '#152833', borderWidth: 1, borderColor: '#34463E' },
  avatarFrame: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#314957', flexShrink: 0 }, avatarFrameFeatured: { borderColor: '#D0B771', backgroundColor: '#233436' }, monogram: { backgroundColor: '#1B3343', alignItems: 'center', justifyContent: 'center' }, monogramText: { color: '#C3E7ED', fontSize: 11, fontWeight: '900' }, monogramTextFeatured: { color: '#E8CE91', fontSize: 20 },
  firstBadge: { position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#152833', backgroundColor: '#E8C779', alignItems: 'center', justifyContent: 'center' }, firstBadgeText: { color: '#14242B', fontSize: 11, fontWeight: '900' },
  playerCopy: { flex: 1, minWidth: 0 }, leadingLabel: { color: '#D6C493', fontSize: 7, lineHeight: 11, fontWeight: '800', letterSpacing: 0.8, marginBottom: 4 }, playerName: { color: '#EDF5FA', fontSize: 13, lineHeight: 18, fontWeight: '800' }, featuredName: { fontSize: 16, lineHeight: 21, fontWeight: '900', letterSpacing: -0.35 }, teamName: { marginTop: 3, color: '#93A9BA', fontSize: 10, lineHeight: 15 },
  score: { minWidth: 30, maxWidth: '29%', alignItems: 'flex-end' }, value: { color: '#B9EFF0', fontSize: 20, lineHeight: 26, fontWeight: '900', fontVariant: ['tabular-nums'] }, featuredValue: { color: '#F2D994', fontSize: 39, lineHeight: 45, letterSpacing: -1.3 }, valueLabel: { color: '#CBB985', fontSize: 8, lineHeight: 12, fontWeight: '800', letterSpacing: 0.7 },
  row: { position: 'relative', minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 11, paddingHorizontal: 3 }, rank: { width: 18, color: '#8095A9', fontSize: 10, fontWeight: '800', fontVariant: ['tabular-nums'] }, track: { position: 'absolute', left: 58, right: 3, bottom: 1, height: 2, borderRadius: 1, backgroundColor: '#142935', overflow: 'hidden' }, fill: { height: 2, borderRadius: 1, backgroundColor: '#355B65' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 11 }, footerText: { color: '#91A7B8', fontSize: 10, lineHeight: 15, textAlign: 'center', flexShrink: 1 },
  state: { minHeight: 172, justifyContent: 'center', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 22 }, stateTitle: { color: '#E3EDF5', fontSize: 15, lineHeight: 21, fontWeight: '800', textAlign: 'center' }, stateText: { color: '#A4B7C6', fontSize: 12, lineHeight: 18, textAlign: 'center' }, retry: { minHeight: ui.minTouchTarget, minWidth: 100, borderRadius: 999, backgroundColor: '#163942', paddingHorizontal: 18, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' }, retryText: { color: '#A7EFED', fontSize: 12, fontWeight: '800' },
});
