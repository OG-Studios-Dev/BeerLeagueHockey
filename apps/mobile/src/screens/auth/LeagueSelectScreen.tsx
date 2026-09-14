import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusFlatList } from '../../components/CardFocus';
import TeamLogo from '../../components/TeamLogo';
import { useLeague } from '../../context/LeagueContext';
import { getPublicLeagues, type LeagueRow } from '../../lib/supabase/leagues';
import colors from '../../theme/colors';

type LeagueSelectScreenProps = {
  onComplete?: () => void;
  navigation?: { goBack: () => void };
};

function InitialsCircle({ name, color, size = 36 }: { name: string; color: string; size?: number }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color + '33',
        borderWidth: 1.5,
        borderColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color, fontSize: size * 0.38, fontWeight: '800' }}>{initials}</Text>
    </View>
  );
}

export default function LeagueSelectScreen({ onComplete, navigation }: LeagueSelectScreenProps) {
  const { availableLeagues, activeLeague, isLoading, setActiveLeague } = useLeague();
  const [publicLeagues, setPublicLeagues] = React.useState<LeagueRow[]>([]);
  const [publicLoading, setPublicLoading] = React.useState(true);
  const dismiss = () => {
    if (onComplete) onComplete();
    else navigation?.goBack();
  };

  React.useEffect(() => {
    getPublicLeagues()
      .then((rows) => {
        const memberIds = new Set(availableLeagues.map((l) => l.id));
        setPublicLeagues(rows.filter((r) => !memberIds.has(r.id)));
      })
      .finally(() => setPublicLoading(false));
  }, [availableLeagues]);

  function LeagueRow({ item, isActive, onPress }: { item: any; isActive: boolean; onPress: () => void }) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Select ${item.name}`}
        accessibilityState={{ selected: isActive }}
        style={styles.leagueRow}
        onPress={onPress}
      >
        {item.logoUrl ? (
          <TeamLogo
            logoUrl={item.logoUrl}
            teamName={item.name}
            primaryColor={item.theme?.primaryColor ?? colors.primary}
            size={36}
          />
        ) : (
          <InitialsCircle name={item.name} color={item.theme?.primaryColor ?? colors.primary} />
        )}
        <View style={styles.leagueRowMid}>
          <Text style={styles.leagueRowName} numberOfLines={1}>{item.name}</Text>
          {item.city ? <Text style={styles.leagueRowCity} numberOfLines={1}>{item.city}</Text> : null}
        </View>
        {isActive ? (
          <Ionicons name="checkmark-circle" size={20} color={item.theme?.primaryColor ?? colors.primary} />
        ) : (
          <Text style={styles.leagueRowEnter}>Enter</Text>
        )}
      </Pressable>
    );
  }

  function BrowseRow({ league }: { league: LeagueRow }) {
    return (
      <Pressable
        style={styles.leagueRow}
        onPress={() => {
          Linking.openURL(`https://${league.slug}.beerleaguehockey.ca`).catch(() => {});
        }}
      >
        {league.logo_url ? (
          <TeamLogo
            logoUrl={league.logo_url}
            teamName={league.name}
            primaryColor={colors.primary}
            size={36}
          />
        ) : (
          <InitialsCircle name={league.name} color={colors.primary} />
        )}
        <View style={styles.leagueRowMid}>
          <Text style={[styles.leagueRowName, { opacity: 0.7 }]} numberOfLines={1}>{league.name}</Text>
          {league.city ? <Text style={styles.leagueRowCity} numberOfLines={1}>{league.city}</Text> : null}
        </View>
        <View style={styles.guestBadge}>
          <Text style={styles.guestBadgeText}>Visit</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']} onAccessibilityEscape={dismiss}>
      <View style={styles.header}>
        <Text style={styles.heading}>Choose Your League</Text>
        {navigation ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Close league selection" onPress={dismiss} style={styles.closeButton}>
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </Pressable>
        ) : null}
      </View>

      <FocusFlatList
        data={availableLeagues}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.divider} />}
        ListHeaderComponent={
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="BLH Global View, All leagues"
              accessibilityState={{ selected: activeLeague === null }}
              style={styles.leagueRow}
              onPress={() => {
                setActiveLeague(null);
                dismiss();
              }}
            >
              <InitialsCircle name="BLH Global View" color={colors.primary} />
              <View style={styles.leagueRowMid}>
                <Text style={styles.leagueRowName}>BLH Global View</Text>
                <Text style={styles.leagueRowCity}>All leagues</Text>
              </View>
              {activeLeague === null ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
              ) : (
                <Text style={styles.leagueRowEnter}>Enter</Text>
              )}
            </Pressable>
            <View style={styles.divider} />
            {isLoading ? (
              <View style={styles.membershipLoading} accessibilityLiveRegion="polite">
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.emptySubtext}>Refreshing your leagues…</Text>
              </View>
            ) : null}
          </>
        }
        ListEmptyComponent={
          isLoading ? null : (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>You&apos;re not in any leagues yet</Text>
              <Text style={styles.emptySubtext}>Browse below to get started.</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <LeagueRow
            item={item}
            isActive={activeLeague?.id === item.id}
            onPress={() => {
              setActiveLeague(item);
              dismiss();
            }}
          />
        )}
        ListFooterComponent={
          publicLoading || publicLeagues.length > 0 ? (
            <View>
              <Text style={styles.sectionTitle}>Browse All Leagues</Text>
              <View style={styles.browseContainer}>
                {publicLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 12 }} />
                ) : (
                  publicLeagues.map((league, idx) => (
                    <View key={league.id}>
                      {idx > 0 ? <View style={styles.divider} /> : null}
                      <BrowseRow league={league} />
                    </View>
                  ))
                )}
              </View>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bgBase,
  },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderCard,
  },
  heading: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },
  closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  listContent: {
    paddingBottom: 28,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '700',
  },
  emptySubtext: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
  },
  membershipLoading: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  leagueRow: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
    backgroundColor: colors.bgBase,
  },
  leagueRowMid: {
    flex: 1,
  },
  leagueRowName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  leagueRowCity: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 1,
  },
  leagueRowEnter: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  leagueRowJoin: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  guestBadge: {
    backgroundColor: colors.bgInteractive,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.borderCard,
  },
  guestBadgeText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderCard,
    marginLeft: 64,
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 0,
    paddingHorizontal: 16,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  browseContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderCard,
    marginTop: 8,
  },
});
